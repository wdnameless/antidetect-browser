/**
 * Shared Server-Sent Events (SSE) stream client.
 *
 * Why a single shared connection instead of per-component:
 * Multiple components (Toasts, status indicators, flow monitors) need real-time events
 * from /api/v1/events/stream. Opening an EventSource per component would multiply open sockets,
 * waste server keep-alive timers, and trigger redundant reconnect storms.
 *
 * Why custom reconnect logic on EventSource.CLOSED:
 * Standard EventSource automatically reconnects on transient network interruptions when the
 * connection was already established. However, when the backend restarts, crashes, or returns
 * an HTTP error (such as 401 Unauthorized while waiting for auth/api key), standard EventSource
 * sets readyState to CLOSED and permanently ceases reconnection attempts. Without explicit
 * backoff-reconnect handling on CLOSED, the client would remain permanently disconnected
 * and silently dead with zero UI indication until a hard page reload.
 */

import { getApiBase, getApiKey } from './api';

export type ConnectionState = 'connected' | 'connecting' | 'disconnected';

export interface AgentActivityEventData {
  id: string;
  at: number;
  kind: string;
  summary: string;
  source: 'agent' | 'ui' | 'telegram';
  profileId?: string;
  route: string;
}

export type StreamMessage =
  | { type: 'hello'; at: number }
  | { type: 'profile-status'; profileId: string; status: 'running' | 'closed' | 'error'; at: number }
  /**
   * A queued proxy geo check stored its result. The tables refresh on this rather than waiting for
   * their slow reconciliation poll, so a proxy created a second ago shows its country — or its
   * cross — without the operator watching an empty cell and wondering.
   */
  | { type: 'proxy-geo'; proxyId: string; at: number }
  | { type: 'agent-activity'; event: AgentActivityEventData };
export type StreamEvent = StreamMessage;

export type StreamMessageHandler = (message: StreamEvent) => void;
export type ConnectionStateListener = (state: ConnectionState) => void;

// Safe references for non-DOM/node test environments
function getGlobalEventSource(): typeof EventSource | undefined {
  if (typeof window !== 'undefined' && 'EventSource' in window) {
    return window.EventSource;
  }
  if (typeof globalThis !== 'undefined' && 'EventSource' in globalThis) {
    const scope = globalThis as unknown as Record<string, unknown>;
    return typeof scope.EventSource === 'function'
      ? (scope.EventSource as unknown as typeof EventSource)
      : undefined;
  }
  return undefined;
}

let activeSource: EventSource | null = null;
let connectionState: ConnectionState = 'disconnected';
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelayMs = 1000;
const MAX_RECONNECT_DELAY_MS = 30000;

let customEventSourceFactory: ((url: string) => EventSource) | null = null;
const subscribers = new Set<StreamMessageHandler>();
const stateListeners = new Set<ConnectionStateListener>();

function setConnectionState(next: ConnectionState): void {
  if (connectionState === next) return;
  connectionState = next;
  for (const listener of stateListeners) {
    try {
      listener(next);
    } catch {
      // Isolate listener errors from stream operation
    }
  }
}

export function getConnectionState(): ConnectionState {
  return connectionState;
}

export function subscribeToConnectionState(listener: ConnectionStateListener): () => void {
  stateListeners.add(listener);
  // Notify initial state immediately
  try {
    listener(connectionState);
  } catch {
    // Isolate listener errors
  }
  return () => {
    stateListeners.delete(listener);
  };
}

export function parseStreamData(raw: string): StreamMessage | null {
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || typeof data.type !== 'string') {
      return null;
    }

    switch (data.type) {
      case 'hello':
        if (typeof data.at === 'number') {
          return { type: 'hello', at: data.at };
        }
        break;
      case 'profile-status':
        if (
          typeof data.profileId === 'string' &&
          (data.status === 'running' || data.status === 'closed' || data.status === 'error') &&
          typeof data.at === 'number'
        ) {
          return {
            type: 'profile-status',
            profileId: data.profileId,
            status: data.status,
            at: data.at,
          };
        }
        break;
      case 'proxy-geo':
        if (typeof data.proxyId === 'string' && typeof data.at === 'number') {
          return { type: 'proxy-geo', proxyId: data.proxyId, at: data.at };
        }
        break;
      case 'agent-activity': {
        const payload = data.event;
        if (payload && typeof payload === 'object' && typeof payload.summary === 'string' && typeof payload.kind === 'string') {
          const eventData: AgentActivityEventData = {
            id: typeof payload.id === 'string' ? payload.id : `act_${Date.now()}`,
            at: typeof payload.at === 'number' ? payload.at : Date.now(),
            kind: payload.kind,
            summary: payload.summary,
            source: payload.source === 'ui' || payload.source === 'telegram' ? payload.source : 'agent',
            profileId: typeof payload.profileId === 'string' ? payload.profileId : undefined,
            route: typeof payload.route === 'string' ? payload.route : '',
          };
          return {
            type: 'agent-activity',
            event: eventData,
          };
        }
        break;
      }
      default:
        // Ignore unrecognized message types for forward-compatibility
        break;
    }
  } catch {
    // Malformed JSON is ignored
  }
  return null;
}

function connect(): void {
  if (subscribers.size === 0) {
    return;
  }

  const EventSourceClass = getGlobalEventSource();
  if (!customEventSourceFactory && !EventSourceClass) {
    // Non-browser / node test environment without EventSource shim
    setConnectionState('disconnected');
    return;
  }

  if (activeSource) {
    try {
      activeSource.close();
    } catch {
      // Ignore cleanup error on existing instance
    }
    activeSource = null;
  }

  setConnectionState('connecting');

  const base = getApiBase();
  const key = getApiKey();
  const url = `${base}/api/v1/events/stream?key=${encodeURIComponent(key)}`;

  const source = customEventSourceFactory ? customEventSourceFactory(url) : new EventSourceClass!(url);
  activeSource = source;

  source.onopen = () => {
    // Reset backoff on successful handshake
    reconnectDelayMs = 1000;
    setConnectionState('connected');
  };

  source.onmessage = (event: MessageEvent) => {
    const msg = parseStreamData(event.data);
    if (!msg) return;

    for (const handler of subscribers) {
      try {
        handler(msg);
      } catch {
        // Individual handler errors must not crash dispatch to other listeners
      }
    }
  };

  source.onerror = () => {
    // Why explicit backoff on CLOSED:
    // EventSource automatically reconnects on network blips when readyState is CONNECTING (0).
    // But when the server shuts down, resets, or returns 401/404/500, EventSource permanently closes
    // itself (readyState === CLOSED, 2) and drops all future reconnection attempts. We explicitly schedule
    // a manual reconnect with exponential backoff (1s to 30s) so the client recovers when the server returns.
    const closedConstant = EventSourceClass?.CLOSED ?? 2;
    if (source.readyState === closedConstant) {
      setConnectionState('disconnected');
      try {
        source.close();
      } catch {
        // Ignore close error
      }
      activeSource = null;
      scheduleReconnect();
    } else {
      // Transient error, browser may attempt reconnection
      setConnectionState('connecting');
    }
  };
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  if (subscribers.size === 0) return;

  const delay = reconnectDelayMs;
  reconnectDelayMs = Math.min(reconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS);

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

function disconnect(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectDelayMs = 1000;

  if (activeSource) {
    try {
      activeSource.close();
    } catch {
      // Ignore close error
    }
    activeSource = null;
  }
  setConnectionState('disconnected');
}

/**
 * Subscribes to the shared events stream.
 * Automatically connects when the first subscriber joins, and disconnects when the last leaves.
 */
export function subscribeToEvents(handler: StreamMessageHandler): () => void {
  subscribers.add(handler);

  if (subscribers.size === 1) {
    connect();
  }

  return () => {
    subscribers.delete(handler);
    if (subscribers.size === 0) {
      disconnect();
    }
  };
}

/**
 * Closes the active stream and resets state. Intended for test cleanup.
 */
export function closeEventStreamForTesting(): void {
  subscribers.clear();
  stateListeners.clear();
  disconnect();
}

/**
 * Injects a custom EventSource factory. Intended for testing.
 */
export function setEventSourceFactoryForTesting(
  factory: ((url: string) => EventSource) | null
): void {
  customEventSourceFactory = factory;
}
