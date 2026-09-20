import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  subscribeToEvents,
  subscribeToConnectionState,
  getConnectionState,
  parseStreamData,
  closeEventStreamForTesting,
  setEventSourceFactoryForTesting,
  StreamMessage,
} from '../../../src/renderer/src/eventsStream';

// Mock api methods so eventsStream can construct the URL in node environment
vi.mock('../../../src/renderer/src/api', () => ({
  getApiBase: () => 'http://127.0.0.1:50325',
  getApiKey: () => 'test_api_key_123',
}));

describe('eventsStream', () => {
  beforeEach(() => {
    closeEventStreamForTesting();
    setEventSourceFactoryForTesting(null);
  });

  afterEach(() => {
    closeEventStreamForTesting();
    setEventSourceFactoryForTesting(null);
    vi.restoreAllMocks();
  });

  describe('Node environment compatibility (no DOM / no EventSource)', () => {
    it('imports safely and subscribeToEvents handles absence of EventSource gracefully', () => {
      // In vitest node environment, global EventSource is absent by default.
      // Ensure factory is null and globalThis.EventSource is undefined.
      const originalES = (globalThis as unknown as { EventSource?: unknown }).EventSource;
      try {
        delete (globalThis as unknown as { EventSource?: unknown }).EventSource;
        setEventSourceFactoryForTesting(null);

        expect(getConnectionState()).toBe('disconnected');

        const handler = vi.fn();
        const unsubscribe = subscribeToEvents(handler);

        // State remains disconnected because EventSource is absent
        expect(getConnectionState()).toBe('disconnected');
        expect(typeof unsubscribe).toBe('function');

        // Calling unsubscribe should be safe and not throw
        expect(() => unsubscribe()).not.toThrow();
      } finally {
        if (originalES) {
          (globalThis as unknown as { EventSource?: unknown }).EventSource = originalES;
        }
      }
    });
  });

  describe('Contract message parsing (parseStreamData)', () => {
    it('parses hello message correctly', () => {
      const raw = JSON.stringify({ type: 'hello', at: 1710000000000 });
      const parsed = parseStreamData(raw);
      expect(parsed).toEqual({
        type: 'hello',
        at: 1710000000000,
      });
    });

    it('parses profile-status message correctly', () => {
      const raw = JSON.stringify({
        type: 'profile-status',
        profileId: 'p_abc123',
        status: 'running',
        at: 1710000005000,
      });
      const parsed = parseStreamData(raw);
      expect(parsed).toEqual({
        type: 'profile-status',
        profileId: 'p_abc123',
        status: 'running',
        at: 1710000005000,
      });
    });

    it('parses agent-activity message correctly', () => {
      const raw = JSON.stringify({
        type: 'agent-activity',
        event: {
          id: 'act_101',
          at: 1710000010000,
          kind: 'profile.start',
          summary: 'Started profile «Target Profile»',
          source: 'agent',
          profileId: 'p_abc123',
          route: '/api/v1/browser/start',
        },
      });
      const parsed = parseStreamData(raw);
      expect(parsed).toEqual({
        type: 'agent-activity',
        event: {
          id: 'act_101',
          at: 1710000010000,
          kind: 'profile.start',
          summary: 'Started profile «Target Profile»',
          source: 'agent',
          profileId: 'p_abc123',
          route: '/api/v1/browser/start',
        },
      });
    });

    it('ignores unrecognized message types for forward compatibility', () => {
      const rawUnknown = JSON.stringify({
        type: 'future-extension-event',
        data: { foo: 'bar' },
      });
      expect(parseStreamData(rawUnknown)).toBeNull();

      const rawInvalidJson = 'not valid json at all';
      expect(parseStreamData(rawInvalidJson)).toBeNull();
    });
  });

  describe('Fake EventSource streaming and dispatch', () => {
    class FakeEventSource {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSED = 2;

      readyState = FakeEventSource.CONNECTING;
      url: string;
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      onerror: ((err: unknown) => void) | null = null;
      closed = false;

      constructor(url: string) {
        this.url = url;
      }

      close() {
        this.closed = true;
        this.readyState = FakeEventSource.CLOSED;
      }

      simulateOpen() {
        this.readyState = FakeEventSource.OPEN;
        if (this.onopen) this.onopen();
      }

      simulateMessage(data: string) {
        if (this.onmessage) this.onmessage({ data });
      }

      simulateError() {
        this.readyState = FakeEventSource.CLOSED;
        if (this.onerror) this.onerror(new Error('connection failed'));
      }
    }

    it('connects to expected URL and dispatches agent-activity to subscribers', () => {
      let instanceCreated: FakeEventSource | null = null;
      setEventSourceFactoryForTesting((url: string) => {
        instanceCreated = new FakeEventSource(url);
        return instanceCreated as unknown as EventSource;
      });

      const received: StreamMessage[] = [];
      const unsubscribe = subscribeToEvents((msg) => {
        received.push(msg);
      });

      expect(instanceCreated).not.toBeNull();
      const fake = instanceCreated!;
      expect(fake.url).toBe('http://127.0.0.1:50325/api/v1/events/stream?key=test_api_key_123');
      expect(getConnectionState()).toBe('connecting');

      // Simulate connection open
      fake.simulateOpen();
      expect(getConnectionState()).toBe('connected');

      // Send contract events
      fake.simulateMessage(JSON.stringify({ type: 'hello', at: 1000 }));
      fake.simulateMessage(
        JSON.stringify({
          type: 'agent-activity',
          event: {
            id: 'act_test',
            at: 1002,
            kind: 'profile.start',
            summary: 'Started p_1',
            source: 'agent',
            route: '/start',
          },
        })
      );
      fake.simulateMessage(
        JSON.stringify({
          type: 'profile-status',
          profileId: 'p_1',
          status: 'running',
          at: 1003,
        })
      );

      expect(received).toHaveLength(3);
      expect(received[0].type).toBe('hello');
      expect(received[1].type).toBe('agent-activity');
      expect(received[2].type).toBe('profile-status');

      if (received[1].type === 'agent-activity') {
        expect(received[1].event.summary).toBe('Started p_1');
        expect(received[1].event.kind).toBe('profile.start');
      }

      // When last subscriber unsubscribes, connection is closed
      unsubscribe();
      expect(fake.closed).toBe(true);
      expect(getConnectionState()).toBe('disconnected');
    });

    it('manages connection state transitions for state observers', () => {
      let fake: FakeEventSource | null = null;
      setEventSourceFactoryForTesting((url: string) => {
        fake = new FakeEventSource(url);
        return fake as unknown as EventSource;
      });

      const stateHistory: string[] = [];
      const unsubState = subscribeToConnectionState((state) => {
        stateHistory.push(state);
      });

      const unsubEvents = subscribeToEvents(() => {});
      expect(stateHistory).toContain('connecting');

      fake!.simulateOpen();
      expect(stateHistory).toContain('connected');

      unsubEvents();
      expect(stateHistory).toContain('disconnected');
      unsubState();
    });

    it('schedules backoff reconnection when EventSource closes on error', () => {
      vi.useFakeTimers();
      try {
        let createCount = 0;
        let lastCreated: FakeEventSource | null = null;
        setEventSourceFactoryForTesting((url: string) => {
          createCount++;
          lastCreated = new FakeEventSource(url);
          return lastCreated as unknown as EventSource;
        });

        const unsub = subscribeToEvents(() => {});
        expect(createCount).toBe(1);

        // Simulate server error causing readyState CLOSED (e.g. 401 or backend restart)
        lastCreated!.simulateError();
        expect(getConnectionState()).toBe('disconnected');

        // Advance timer by 1000ms (initial backoff delay)
        vi.advanceTimersByTime(1000);
        expect(createCount).toBe(2);

        unsub();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
