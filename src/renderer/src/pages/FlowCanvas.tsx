import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  FlowNode,
  FlowEdge,
  FlowDocument,
  FlowNodeType,
  FlowValidationError,
  CanvasNodeState,
  CanvasEdgeState,
} from '../../../main/flows/types';
import { validateFlow } from '../flowValidator';
import { getApiBase, api } from '../api';
import { mapCapturedAction, CaptureRecord, TypingCoalescer } from '../../../main/recorder/actionMap';
import { useI18n } from '../i18n';
import {
  parseSseLine,
  extractScreenshotRef,
  extractNodeTiming,
  reduceLogLines,
  shouldAutoScroll,
  SseLogEntry,
  FleetRunState,
  FleetRunEvent,
  reduceFleetRunState,
} from '../flowLiveRun';
import { FleetPanel, LogLineList } from '../components/FleetPanel';

export type { CanvasNodeState, CanvasEdgeState };
export interface NodePaletteItem {
  type: FlowNodeType;
  label: string;
  category: 'Actions' | 'Logic' | 'Data' | 'Advanced';
  description: string;
  defaultConfig: Record<string, unknown>;
}

export const NODE_PALETTE: NodePaletteItem[] = [
  {
    type: 'navigate',
    label: 'Navigate',
    category: 'Actions',
    description: 'Load URL in page with timeout options',
    defaultConfig: { url: 'https://example.com', timeoutMs: 30000 },
  },
  {
    type: 'click',
    label: 'Click Element',
    category: 'Actions',
    description: 'Click matching selector or coordinates',
    defaultConfig: { selector: 'button.submit', waitForSelector: true, timeoutMs: 5000 },
  },
  {
    type: 'type',
    label: 'Type Text',
    category: 'Actions',
    description: 'Type text into an input field',
    defaultConfig: { selector: 'input[name="search"]', text: 'Hello world', delayMs: 25 },
  },
  {
    type: 'human_click',
    label: 'Human Click',
    category: 'Actions',
    description: 'Fitts-law human cursor glide and click (Motion domain)',
    defaultConfig: { selector: 'button.submit', targetWidth: 40 },
  },
  {
    type: 'human_type',
    label: 'Human Type',
    category: 'Actions',
    description: 'Per-key human typing with optional typos (Motion domain)',
    defaultConfig: { selector: 'input[name="search"]', text: 'Hello world', allowTypos: false },
  },
  {
    type: 'wait',
    label: 'Wait',
    category: 'Actions',
    description: 'Wait fixed time or until selector exists',
    defaultConfig: { waitType: 'time', durationMs: 2000 },
  },
  {
    type: 'condition',
    label: 'Condition (Branch)',
    category: 'Logic',
    description: 'Evaluate expression: routes to true/false branch',
    defaultConfig: { expression: 'vars.counter > 0' },
  },
  {
    type: 'loop',
    label: 'Loop',
    category: 'Logic',
    description: 'Iterate fixed count or over an array variable',
    defaultConfig: { loopType: 'count', count: 5, maxIterations: 100 },
  },
  {
    type: 'extract',
    label: 'Extract Data',
    category: 'Data',
    description: 'Extract text, HTML or attribute into a variable',
    defaultConfig: { selector: '.price', variable: 'price' },
  },
  {
    type: 'screenshot',
    label: 'Screenshot',
    category: 'Actions',
    description: 'Capture full page or element screenshot',
    defaultConfig: { fullPage: true },
  },
  {
    type: 'eval',
    label: 'Eval JS',
    category: 'Advanced',
    description: 'Execute arbitrary JavaScript expression/function',
    defaultConfig: { code: 'return document.title;' },
  },
  {
    type: 'module',
    label: 'Module / Subflow',
    category: 'Advanced',
    description: 'Execute reusable script module or subflow',
    defaultConfig: { moduleId: 'script-1' },
  },
];

const INITIAL_NODES: CanvasNodeState[] = [
  {
    id: 'node-start',
    type: 'navigate',
    name: 'Open Target',
    x: 80,
    y: 120,
    config: { url: 'https://example.com', timeoutMs: 15000 },
  },
  {
    id: 'node-click',
    type: 'click',
    name: 'Click Button',
    x: 360,
    y: 120,
    config: { selector: 'button#login', clickCount: 1, delayMs: 100 },
  },
  {
    id: 'node-check',
    type: 'condition',
    name: 'Check Status',
    x: 640,
    y: 120,
    config: { expression: 'vars.status === "ok"' },
  },
];

const INITIAL_EDGES: CanvasEdgeState[] = [
  { id: 'e1', source: 'node-start', target: 'node-click', branch: 'default' },
  { id: 'e2', source: 'node-click', target: 'node-check', branch: 'default' },
];

const pickerButtonStyle: React.CSSProperties = {
  background: 'var(--surface-2)',
  border: '1px solid var(--border)',
  color: 'var(--text)',
  fontSize: 12,
  padding: '6px 10px',
  borderRadius: 6,
  cursor: 'pointer',
  textAlign: 'left',
};

export function FlowCanvas() {
  const [nodes, setNodes] = useState<CanvasNodeState[]>(INITIAL_NODES);
  const [edges, setEdges] = useState<CanvasEdgeState[]>(INITIAL_EDGES);
  const [entryNodeId, setEntryNodeId] = useState<string>('node-start');
  const [flowName, setFlowName] = useState<string>('Parity Automation Flow');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>('node-start');
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  // Live Run State
  const [showLiveRun, setShowLiveRun] = useState<boolean>(false);
  const [profiles, setProfiles] = useState<Array<{ user_id: string; name: string | null }>>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string>('');
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [activeTaskGroupId, setActiveTaskGroupId] = useState<string | null>(null);
  const [activeTaskUuid, setActiveTaskUuid] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState<'idle' | 'running' | 'finished' | 'error' | 'stop'>('idle');
  const [runLogs, setRunLogs] = useState<SseLogEntry[]>([]);
  const [runError, setRunError] = useState<string | null>(null);
  const [nodeTimings, setNodeTimings] = useState<Record<string, number>>({});
  const [isScrolledUp, setIsScrolledUp] = useState<boolean>(false);

  // Fleet run view: multi-profile run scope + per-profile progress/logs.
  const [selectedProfileIds, setSelectedProfileIds] = useState<string[]>([]);
  const [concurrency, setConcurrency] = useState<number>(1);
  const [showFleetPanel, setShowFleetPanel] = useState<boolean>(false);
  const [selectedFleetTaskUuid, setSelectedFleetTaskUuid] = useState<string | null>(null);
  const [fleetState, setFleetState] = useState<FleetRunState | null>(null);
  // Dispatch folds through the pure reducer; resetting re-seeds from `null`,
  // which the reducer treats as a fresh run (see reduceFleetRunState).
  const dispatchFleet = useCallback(
    (ev: FleetRunEvent) => setFleetState(prev => reduceFleetRunState(prev, ev)),
    []
  );
  const resetFleetRun = useCallback(() => setFleetState(null), []);
  const [fleetRunError, setFleetRunError] = useState<string | null>(null);

  // Display names for fleet rows (profile_id -> human name, fallback id).
  const profileNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of profiles) {
      if (p.name) map[p.user_id] = p.name;
    }
    return map;
  }, [profiles]);

  // Flow recorder state (Wave 2b)
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [recorderHuman, setRecorderHuman] = useState<boolean>(false);
  const [recorderError, setRecorderError] = useState<string | null>(null);
  const recorderSocketRef = useRef<WebSocket | null>(null);
  const recorderCoalescerRef = useRef<TypingCoalescer | null>(null);
  const recorderNowRef = useRef<number>(0);
  // Element action picker (independent of recording)
  const [pickerOpen, setPickerOpen] = useState<boolean>(false);
  const [pickerElement, setPickerElement] = useState<{ selector: string | null; tag?: string; id?: string | null } | null>(null);
  const pickerSocketRef = useRef<WebSocket | null>(null);

  const { t } = useI18n();

  const logsContainerRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const fleetEventSourcesRef = useRef<Map<string, EventSource>>(new Map());
  const stoppedFleetRef = useRef<boolean>(false);

  // Clean up recorder + picker sockets on unmount
  useEffect(() => {
    return () => {
      if (recorderSocketRef.current) {
        recorderSocketRef.current.close();
        recorderSocketRef.current = null;
      }
      if (pickerSocketRef.current) {
        pickerSocketRef.current.close();
        pickerSocketRef.current = null;
      }
      setIsRecording(false);
    };
  }, []);

  // Load profiles for run picker
  useEffect(() => {
    let unmounted = false;
    const loadProfiles = async () => {
      try {
        const res = await fetch(`${getApiBase()}/api/v1/browser/list?page=1&page_size=100`);
        if (res.ok) {
          const json = await res.json();
          const list = json?.data?.list || json?.list || [];
          if (!unmounted && Array.isArray(list)) {
            setProfiles(list);
            if (list.length > 0 && !selectedProfileId) {
              setSelectedProfileId(list[0].user_id);
            }
          }
        }
      } catch {
        // Ignored in offline/mock env
      }
    };
    loadProfiles();
    return () => {
      unmounted = true;
    };
  }, []);

  // Auto-scroll log box unless user scrolled up
  useEffect(() => {
    if (!isScrolledUp && logsContainerRef.current) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    }
  }, [runLogs, isScrolledUp]);

  // Clean up EventSource on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, []);

  // Connect SSE for a task uuid
  const connectLogsStream = useCallback((taskUuid: string) => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    const sseUrl = `${getApiBase()}/api/tasks/${encodeURIComponent(taskUuid)}/logs?stream=true`;
    const es = new EventSource(sseUrl);
    eventSourceRef.current = es;

    es.onopen = () => {
      setRunStatus('running');
    };

    es.onmessage = (e) => {
      try {
        const parsed = parseSseLine(e.data);
        if (parsed?.end) {
          setRunStatus(parsed.end.status);
          setIsRunning(false);
          es.close();
          eventSourceRef.current = null;
          return;
        }

        if (parsed?.log) {
          const entry = parsed.log;
          if (entry.nodeId) {
            setNodeTimings(prev => ({
              ...prev,
              [entry.nodeId as string]: entry.durationMs ?? (prev[entry.nodeId as string] || 0),
            }));
          }

          setRunLogs(prev => reduceLogLines(prev, entry, 200));
        }
      } catch {
        // ignore parse error
      }
    };

    es.onerror = () => {
      // If error occurs and still running, mark as error
      setRunStatus(prev => (prev === 'running' ? 'error' : prev));
      setIsRunning(false);
      es.close();
      eventSourceRef.current = null;
    };
  }, []);

  // Run flow handler
  const handleRunFlow = async () => {
    if (isRunning) return;
    setRunError(null);
    setShowLiveRun(true);
    setIsRunning(true);
    setRunStatus('running');
    setRunLogs([]);
    setNodeTimings({});
    setIsScrolledUp(false);

    try {
      const targetProfileId = selectedProfileId || profiles[0]?.user_id || 'default';
      const flowPayload = {
        name: flowName,
        nodes: nodes.map(n => ({
          ...n.config,
          id: n.id,
          type: n.type,
          name: n.name,
          timeoutMs: n.timeoutMs,
          retryCount: n.retryCount,
        })),
        edges,
        entryNodeId,
      };

      // 1. Create or save flow via POST /api/flows
      const saveRes = await fetch(`${getApiBase()}/api/flows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(flowPayload),
      });

      let flowId = 'canvas-flow';
      if (saveRes.ok) {
        const saveJson = await saveRes.json();
        flowId = saveJson?.data?.id || saveJson?.id || flowId;
      }

      // 2. Trigger run via POST /api/flows/:id/run
      const runRes = await fetch(`${getApiBase()}/api/flows/${encodeURIComponent(flowId)}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile_ids: [targetProfileId],
          concurrency: 1,
        }),
      });

      if (!runRes.ok) {
        const errJson = await runRes.json().catch(() => ({}));
        throw new Error(errJson?.error || `Run failed with HTTP ${runRes.status}`);
      }

      const runJson = await runRes.json();
      const taskGroupId = runJson?.data?.taskGroupId || runJson?.taskGroupId;
      setActiveTaskGroupId(taskGroupId);

      // 3. Look up task group to get task uuid
      const groupRes = await fetch(`${getApiBase()}/api/task-groups/${encodeURIComponent(taskGroupId)}`);
      let taskUuid: string | null = null;
      if (groupRes.ok) {
        const groupJson = await groupRes.json();
        const tasks = groupJson?.data?.tasks || groupJson?.tasks || [];
        if (tasks.length > 0 && tasks[0].uuid) {
          taskUuid = tasks[0].uuid;
        }
      }

      if (!taskUuid) {
        // Fallback: use taskGroupId or synthetic
        taskUuid = taskGroupId;
      }

      const streamUuid = taskUuid || taskGroupId || 'unknown';
      setActiveTaskUuid(streamUuid);
      connectLogsStream(streamUuid);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setRunError(msg);
      setRunStatus('error');
      setIsRunning(false);
    }
  };

  // ------------------------------------------------------------------
  // Fleet run view: N task streams folded through reduceFleetRunState.
  // ------------------------------------------------------------------

  // Stream one task's logs into the fleet reducer. Reuses the canonical
  // SSE parsing (parseSseLine) — same contract as the single-profile run.
  const fleetConnectTaskLogs = useCallback(
    (taskUuid: string) => {
      const existing = fleetEventSourcesRef.current.get(taskUuid);
      if (existing) existing.close();
      const sseUrl = `${getApiBase()}/api/tasks/${encodeURIComponent(taskUuid)}/logs?stream=true`;
      const es = new EventSource(sseUrl);
      fleetEventSourcesRef.current.set(taskUuid, es);

      const close = () => {
        es.close();
        fleetEventSourcesRef.current.delete(taskUuid);
      };

      es.onmessage = (e) => {
        try {
          dispatchFleet({ kind: 'payload', taskUuid, payload: String(e.data) });
          if (!selectedFleetTaskUuid) setSelectedFleetTaskUuid(taskUuid);
        } catch {
          // ignore parse error — reducer drops unknown payloads
        }
      };
      es.onerror = () => {
        close();
        // Marking the affected profile terminal keeps the run from hanging
        // forever on a dropped stream; other streams keep updating.
        dispatchFleet({ kind: 'payload', taskUuid, payload: JSON.stringify({ event: 'end', status: 'error', error: 'log stream closed' }) });
      };
    },
    [selectedFleetTaskUuid]
  );

  // Stop the whole fleet run through the existing task-group stop endpoint.
  // The backend marks waiting tasks 'stop' and terminates running workers;
  // locally we flip queued/working rows to stopped so queued profiles never
  // start afterwards (the reducer's sticky stopped status also guards them
  // against late payloads arriving after this point).
  const handleStopFleetRun = useCallback(async () => {
    if (!activeTaskGroupId) return;
    stoppedFleetRef.current = true;
    dispatchFleet({ kind: 'stopAll' });
    for (const es of fleetEventSourcesRef.current.values()) es.close();
    fleetEventSourcesRef.current.clear();
    try {
      await api.taskGroupStop(activeTaskGroupId);
    } catch {
      // Backend stop is best-effort from the UI's perspective: local state
      // already reflects a stopped run.
    }
  }, [activeTaskGroupId]);

  // Close all fleet streams on unmount.
  useEffect(() => {
    return () => {
      for (const es of fleetEventSourcesRef.current.values()) es.close();
      fleetEventSourcesRef.current.clear();
    };
  }, []);

  // Fleet run handler: multi-profile run scope with a concurrency limit.
  const handleRunFleet = async () => {
    if (isRunning) return;
    if (fleetState?.profiles.some(p => p.status === 'queued' || p.status === 'working')) return;

    const targetProfiles =
      selectedProfileIds.length > 0
        ? selectedProfileIds
        : [selectedProfileId || profiles[0]?.user_id || 'default'];

    setFleetRunError(null);
    setShowLiveRun(true);
    setShowFleetPanel(true);
    setSelectedFleetTaskUuid(null);
    setIsRunning(true);
    setRunStatus('running');
    setRunLogs([]);
    setNodeTimings({});
    setIsScrolledUp(false);
    // Fresh run: drop the previous run's fleet state entirely.
    resetFleetRun();
    stoppedFleetRef.current = false;

    const flowPayload = {
      name: flowName,
      nodes: nodes.map(n => ({
        ...n.config,
        id: n.id,
        type: n.type,
        name: n.name,
        timeoutMs: n.timeoutMs,
        retryCount: n.retryCount,
      })),
      edges,
      entryNodeId,
    };

    try {
      // 1. Create or save the flow document (same as the single-profile path).
      const saveRes = await fetch(`${getApiBase()}/api/flows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(flowPayload),
      });
      let flowId = 'canvas-flow';
      if (saveRes.ok) {
        const saveJson = await saveRes.json();
        flowId = saveJson?.data?.id || saveJson?.id || flowId;
      }

      // 2. Trigger the run with the chosen profile set + concurrency.
      const runRes = await fetch(`${getApiBase()}/api/flows/${encodeURIComponent(flowId)}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile_ids: targetProfiles,
          concurrency,
        }),
      });
      if (!runRes.ok) {
        const errJson = await runRes.json().catch(() => ({}));
        throw new Error(errJson?.msg || errJson?.error || `Run failed with HTTP ${runRes.status}`);
      }
      const runJson = await runRes.json();
      const taskGroupId = runJson?.data?.taskGroupId || runJson?.taskGroupId;
      setActiveTaskGroupId(taskGroupId);

      // 3. Fetch the group's tasks to init each per-profile row (in backend
      // dispatch order) and open one SSE stream per task.
      const groupRes = await api.taskGroupTasks(taskGroupId);
      const tasks = groupRes.data?.list ?? [];
      const cap = runJson?.data?.group?.active_session_cap ?? concurrency;
      const flowNodeCount = nodes.length;
      for (const es of fleetEventSourcesRef.current.values()) es.close();
      fleetEventSourcesRef.current.clear();
      tasks.forEach((task, idx) => {
        dispatchFleet({
          kind: 'init',
          taskUuid: task.uuid,
          profileId: task.profile_id,
          totalNodes: flowNodeCount,
          activeSessionCap: cap,
          slotIndex: idx,
          snapshotStatus: task.status,
        });
      });
      // Select the first profile's log stream by default.
      if (tasks[0]?.uuid && !selectedFleetTaskUuid) setSelectedFleetTaskUuid(tasks[0].uuid);
      for (const task of tasks) {
        if (stoppedFleetRef.current) break;
        fleetConnectTaskLogs(task.uuid);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setFleetRunError(msg);
      setRunStatus('error');
      setIsRunning(false);
    }
  };

  // Dragging state for nodes
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Connecting edge state
  const [connectingSource, setConnectingSource] = useState<{ nodeId: string; branch: CanvasEdgeState['branch'] } | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Pan and Zoom
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Canvas Container Ref
  const canvasRef = useRef<HTMLDivElement>(null);

  // Search filter for palette
  const [searchPalette, setSearchPalette] = useState('');

  // Re-run validation on every change
  const validation = useMemo(() => {
    const doc: FlowDocument = {
      version: 1,
      id: 'flow-canvas-active',
      name: flowName,
      entryNodeId,
      variables: [],
      nodes: nodes.map(n => ({
        ...n.config,
        id: n.id,
        type: n.type,
        name: n.name,
        timeoutMs: n.timeoutMs,
        retryCount: n.retryCount,
      } as FlowNode)),
      edges,
    };
    return validateFlow(doc);
  }, [nodes, edges, entryNodeId, flowName]);

  // Index errors by node and edge ID
  const errorsByNode = useMemo(() => {
    const map = new Map<string, FlowValidationError[]>();
    for (const err of validation.errors) {
      if (err.nodeId) {
        const list = map.get(err.nodeId) || [];
        list.push(err);
        map.set(err.nodeId, list);
      }
    }
    return map;
  }, [validation]);

  const errorsByEdge = useMemo(() => {
    const map = new Map<string, FlowValidationError[]>();
    for (const err of validation.errors) {
      if (err.edgeId) {
        const list = map.get(err.edgeId) || [];
        list.push(err);
        map.set(err.edgeId, list);
      }
    }
    return map;
  }, [validation]);

  // Handle Canvas Mouse Down (Panning)
  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    if (e.target === canvasRef.current || (e.target as HTMLElement).classList.contains('canvas-grid')) {
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
      if (e.button === 0) {
        setIsPanning(true);
        setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      }
    }
  };

  // Handle Mouse Move for Node Dragging or Edge Connecting or Panning
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isPanning) {
      setPan({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y,
      });
      return;
    }

    if (canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      setMousePos({
        x: e.clientX - rect.left - pan.x,
        y: e.clientY - rect.top - pan.y,
      });
    }

    if (draggingNodeId) {
      const newX = Math.round((e.clientX - dragOffset.x - pan.x) / 10) * 10;
      const newY = Math.round((e.clientY - dragOffset.y - pan.y) / 10) * 10;
      setNodes(prev =>
        prev.map(n => (n.id === draggingNodeId ? { ...n, x: Math.max(20, newX), y: Math.max(20, newY) } : n))
      );
    }
  }, [draggingNodeId, dragOffset, isPanning, panStart, pan]);

  const handleMouseUp = useCallback(() => {
    setDraggingNodeId(null);
    setIsPanning(false);
  }, []);

  // Palette Node Addition (Click or Drop)
  const handleAddNode = (type: FlowNodeType) => {
    const item = NODE_PALETTE.find(p => p.type === type);
    if (!item) return;

    const id = `node-${type}-${Date.now().toString().slice(-4)}`;
    // Position offset nicely
    const currentMaxX = nodes.reduce((max, n) => Math.max(max, n.x), 40);
    const newNode: CanvasNodeState = {
      id,
      type,
      name: `${item.label} ${nodes.length + 1}`,
      x: currentMaxX + 220,
      y: 120 + ((nodes.length % 3) * 60),
      config: JSON.parse(JSON.stringify(item.defaultConfig)),
    };

    setNodes(prev => [...prev, newNode]);
    setSelectedNodeId(id);
    setSelectedEdgeId(null);

    // If first node, make it entry
    if (nodes.length === 0) {
      setEntryNodeId(id);
    }
  };

  // Drag-and-drop from Palette into Canvas
  const handlePaletteDragStart = (e: React.DragEvent, type: FlowNodeType) => {
    e.dataTransfer.setData('application/flow-node-type', type);
  };

  const handleCanvasDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const type = e.dataTransfer.getData('application/flow-node-type') as FlowNodeType;
    if (!type) return;

    const item = NODE_PALETTE.find(p => p.type === type);
    if (!item || !canvasRef.current) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const dropX = Math.round((e.clientX - rect.left - pan.x - 90) / 10) * 10;
    const dropY = Math.round((e.clientY - rect.top - pan.y - 30) / 10) * 10;

    const id = `node-${type}-${Date.now().toString().slice(-4)}`;
    const newNode: CanvasNodeState = {
      id,
      type,
      name: `${item.label} ${nodes.length + 1}`,
      x: Math.max(20, dropX),
      y: Math.max(20, dropY),
      config: JSON.parse(JSON.stringify(item.defaultConfig)),
    };

    setNodes(prev => [...prev, newNode]);
    setSelectedNodeId(id);
    setSelectedEdgeId(null);
    if (nodes.length === 0) setEntryNodeId(id);
  };

  // ------------------------------------------------------------------
  // Flow recorder (Wave 2b): capture -> node through the SAME addNode path
  // ------------------------------------------------------------------

  // Append a recorded (or picker-chosen) node exactly like a hand-made one.
  const appendMappedNode = useCallback((flowNode: FlowNode) => {
    const node = flowNode as FlowNode & { id: string };
    const nodeType = node.type as FlowNodeType;
    const paletteItem = NODE_PALETTE.find(p => p.type === nodeType);
    setNodes(prev => {
      // The flow node already carries the palette-shaped config; split it
      // back into CanvasNodeState (id/type/name live outside config).
      const config = { ...(node as unknown as Record<string, unknown>) };
      delete config.id;
      delete config.type;
      delete config.name;
      const currentMaxX = prev.reduce((max, n) => Math.max(max, n.x), 40);
      const canvasNode: CanvasNodeState = {
        id: node.id,
        type: nodeType,
        name: node.name || paletteItem?.label || nodeType,
        x: currentMaxX + 220,
        y: 120 + ((prev.length % 3) * 60),
        config,
      };
      return [...prev, canvasNode];
    });
    setSelectedNodeId(node.id);
    setSelectedEdgeId(null);
    setEntryNodeId(prev => (prev ? prev : node.id));
  }, []);

  // Close any open recorder/picker socket (drops its in-page listeners).
  const disposeRecorderSocket = useCallback(() => {
    if (recorderSocketRef.current) {
      recorderSocketRef.current.close();
      recorderSocketRef.current = null;
    }
  }, []);

  const handleRecorderEvent = useCallback(
    (ev: MessageEvent) => {
      let frame: { type?: string; message?: string; record?: CaptureRecord; pick?: { selector: string | null; tag?: string; id?: string | null } };
      try {
        frame = JSON.parse(String(ev.data)) as { type?: string; message?: string; record?: CaptureRecord; pick?: { selector: string | null; tag?: string; id?: string | null } };
      } catch {
        return;
      }
      if (frame.type === 'record' && frame.record) {
        if (!recorderCoalescerRef.current) return;
        const now = ++recorderNowRef.current;
        const burst = recorderCoalescerRef.current.push(frame.record, now);
        for (const rec of burst) {
          const node = mapCapturedAction(rec, { human: recorderHuman });
          if (node) appendMappedNode(node);
        }
        return;
      }
      if (frame.type === 'picked' && frame.pick) {
        setPickerElement(frame.pick);
        setPickerOpen(true);
        // Picker served its purpose: flip back to inert so browsing is not captured.
        if (recorderSocketRef.current && recorderSocketRef.current.readyState === WebSocket.OPEN) {
          recorderSocketRef.current.send(JSON.stringify({ type: 'mode', mode: 'off' }));
        }
      }
      if (frame.type === 'recording_started') setRecorderError(null);
      if (frame.type === 'recording_stopped') {
        if (recorderCoalescerRef.current) {
          for (const rec of recorderCoalescerRef.current.flush()) {
            const node = mapCapturedAction(rec, { human: recorderHuman });
            if (node) appendMappedNode(node);
          }
        }
      }
      if (frame.type === 'error' && typeof frame.message === 'string') {
        setRecorderError(frame.message);
        setIsRecording(false);
      }
    },
    [appendMappedNode, recorderHuman]
  );

  /** Open the recorder bridge WS for a profile (used by both surfaces). */
  const openRecorderSocket = useCallback(
    (profileId: string, onEvent: (ev: MessageEvent) => void, onOpen: (ws: WebSocket) => void) => {
      try {
        const ws = new WebSocket(api.recorderWsUrl(profileId));
        ws.onmessage = onEvent;
        ws.onopen = () => onOpen(ws);
        ws.onerror = () => setRecorderError(t('Recorder connection failed'));
        return ws;
      } catch (err) {
        setRecorderError(t('Recorder connection failed'));
        return null;
      }
    },
    [t]
  );

  const handleStartRecording = () => {
    if (isRecording) return;
    const profileId = selectedProfileId || profiles[0]?.user_id;
    if (!profileId) return;
    disposeRecorderSocket();
    recorderCoalescerRef.current = new TypingCoalescer(250);
    recorderNowRef.current = 0;
    const ws = openRecorderSocket(
      profileId,
      handleRecorderEvent,
      (socket) => {
        socket.send(JSON.stringify({ type: 'start', human: recorderHuman }));
        setIsRecording(true);
      }
    );
    recorderSocketRef.current = ws;
  };

  const handleStopRecording = () => {
    if (recorderSocketRef.current && recorderSocketRef.current.readyState === WebSocket.OPEN) {
      recorderSocketRef.current.send(JSON.stringify({ type: 'stop' }));
      // Flush any pending burst locally as well, so a burst interrupted by
      // stop is still materialised as ONE node.
      if (recorderCoalescerRef.current) {
        for (const rec of recorderCoalescerRef.current.flush()) {
          const node = mapCapturedAction(rec, { human: recorderHuman });
          if (node) appendMappedNode(node);
        }
      }
    }
    disposeRecorderSocket();
    setIsRecording(false);
    recorderCoalescerRef.current = null;
  };

  // Element action picker (independent of recording)
  const openPicker = () => {
    if (isRecording) return; // the bridge is single-session — one surface at a time
    const profileId = selectedProfileId || profiles[0]?.user_id;
    if (!profileId) return;
    if (pickerElement) setPickerElement(null);
    pickerSocketRef.current?.close();
    const ws = openRecorderSocket(
      profileId,
      (ev) => {
        let frame: { type?: string; pick?: { selector: string | null; tag?: string; id?: string | null } };
        try {
          frame = JSON.parse(String(ev.data)) as { type?: string; pick?: { selector: string | null; tag?: string; id?: string | null } };
        } catch {
          return;
        }
        if (frame.type === 'picked' && frame.pick) {
          setPickerElement(frame.pick);
          setPickerOpen(true);
        }
      },
      (socket) => {
        socket.send(JSON.stringify({ type: 'mode', mode: 'picker' }));
        setPickerOpen(true);
      }
    );
    pickerSocketRef.current = ws;
  };

  const closePicker = () => {
    if (pickerSocketRef.current) {
      pickerSocketRef.current.close();
      pickerSocketRef.current = null;
    }
    setPickerOpen(false);
    setPickerElement(null);
  };

  const handlePickedAction = (action: 'click' | 'human_click' | 'type' | 'human_type' | 'wait' | 'extract') => {
    if (!pickerElement?.selector) return;
    const selector = pickerElement.selector;
    const record: CaptureRecord = { kind: 'click', selector };
    let node: FlowNode | null = null;
    switch (action) {
      case 'human_click':
        node = mapCapturedAction({ kind: 'click', selector }, { human: true });
        break;
      case 'type':
        node = mapCapturedAction({ kind: 'type', selector, text: '' }, {});
        break;
      case 'human_type':
        node = mapCapturedAction({ kind: 'type', selector, text: '' }, { human: true });
        break;
      case 'wait':
        node = mapCapturedAction({ kind: 'wait', selector, waitType: 'selector' });
        break;
      case 'extract':
        node = {
          type: 'extract',
          id: `node-extract-${Date.now().toString().slice(-4)}`,
          name: 'Extract Data',
          selector,
          variable: 'value',
        };
        break;
      case 'click':
      default:
        node = mapCapturedAction(record, {});
        break;
    }
    if (node) appendMappedNode(node);
    closePicker();
  };

  // Node Dragging Start
  const handleNodeMouseDown = (e: React.MouseEvent, node: CanvasNodeState) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    setSelectedNodeId(node.id);
    setSelectedEdgeId(null);
    setDraggingNodeId(node.id);

    if (canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      setDragOffset({
        x: e.clientX - rect.left - node.x,
        y: e.clientY - rect.top - node.y,
      });
    }
  };

  // Delete Selected Node
  const handleDeleteNode = (id: string) => {
    setNodes(prev => prev.filter(n => n.id !== id));
    setEdges(prev => prev.filter(e => e.source !== id && e.target !== id));
    if (selectedNodeId === id) setSelectedNodeId(null);
    if (entryNodeId === id) {
      const remaining = nodes.filter(n => n.id !== id);
      if (remaining.length > 0) setEntryNodeId(remaining[0].id);
    }
  };

  // Delete Selected Edge
  const handleDeleteEdge = (id: string) => {
    setEdges(prev => prev.filter(e => e.id !== id));
    if (selectedEdgeId === id) setSelectedEdgeId(null);
  };

  // Connect port click
  const handleStartConnect = (e: React.MouseEvent, nodeId: string, branch: CanvasEdgeState['branch'] = 'default') => {
    e.stopPropagation();
    setConnectingSource({ nodeId, branch });
  };

  const handleEndConnect = (e: React.MouseEvent, targetNodeId: string) => {
    e.stopPropagation();
    if (!connectingSource) return;
    if (connectingSource.nodeId === targetNodeId) {
      // Disallow self loop directly unless handled
      setConnectingSource(null);
      return;
    }

    const newEdgeId = `e-${connectingSource.nodeId}-${targetNodeId}-${connectingSource.branch}-${Date.now().toString().slice(-4)}`;
    // Avoid duplicate identical edge
    const exists = edges.some(
      e => e.source === connectingSource.nodeId && e.target === targetNodeId && e.branch === connectingSource.branch
    );

    if (!exists) {
      const newEdge: CanvasEdgeState = {
        id: newEdgeId,
        source: connectingSource.nodeId,
        target: targetNodeId,
        branch: connectingSource.branch,
      };
      setEdges(prev => [...prev, newEdge]);
      setSelectedEdgeId(newEdgeId);
    }

    setConnectingSource(null);
  };

  // Update Config Field
  const handleUpdateConfig = (key: string, value: unknown) => {
    if (!selectedNodeId) return;
    setNodes(prev =>
      prev.map(n => {
        if (n.id === selectedNodeId) {
          return {
            ...n,
            config: {
              ...n.config,
              [key]: value,
            },
          };
        }
        return n;
      })
    );
  };

  // Update Node Common Properties
  const handleUpdateNodeProp = (key: 'name' | 'timeoutMs' | 'retryCount', value: unknown) => {
    if (!selectedNodeId) return;
    setNodes(prev =>
      prev.map(n => {
        if (n.id === selectedNodeId) {
          return {
            ...n,
            [key]: value,
          };
        }
        return n;
      })
    );
  };

  const selectedNode = nodes.find(n => n.id === selectedNodeId);
  const selectedEdge = edges.find(e => e.id === selectedEdgeId);

  // Filtered palette
  const filteredPalette = useMemo(() => {
    if (!searchPalette.trim()) return NODE_PALETTE;
    const q = searchPalette.toLowerCase();
    return NODE_PALETTE.filter(p => p.label.toLowerCase().includes(q) || p.type.toLowerCase().includes(q));
  }, [searchPalette]);

  return (
    <div
      className="flow-canvas-container"
      data-testid="flow-canvas"
      style={{
        display: 'flex',
        width: '100%',
        height: '100%',
        position: 'relative',
        background: 'var(--bg-app)',
        color: 'var(--text)',
        overflow: 'hidden',
        userSelect: 'none',
      }}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {/* 1. Node Palette Sidebar */}
      <div
        className="flow-palette-sidebar"
        data-testid="node-palette"
        style={{
          width: 260,
          borderRight: '1px solid var(--border)',
          background: 'var(--panel)',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 10,
          flexShrink: 0,
        }}
      >
        <div style={{ padding: '16px 14px 12px', borderBottom: '1px solid var(--divider)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
              Nodes Palette
            </span>
            <span style={{ fontSize: 11, background: 'var(--control-bg-hover)', padding: '2px 6px', borderRadius: 'var(--radius-sm)', color: 'var(--text-secondary)' }}>
              {NODE_PALETTE.length}
            </span>
          </div>
          <input
            type="text"
            data-testid="palette-search-input"
            placeholder="Filter nodes..."
            value={searchPalette}
            onChange={e => setSearchPalette(e.target.value)}
            style={{
              width: '100%',
              padding: '6px 10px',
              fontSize: 12,
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              color: 'var(--text)',
              outline: 'none',
            }}
          />
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {filteredPalette.map(item => (
            <div
              key={item.type}
              data-testid={`palette-item-${item.type}`}
              draggable
              onDragStart={e => handlePaletteDragStart(e, item.type)}
              onClick={() => handleAddNode(item.type)}
              style={{
                padding: '10px 12px',
                borderRadius: 8,
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
                cursor: 'grab',
                transition: 'all 0.15s ease',
                display: 'flex',
                flexDirection: 'column',
                gap: 3,
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-focus)';
                (e.currentTarget as HTMLElement).style.background = 'var(--surface-3)';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)';
                (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)';
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{item.label}</span>
                <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>{item.category}</span>
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.3 }}>{item.description}</span>
            </div>
          ))}
        </div>

        {/* Validation Status summary footer */}
        <div
          data-testid="palette-validation-summary"
          style={{
            padding: '12px 14px',
            borderTop: '1px solid var(--divider)',
            background: validation.valid ? 'var(--control-bg)' : 'var(--control-bg-active)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: validation.valid ? 'var(--ok)' : 'var(--text-muted)',
                boxShadow: validation.valid ? 'var(--shadow-sm)' : 'none',
              }}
            />
            <span style={{ fontSize: 12, fontWeight: 600, color: validation.valid ? 'var(--text)' : 'var(--text-secondary)' }}>
              {validation.valid ? 'Flow Valid' : `${validation.errors.length} Issue(s)`}
            </span>
          </div>
          <button
            data-testid="entry-badge"
            title="Current Entry Node"
            style={{
              fontSize: 10,
              padding: '2px 6px',
              borderRadius: 4,
              background: 'rgba(255,255,255,0.1)',
              color: 'var(--text-secondary)',
              border: 'none',
            }}
          >
            Entry: {entryNodeId}
          </button>
        </div>
      </div>

      {/* 2. Main Canvas Working Area */}
      <div
        ref={canvasRef}
        className="flow-canvas-workspace"
        data-testid="canvas-workspace"
        onMouseDown={handleCanvasMouseDown}
        onDragOver={e => e.preventDefault()}
        onDrop={handleCanvasDrop}
        style={{
          flex: 1,
          position: 'relative',
          overflow: 'hidden',
          cursor: isPanning ? 'grabbing' : 'default',
          backgroundImage:
            'radial-gradient(circle, var(--divider) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
          backgroundPosition: `${pan.x}px ${pan.y}px`,
        }}
      >
        {/* Top Floating Control Bar */}
        <div
          style={{
            position: 'absolute',
            top: 14,
            left: 16,
            zIndex: 20,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: 'var(--panel)',
            backdropFilter: 'blur(12px)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '6px 12px',
          }}
        >
          <input
            type="text"
            data-testid="flow-name-input"
            value={flowName}
            onChange={e => setFlowName(e.target.value)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text)',
              fontSize: 13,
              fontWeight: 600,
              outline: 'none',
              width: 180,
            }}
          />
          <div style={{ width: 1, height: 16, background: 'var(--divider)' }} />
          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
            {nodes.length} nodes, {edges.length} edges
          </span>
          <button
            data-testid="btn-reset-pan"
            onClick={() => setPan({ x: 0, y: 0 })}
            style={{
              background: 'rgba(255,255,255,0.08)',
              border: 'none',
              color: 'var(--text-secondary)',
              fontSize: 11,
              padding: '3px 8px',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            Reset View
          </button>
          <div style={{ width: 1, height: 16, background: 'var(--divider)' }} />
          {/* Profile picker & Run action */}
          {profiles.length > 0 && (
            <select
              data-testid="live-run-profile-select"
              value={selectedProfileId}
              onChange={e => setSelectedProfileId(e.target.value)}
              style={{
                background: 'var(--surface-2)',
                color: 'var(--text)',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 4,
                fontSize: 11,
                padding: '3px 6px',
                outline: 'none',
              }}
            >
              {profiles.map(p => (
                <option key={p.user_id} value={p.user_id}>
                  {p.name || p.user_id}
                </option>
              ))}
            </select>
          )}
          {/* Multi-profile fleet scope: optional extra profiles + concurrency.
              Leaving the multi-select empty defaults the fleet run to the
              single-profile behaviour (one profile, concurrency 1). */}
          {profiles.length > 0 && (
            <select
              multiple
              size={1}
              data-testid="fleet-profile-multi-select"
              value={selectedProfileIds}
              onChange={e => {
                const picked = Array.from(e.target.selectedOptions).map(o => o.value);
                setSelectedProfileIds(picked);
              }}
              title={t('Select profiles for a fleet run')}
              style={{
                background: 'var(--surface-2)',
                color: 'var(--text)',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 4,
                fontSize: 11,
                padding: '2px 4px',
                outline: 'none',
                minWidth: 24,
                maxWidth: 160,
              }}
            >
              {profiles.map(p => (
                <option key={p.user_id} value={p.user_id}>
                  {p.name || p.user_id}
                </option>
              ))}
            </select>
          )}
          <label
            data-testid="concurrency-label"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 10,
              color: 'var(--text-secondary)',
            }}
          >
            {t('Concurrency')}
            <input
              type="number"
              min={1}
              max={5}
              data-testid="fleet-concurrency-input"
              value={concurrency}
              onChange={e => setConcurrency(Math.max(1, parseInt(e.target.value, 10) || 1))}
              style={{
                width: 42,
                background: 'var(--surface-2)',
                color: 'var(--text)',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 4,
                fontSize: 11,
                padding: '2px 4px',
                outline: 'none',
              }}
            />
          </label>
          {/* Flow recorder controls (Wave 2b) */}
          <label
            data-testid="recorder-human-toggle"
            title={t('Human input')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 10,
              color: recorderHuman ? 'var(--text)' : 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={recorderHuman}
              onChange={e => setRecorderHuman(e.target.checked)}
              style={{ cursor: 'pointer' }}
            />
            Human
          </label>
          {isRecording ? (
            <button
              data-testid="btn-stop-recording"
              onClick={handleStopRecording}
              style={{
                background: 'var(--text)',
                color: 'var(--bg-app)',
                fontWeight: 700,
                border: 'none',
                fontSize: 11,
                padding: '4px 10px',
                borderRadius: 4,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <span
                data-testid="recording-indicator"
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: 'var(--bg-app)',
                  boxShadow: '0 0 6px var(--bg-app)',
                }}
              />
              {t('Stop Recording')}
            </button>
          ) : (
            <button
              data-testid="btn-start-recording"
              onClick={handleStartRecording}
              style={{
                background: 'var(--control-bg-active)',
                border: '1px solid var(--border-focus)',
                color: 'var(--text-secondary)',
                fontWeight: 700,
                fontSize: 11,
                padding: '4px 10px',
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              ● {t('Record actions')}
            </button>
          )}
          <button
            data-testid="btn-element-picker"
            onClick={openPicker}
            disabled={isRecording}
            title={t('Pick element')}
            style={{
              background: pickerOpen ? 'var(--control-bg-selected)' : 'var(--control-bg)',
              border: pickerOpen ? '1px solid var(--border-focus)' : '1px solid var(--border)',
              color: pickerOpen ? 'var(--text)' : 'var(--text-secondary)',
              fontSize: 11,
              padding: '4px 8px',
              borderRadius: 4,
              cursor: isRecording ? 'not-allowed' : 'pointer',
              opacity: isRecording ? 0.5 : 1,
            }}
          >
            {t('Pick element')}
          </button>
          {recorderError && (
            <span
              data-testid="recorder-error"
              style={{
                fontSize: 10,
                color: 'var(--text)', background: 'var(--control-bg-active)',
                padding: '2px 8px',
                borderRadius: 4,
              }}
            >
              {recorderError}
            </span>
          )}
          <button
            data-testid="btn-run-flow"
            onClick={handleRunFlow}
            disabled={isRunning}
            style={{
              background: isRunning ? 'var(--control-bg-selected)' : 'var(--accent)', color: isRunning ? 'var(--text-secondary)' : 'var(--bg-app)',
              fontWeight: 700,
              border: 'none',
              fontSize: 11,
              padding: '4px 10px',
              borderRadius: 4,
              cursor: isRunning ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            {isRunning ? 'Running...' : '▶ Run Flow'}
          </button>
          <button
            data-testid="btn-run-fleet"
            onClick={handleRunFleet}
            disabled={isRunning || (fleetState?.profiles.some(p => p.status === 'queued' || p.status === 'working') ?? false)}
            title={t('Run Fleet')}
            style={{
              background:
                isRunning || (fleetState?.profiles.some(p => p.status === 'queued' || p.status === 'working') ?? false)
                  ? 'var(--control-bg)'
                  : 'var(--control-bg-active)',
              color:
                isRunning || (fleetState?.profiles.some(p => p.status === 'queued' || p.status === 'working') ?? false)
                  ? 'var(--text-muted)'
                  : 'var(--text)',
              fontWeight: 700,
              border: '1px solid var(--border)',
              fontSize: 11,
              padding: '4px 10px',
              borderRadius: 4,
              cursor:
                isRunning || (fleetState?.profiles.some(p => p.status === 'queued' || p.status === 'working') ?? false)
                  ? 'not-allowed'
                  : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            {t('Run Fleet')}
          </button>
          <button
            data-testid="btn-toggle-live-run"
            onClick={() => setShowLiveRun(v => !v)}
            style={{
              background: showLiveRun ? 'var(--control-bg-selected)' : 'var(--control-bg)',
              color: showLiveRun ? 'var(--text)' : 'var(--text-secondary)',
              border: showLiveRun ? '1px solid var(--border-focus)' : '1px solid var(--border)',
              fontSize: 11,
              padding: '4px 8px',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            {showLiveRun ? 'Hide Live Run' : 'Live Run'}
          </button>
        </div>

        {/* Canvas SVG Layer for Rendering Edges */}
        <svg
          data-testid="canvas-edges-layer"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            overflow: 'visible',
          }}
        >
          <defs>
            <marker
              id="arrow-default"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 10 5 L 0 9 z" style={{ fill: 'var(--text-muted)' }} />
            </marker>
            <marker
              id="arrow-selected"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 10 5 L 0 9 z" style={{ fill: 'var(--text)' }} />
            </marker>
            <marker
              id="arrow-error"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 10 5 L 0 9 z" style={{ fill: 'var(--text-secondary)' }} />
            </marker>
          </defs>

          {/* Render Existing Edges */}
          {edges.map(edge => {
            const srcNode = nodes.find(n => n.id === edge.source);
            const tgtNode = nodes.find(n => n.id === edge.target);
            if (!srcNode || !tgtNode) return null;

            // Output port position
            const sx = srcNode.x + pan.x + 200;
            const sy = srcNode.y + pan.y + 40;
            // Input port position
            const tx = tgtNode.x + pan.x;
            const ty = tgtNode.y + pan.y + 40;

            const isSelected = selectedEdgeId === edge.id;
            const hasError = errorsByEdge.has(edge.id);

            // Smooth cubic bezier curve
            const dx = Math.max(Math.abs(tx - sx) * 0.5, 40);
            const pathData = `M ${sx} ${sy} C ${sx + dx} ${sy}, ${tx - dx} ${ty}, ${tx} ${ty}`;

            return (
              <g key={edge.id} style={{ pointerEvents: 'auto' }}>
                <path
                  d={pathData}
                  fill="none"
                  stroke="transparent"
                  strokeWidth="14"
                  style={{ cursor: 'pointer' }}
                  onClick={e => {
                    e.stopPropagation();
                    setSelectedEdgeId(edge.id);
                    setSelectedNodeId(null);
                  }}
                />
                <path
                  data-testid={`edge-${edge.id}`}
                  d={pathData}
                  fill="none"
                  style={{
                    stroke: hasError ? 'var(--text-secondary)' : isSelected ? 'var(--text)' : 'var(--text-muted)',
                    cursor: 'pointer',
                    transition: 'stroke 0.15s ease',
                  }}
                  strokeWidth={isSelected ? 2.5 : 1.5}
                  strokeDasharray={edge.branch !== 'default' ? '4 3' : undefined}
                  markerEnd={
                    hasError ? 'url(#arrow-error)' : isSelected ? 'url(#arrow-selected)' : 'url(#arrow-default)'
                  }
                  onClick={e => {
                    e.stopPropagation();
                    setSelectedEdgeId(edge.id);
                    setSelectedNodeId(null);
                  }}
                />
                {/* Branch Label Badge */}
                {edge.branch && edge.branch !== 'default' && (
                  <text
                    x={(sx + tx) / 2}
                    y={(sy + ty) / 2 - 8}
                    style={{ fill: 'var(--text)', background: 'var(--panel)', padding: '2px 4px' }}
                    fontSize="10"
                  >
                    {edge.branch}
                  </text>
                )}
              </g>
            );
          })}

          {/* Active Connecting Edge Line */}
          {connectingSource && (
            (() => {
              const src = nodes.find(n => n.id === connectingSource.nodeId);
              if (!src) return null;
              const sx = src.x + pan.x + 200;
              const sy = src.y + pan.y + 40;
              const tx = mousePos.x + pan.x;
              const ty = mousePos.y + pan.y;
              const dx = Math.max(Math.abs(tx - sx) * 0.5, 30);
              const pathData = `M ${sx} ${sy} C ${sx + dx} ${sy}, ${tx - dx} ${ty}, ${tx} ${ty}`;
              return (
                <path
                  data-testid="active-connecting-edge"
                  d={pathData}
                  fill="none"
                  style={{ stroke: 'var(--text-secondary)' }}
                  strokeWidth="2"
                  strokeDasharray="4 4"
                />
              );
            })()
          )}
        </svg>

        {/* Render Canvas Nodes */}
        {nodes.map(node => {
          const isSelected = selectedNodeId === node.id;
          const isEntry = entryNodeId === node.id;
          const nodeErrors = errorsByNode.get(node.id) || [];
          const hasError = nodeErrors.length > 0;

          return (
            <div
              key={node.id}
              data-testid={`flow-node-${node.id}`}
              className={`flow-node ${isSelected ? 'selected' : ''} ${hasError ? 'error' : ''}`}
              onMouseDown={e => handleNodeMouseDown(e, node)}
              style={{
                position: 'absolute',
                left: node.x + pan.x,
                top: node.y + pan.y,
                width: 200,
                borderRadius: 10,
                background: isSelected ? 'var(--surface-3)' : 'var(--surface-1)',
                border: hasError ? '1.5px dashed var(--border-focus)' : isSelected ? '1.5px solid var(--text)' : '1px solid var(--border)',
                boxShadow: isSelected
                  ? '0 8px 24px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.2)'
                  : '0 4px 14px rgba(0,0,0,0.5)',
                transition: 'border 0.15s ease, box-shadow 0.15s ease',
                zIndex: isSelected ? 15 : 5,
                cursor: draggingNodeId === node.id ? 'grabbing' : 'grab',
              }}
            >
              {/* Input Port (Left) */}
              <div
                data-testid={`port-in-${node.id}`}
                onClick={e => handleEndConnect(e, node.id)}
                title="Connect input edge here"
                style={{
                  position: 'absolute',
                  left: -7,
                  top: 36,
                  width: 14,
                  height: 14,
                  borderRadius: '50%',
                  background: 'var(--bg-app)',
                  border: '2px solid var(--text-muted)',
                  cursor: 'pointer',
                  zIndex: 20,
                  transition: 'transform 0.15s ease, border-color 0.15s ease',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.transform = 'scale(1.25)';
                  (e.currentTarget as HTMLElement).style.borderColor = 'var(--text)';
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.transform = 'scale(1)';
                  (e.currentTarget as HTMLElement).style.borderColor = 'var(--text-muted)';
                }}
              />

              {/* Node Header */}
              <div
                style={{
                  padding: '10px 12px 8px',
                  borderBottom: '1px solid var(--divider)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {isEntry && (
                    <span
                      title="Entry Node"
                      style={{
                        fontSize: 9,
                        background: 'rgba(255,255,255,0.12)',
                        color: 'var(--text)',
                        fontWeight: 700,
                        padding: '1px 5px',
                        borderRadius: 3,
                        textTransform: 'uppercase',
                      }}
                    >
                      Start
                    </span>
                  )}
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 600 }}>
                    {node.type}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  {hasError && (
                    <span
                      data-testid={`error-marker-${node.id}`}
                      title={nodeErrors.map(e => e.message).join('\n')}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 16,
                        height: 16,
                        borderRadius: '50%',
                        background: 'var(--text)',
                        color: 'var(--bg-app)',
                        fontSize: 10,
                        fontWeight: 700,
                      }}
                    >
                      !
                    </span>
                  )}
                  <button
                    data-testid={`btn-delete-node-${node.id}`}
                    onClick={e => {
                      e.stopPropagation();
                      handleDeleteNode(node.id);
                    }}
                    title="Delete Node"
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--text-muted)',
                      fontSize: 13,
                      cursor: 'pointer',
                      padding: '2px 4px',
                      borderRadius: 4,
                    }}
                    onMouseEnter={e => ((e.currentTarget as HTMLElement).style.color = 'var(--text)')}
                    onMouseLeave={e => ((e.currentTarget as HTMLElement).style.color = 'var(--text-muted)')}
                  >
                    ×
                  </button>
                </div>
              </div>

              {/* Node Body */}
              <div style={{ padding: '8px 12px 10px' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>
                  {node.name}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--text-muted)',
                    fontFamily: 'var(--font-mono)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {node.type === 'navigate' && `URL: ${String(node.config.url || '')}`}
                  {node.type === 'click' && `Selector: ${String(node.config.selector || '')}`}
                  {node.type === 'human_click' && `Selector: ${String(node.config.selector || '')}`}
                  {node.type === 'human_type' && `Text: "${String(node.config.text || '')}"`}
                  {node.type === 'type' && `Text: "${String(node.config.text || '')}"`}
                  {node.type === 'wait' && `${node.config.mode}: ${String(node.config.durationMs || node.config.selector || '')}`}
                  {node.type === 'condition' && `Expr: ${String(node.config.expression || '')}`}
                  {node.type === 'loop' && `Count: ${String(node.config.count || '')}`}
                  {node.type === 'extract' && `Var: ${String(node.config.targetVariable || '')}`}
                  {node.type === 'eval' && `Code: ${String(node.config.code || '').slice(0, 20)}...`}
                  {node.type === 'screenshot' && `Path: ${String(node.config.path || '')}`}
                  {(node.type as string) === 'subflow' && `Subflow: ${String(node.config.flowId || '')}`}
                </div>

                {/* Inline error display */}
                {hasError && (
                  <div
                    data-testid={`inline-node-error-${node.id}`}
                    style={{
                      marginTop: 6,
                      padding: '4px 6px',
                      borderRadius: 4,
                      background: 'var(--control-bg-active)',
                      border: '1px solid var(--border)',
                      color: 'var(--text-secondary)',
                      fontSize: 10,
                      lineHeight: 1.2,
                    }}
                  >
                    {nodeErrors[0].message}
                  </div>
                )}
              </div>

              {/* Output Port (Right) */}
              <div
                data-testid={`port-out-${node.id}`}
                onClick={e => handleStartConnect(e, node.id, 'default')}
                title="Click and drag/click to connect output"
                style={{
                  position: 'absolute',
                  right: -7,
                  top: 36,
                  width: 14,
                  height: 14,
                  borderRadius: '50%',
                  background: 'var(--bg-app)',
                  border: '2px solid var(--text-muted)',
                  cursor: 'crosshair',
                  zIndex: 20,
                  transition: 'transform 0.15s ease, border-color 0.15s ease',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.transform = 'scale(1.25)';
                  (e.currentTarget as HTMLElement).style.borderColor = 'var(--text)';
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.transform = 'scale(1)';
                  (e.currentTarget as HTMLElement).style.borderColor = 'var(--text-muted)';
                }}
              />

              {/* Special condition branch output ports */}
              {node.type === 'condition' && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '0 8px 6px', gap: 6 }}>
                  <button
                    data-testid={`port-out-branch-true-${node.id}`}
                    onClick={e => handleStartConnect(e, node.id, 'true')}
                    style={{
                      fontSize: 9,
                      padding: '2px 5px',
                      background: 'var(--control-bg-active)',
                      border: '1px solid var(--border)',
                      color: 'var(--text)',
                      borderRadius: 4,
                      cursor: 'crosshair',
                    }}
                  >
                    + True
                  </button>
                  <button
                    data-testid={`port-out-branch-false-${node.id}`}
                    onClick={e => handleStartConnect(e, node.id, 'false')}
                    style={{
                      fontSize: 9,
                      padding: '2px 5px',
                      background: 'var(--control-bg-active)',
                      border: '1px solid var(--border)',
                      color: 'var(--text-secondary)',
                      borderRadius: 4,
                      cursor: 'crosshair',
                    }}
                  >
                    + False
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 3. Configuration Form Inspector (Right Panel) */}
      <div
        className="flow-config-inspector"
        data-testid="config-inspector"
        style={{
          width: 320,
          borderLeft: '1px solid var(--border)',
          background: 'var(--panel)',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 10,
          flexShrink: 0,
        }}
      >
        <div style={{ padding: '16px 16px 12px', borderBottom: '1px solid var(--divider)' }}>
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
            Inspector & Config
          </span>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {selectedEdge && (
            <div data-testid="edge-config-form" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Connection Edge</span>
                <button
                  data-testid="btn-delete-selected-edge"
                  onClick={() => handleDeleteEdge(selectedEdge.id)}
                  style={{
                    background: 'var(--control-bg-active)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-secondary)',
                    fontSize: 11,
                    padding: '3px 8px',
                    borderRadius: 4,
                    cursor: 'pointer',
                  }}
                >
                  Delete Edge
                </button>
              </div>

              <div>
                <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                  Source Node
                </label>
                <input
                  type="text"
                  disabled
                  value={selectedEdge.source}
                  style={{
                    width: '100%',
                    padding: '6px 10px',
                    fontSize: 12,
                    background: 'var(--surface-2)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    color: 'var(--text-muted)',
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                  Target Node
                </label>
                <input
                  type="text"
                  disabled
                  value={selectedEdge.target}
                  style={{
                    width: '100%',
                    padding: '6px 10px',
                    fontSize: 12,
                    background: 'var(--surface-2)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    color: 'var(--text-muted)',
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                  Branch Condition
                </label>
                <select
                  data-testid="edge-branch-select"
                  value={selectedEdge.branch || 'default'}
                  onChange={e => {
                    const branch = e.target.value as CanvasEdgeState['branch'];
                    setEdges(prev =>
                      prev.map(edge => (edge.id === selectedEdge.id ? { ...edge, branch } : edge))
                    );
                  }}
                  style={{
                    width: '100%',
                    padding: '6px 10px',
                    fontSize: 12,
                    background: 'var(--surface-2)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    color: 'var(--text)',
                  }}
                >
                  <option value="default">Default / Next</option>
                  <option value="true">True (Condition)</option>
                  <option value="false">False (Condition)</option>
                  <option value="error">Error / Fallback</option>
                </select>
              </div>
            </div>
          )}

          {!selectedEdge && selectedNode && (
            <div data-testid="node-config-form" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Header & Delete */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
                  Node: {selectedNode.type}
                </span>
                <div style={{ display: 'flex', gap: 6 }}>
                  {entryNodeId !== selectedNode.id && (
                    <button
                      data-testid="btn-set-entry-node"
                      onClick={() => setEntryNodeId(selectedNode.id)}
                      style={{
                        background: 'rgba(255,255,255,0.08)',
                        border: '1px solid rgba(255,255,255,0.15)',
                        color: 'var(--text-secondary)',
                        fontSize: 11,
                        padding: '3px 8px',
                        borderRadius: 4,
                        cursor: 'pointer',
                      }}
                    >
                      Make Start
                    </button>
                  )}
                  <button
                    data-testid="btn-delete-inspected-node"
                    onClick={() => handleDeleteNode(selectedNode.id)}
                    style={{
                      background: 'var(--control-bg-active)',
                      border: '1px solid var(--border)',
                      color: 'var(--text-secondary)',
                      fontSize: 11,
                      padding: '3px 8px',
                      borderRadius: 4,
                      cursor: 'pointer',
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>

              {/* Node ID */}
              <div>
                <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Node ID</label>
                <input
                  type="text"
                  disabled
                  value={selectedNode.id}
                  style={{
                    width: '100%',
                    padding: '6px 10px',
                    fontSize: 12,
                    background: 'var(--surface-2)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    color: 'var(--text-muted)',
                  }}
                />
              </div>

              {/* Node Label / Name */}
              <div>
                <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Display Name</label>
                <input
                  type="text"
                  data-testid="input-node-name"
                  value={selectedNode.name || ''}
                  onChange={e => handleUpdateNodeProp('name', e.target.value)}
                  style={{
                    width: '100%',
                    padding: '6px 10px',
                    fontSize: 12,
                    background: 'var(--surface-2)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    color: 'var(--text)',
                  }}
                />
              </div>

              {/* Dynamic Type-specific Form Controls Bound to Schema */}
              <div style={{ height: 1, background: 'var(--divider)', margin: '4px 0' }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>Step Parameters</span>

              {/* NAVIGATE CONFIG */}
              {selectedNode.type === 'navigate' && (
                <>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Target URL</label>
                    <input
                      type="text"
                      data-testid="config-url"
                      placeholder="https://..."
                      value={String(selectedNode.config.url || '')}
                      onChange={e => handleUpdateConfig('url', e.target.value)}
                      style={{
                        width: '100%',
                        padding: '6px 10px',
                        fontSize: 12,
                        background: 'var(--surface-2)',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        color: 'var(--text)',
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Timeout (ms)</label>
                    <input
                      type="number"
                      data-testid="config-timeoutMs"
                      value={Number(selectedNode.config.timeoutMs || 30000)}
                      onChange={e => handleUpdateConfig('timeoutMs', parseInt(e.target.value, 10) || 0)}
                      style={{
                        width: '100%',
                        padding: '6px 10px',
                        fontSize: 12,
                        background: 'var(--surface-2)',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        color: 'var(--text)',
                      }}
                    />
                  </div>
                </>
              )}

              {/* CLICK CONFIG */}
              {selectedNode.type === 'click' && (
                <>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>CSS Selector</label>
                    <input
                      type="text"
                      data-testid="config-selector"
                      placeholder="#btn, .item"
                      value={String(selectedNode.config.selector || '')}
                      onChange={e => handleUpdateConfig('selector', e.target.value)}
                      style={{
                        width: '100%',
                        padding: '6px 10px',
                        fontSize: 12,
                        background: 'var(--surface-2)',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        color: 'var(--text)',
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Click Count</label>
                    <input
                      type="number"
                      data-testid="config-clickCount"
                      value={Number(selectedNode.config.clickCount || 1)}
                      onChange={e => handleUpdateConfig('clickCount', parseInt(e.target.value, 10) || 1)}
                      style={{
                        width: '100%',
                        padding: '6px 10px',
                        fontSize: 12,
                        background: 'var(--surface-2)',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        color: 'var(--text)',
                      }}
                    />
                  </div>
                </>
              )}

              {/* TYPE CONFIG */}
              {selectedNode.type === 'type' && (
                <>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Input Selector</label>
                    <input
                      type="text"
                      data-testid="config-selector"
                      value={String(selectedNode.config.selector || '')}
                      onChange={e => handleUpdateConfig('selector', e.target.value)}
                      style={{
                        width: '100%',
                        padding: '6px 10px',
                        fontSize: 12,
                        background: 'var(--surface-2)',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        color: 'var(--text)',
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Text Content</label>
                    <textarea
                      rows={3}
                      data-testid="config-text"
                      value={String(selectedNode.config.text || '')}
                      onChange={e => handleUpdateConfig('text', e.target.value)}
                      style={{
                        width: '100%',
                        padding: '6px 10px',
                        fontSize: 12,
                        background: 'var(--surface-2)',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        color: 'var(--text)',
                        fontFamily: 'var(--font-mono)',
                      }}
                    />
                  </div>
                </>
              )}

              {/* HUMAN_CLICK CONFIG */}
              {selectedNode.type === 'human_click' && (
                <>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Target Selector</label>
                    <input
                      type="text"
                      data-testid="config-selector"
                      value={String(selectedNode.config.selector || '')}
                      onChange={e => handleUpdateConfig('selector', e.target.value)}
                      style={{
                        width: '100%',
                        padding: '6px 10px',
                        fontSize: 12,
                        background: 'var(--surface-2)',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        color: 'var(--text)',
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Target Width (px, feeds Fitts's law)</label>
                    <input
                      type="number"
                      data-testid="config-targetWidth"
                      value={Number(selectedNode.config.targetWidth || 40)}
                      onChange={e => handleUpdateConfig('targetWidth', parseInt(e.target.value, 10) || 40)}
                      style={{
                        width: '100%',
                        padding: '6px 10px',
                        fontSize: 12,
                        background: 'var(--surface-2)',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        color: 'var(--text)',
                      }}
                    />
                  </div>
                </>
              )}

              {/* HUMAN_TYPE CONFIG */}
              {selectedNode.type === 'human_type' && (
                <>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Input Selector</label>
                    <input
                      type="text"
                      data-testid="config-selector"
                      value={String(selectedNode.config.selector || '')}
                      onChange={e => handleUpdateConfig('selector', e.target.value)}
                      style={{
                        width: '100%',
                        padding: '6px 10px',
                        fontSize: 12,
                        background: 'var(--surface-2)',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        color: 'var(--text)',
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Text Content</label>
                    <textarea
                      rows={3}
                      data-testid="config-text"
                      value={String(selectedNode.config.text || '')}
                      onChange={e => handleUpdateConfig('text', e.target.value)}
                      style={{
                        width: '100%',
                        padding: '6px 10px',
                        fontSize: 12,
                        background: 'var(--surface-2)',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        color: 'var(--text)',
                        fontFamily: 'var(--font-mono)',
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Allow Typos (human typo model)</label>
                    <select
                      data-testid="config-allowTypos"
                      value={selectedNode.config.allowTypos ? 'true' : 'false'}
                      onChange={e => handleUpdateConfig('allowTypos', e.target.value === 'true')}
                      style={{
                        width: '100%',
                        padding: '6px 10px',
                        fontSize: 12,
                        background: 'var(--surface-2)',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        color: 'var(--text)',
                      }}
                    >
                      <option value="false">No — type exactly</option>
                      <option value="true">Yes — occasional typos with correction</option>
                    </select>
                  </div>
                </>
              )}

              {/* WAIT CONFIG */}
              {selectedNode.type === 'wait' && (
                <>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Wait Mode</label>
                    <select
                      data-testid="config-mode"
                      value={String(selectedNode.config.mode || 'time')}
                      onChange={e => handleUpdateConfig('mode', e.target.value)}
                      style={{
                        width: '100%',
                        padding: '6px 10px',
                        fontSize: 12,
                        background: 'var(--surface-2)',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        color: 'var(--text)',
                      }}
                    >
                      <option value="time">Duration (ms)</option>
                      <option value="selector">Until Selector Visible</option>
                      <option value="navigation">Until Page Navigation</option>
                    </select>
                  </div>
                  {selectedNode.config.mode === 'selector' ? (
                    <div>
                      <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Selector to Wait For</label>
                      <input
                        type="text"
                        data-testid="config-selector"
                        value={String(selectedNode.config.selector || '')}
                        onChange={e => handleUpdateConfig('selector', e.target.value)}
                        style={{
                          width: '100%',
                          padding: '6px 10px',
                          fontSize: 12,
                          background: 'var(--surface-2)',
                          border: '1px solid var(--border)',
                          borderRadius: 6,
                          color: 'var(--text)',
                        }}
                      />
                    </div>
                  ) : (
                    <div>
                      <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Duration (ms)</label>
                      <input
                        type="number"
                        data-testid="config-durationMs"
                        value={Number(selectedNode.config.durationMs || 1000)}
                        onChange={e => handleUpdateConfig('durationMs', parseInt(e.target.value, 10) || 0)}
                        style={{
                          width: '100%',
                          padding: '6px 10px',
                          fontSize: 12,
                          background: 'var(--surface-2)',
                          border: '1px solid var(--border)',
                          borderRadius: 6,
                          color: 'var(--text)',
                        }}
                      />
                    </div>
                  )}
                </>
              )}

              {/* CONDITION CONFIG */}
              {selectedNode.type === 'condition' && (
                <>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>JavaScript Expression</label>
                    <input
                      type="text"
                      data-testid="config-expression"
                      placeholder="vars.count > 10"
                      value={String(selectedNode.config.expression || '')}
                      onChange={e => handleUpdateConfig('expression', e.target.value)}
                      style={{
                        width: '100%',
                        padding: '6px 10px',
                        fontSize: 12,
                        background: 'var(--surface-2)',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        color: 'var(--text)',
                        fontFamily: 'var(--font-mono)',
                      }}
                    />
                  </div>
                </>
              )}

              {/* LOOP CONFIG */}
              {selectedNode.type === 'loop' && (
                <>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Iterations Count</label>
                    <input
                      type="number"
                      data-testid="config-count"
                      value={Number(selectedNode.config.count || 1)}
                      onChange={e => handleUpdateConfig('count', parseInt(e.target.value, 10) || 1)}
                      style={{
                        width: '100%',
                        padding: '6px 10px',
                        fontSize: 12,
                        background: 'var(--surface-2)',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        color: 'var(--text)',
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Index Variable Name</label>
                    <input
                      type="text"
                      data-testid="config-loopVariable"
                      value={String(selectedNode.config.loopVariable || 'i')}
                      onChange={e => handleUpdateConfig('loopVariable', e.target.value)}
                      style={{
                        width: '100%',
                        padding: '6px 10px',
                        fontSize: 12,
                        background: 'var(--surface-2)',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        color: 'var(--text)',
                      }}
                    />
                  </div>
                </>
              )}

              {/* EXTRACT CONFIG */}
              {selectedNode.type === 'extract' && (
                <>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Selector</label>
                    <input
                      type="text"
                      data-testid="config-selector"
                      value={String(selectedNode.config.selector || '')}
                      onChange={e => handleUpdateConfig('selector', e.target.value)}
                      style={{
                        width: '100%',
                        padding: '6px 10px',
                        fontSize: 12,
                        background: 'var(--surface-2)',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        color: 'var(--text)',
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Target Variable</label>
                    <input
                      type="text"
                      data-testid="config-targetVariable"
                      value={String(selectedNode.config.targetVariable || '')}
                      onChange={e => handleUpdateConfig('targetVariable', e.target.value)}
                      style={{
                        width: '100%',
                        padding: '6px 10px',
                        fontSize: 12,
                        background: 'var(--surface-2)',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        color: 'var(--text)',
                      }}
                    />
                  </div>
                </>
              )}

              {/* EVAL CONFIG */}
              {selectedNode.type === 'eval' && (
                <>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>JavaScript Code</label>
                    <textarea
                      rows={5}
                      data-testid="config-code"
                      value={String(selectedNode.config.code || '')}
                      onChange={e => handleUpdateConfig('code', e.target.value)}
                      style={{
                        width: '100%',
                        padding: '6px 10px',
                        fontSize: 12,
                        background: 'var(--surface-2)',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        color: 'var(--text)',
                        fontFamily: 'var(--font-mono)',
                      }}
                    />
                  </div>
                </>
              )}

              {/* SCREENSHOT CONFIG */}
              {selectedNode.type === 'screenshot' && (
                <>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Save Path</label>
                    <input
                      type="text"
                      data-testid="config-path"
                      value={String(selectedNode.config.path || '')}
                      onChange={e => handleUpdateConfig('path', e.target.value)}
                      style={{
                        width: '100%',
                        padding: '6px 10px',
                        fontSize: 12,
                        background: 'var(--surface-2)',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        color: 'var(--text)',
                      }}
                    />
                  </div>
                </>
              )}

              {/* SUBFLOW CONFIG */}
              {(selectedNode.type as string) === 'subflow' && (
                <>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Target Flow ID</label>
                    <input
                      type="text"
                      data-testid="config-flowId"
                      value={String(selectedNode.config.flowId || '')}
                      onChange={e => handleUpdateConfig('flowId', e.target.value)}
                      style={{
                        width: '100%',
                        padding: '6px 10px',
                        fontSize: 12,
                        background: 'var(--surface-2)',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        color: 'var(--text)',
                      }}
                    />
                  </div>
                </>
              )}

              {/* Validation errors specific to this node */}
              {errorsByNode.has(selectedNode.id) && (
                <div
                  data-testid="inspector-node-errors"
                  style={{
                    padding: 10,
                    borderRadius: 6,
                    background: 'var(--control-bg-active)',
                    border: '1px solid var(--border)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>Configuration Issues:</span>
                  {errorsByNode.get(selectedNode.id)?.map((err, idx) => (
                    <div key={idx} style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.3 }}>
                      • {err.message}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {!selectedEdge && !selectedNode && (
            <div style={{ color: 'var(--text-muted)', fontSize: 12, textAlign: 'center', marginTop: 40 }}>
              Select a node or connection line on the canvas to edit its properties.
            </div>
          )}
        </div>
      </div>

      {/* Element Action Picker (Wave 2b) */}
      {pickerOpen && (
        <div
          data-testid="element-action-picker"
          style={{
            position: 'absolute',
            top: 76,
            right: 336,
            zIndex: 60,
            width: 260,
            background: 'var(--panel)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(255,255,255,0.14)',
            borderRadius: 10,
            boxShadow: '0 12px 40px rgba(0,0,0,0.7)',
            padding: 14,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{t('Element picker')}</span>
            <button
              data-testid="btn-close-picker"
              onClick={closePicker}
              style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: 13, cursor: 'pointer' }}
            >
              ✕
            </button>
          </div>
          {pickerElement ? (
            <>
              <div
                data-testid="picker-element-summary"
                style={{
                  padding: 8,
                  borderRadius: 6,
                  background: 'var(--surface-2)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  fontSize: 11,
                  color: 'var(--text-secondary)',
                  fontFamily: 'var(--font-mono)',
                  wordBreak: 'break-all',
                  lineHeight: 1.4,
                }}
              >
                {pickerElement.tag ? `<${pickerElement.tag}> ` : ''}
                {pickerElement.selector ?? 'no stable selector'}
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('Choose an action for this element')}</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <button data-testid="pick-action-click" onClick={() => handlePickedAction('click')} style={pickerButtonStyle}>
                  {t('Click')}
                </button>
                <button data-testid="pick-action-human-click" onClick={() => handlePickedAction('human_click')} style={pickerButtonStyle}>
                  {t('Human Click')}
                </button>
                <button data-testid="pick-action-type" onClick={() => handlePickedAction('type')} style={pickerButtonStyle}>
                  {t('Type')}
                </button>
                <button data-testid="pick-action-human-type" onClick={() => handlePickedAction('human_type')} style={pickerButtonStyle}>
                  {t('Human Type')}
                </button>
                <button data-testid="pick-action-wait" onClick={() => handlePickedAction('wait')} style={pickerButtonStyle}>
                  {t('Wait For')}
                </button>
                <button data-testid="pick-action-extract" onClick={() => handlePickedAction('extract')} style={pickerButtonStyle}>
                  {t('Extract')}
                </button>
              </div>
            </>
          ) : (
            <span data-testid="picker-waiting" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {t('Pick element on the page')}
            </span>
          )}
        </div>
      )}

      {/* Bottom / Overlay Live Run Panel */}
      {showLiveRun && (
        <>
          <div
            data-testid="live-run-panel"
          style={{
            height: 240,
            borderTop: '1px solid rgba(255,255,255,0.12)',
            background: 'var(--panel)',
            display: 'flex',
            flexDirection: 'column',
            zIndex: 40,
          }}
        >
          {/* Live Run Header */}
          <div
            style={{
              padding: '6px 16px',
              borderBottom: '1px solid var(--divider)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'transparent',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>Live Run Stream</span>
              {/* Status Chip */}
              <span
                data-testid="live-run-status-chip"
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  padding: '2px 8px',
                  borderRadius: 12,
                  background:
                    runStatus === 'running'
                      ? 'var(--control-bg-active)'
                      : runStatus === 'finished'
                      ? 'var(--control-bg-selected)'
                      : runStatus === 'error'
                      ? 'var(--control-bg)'
                      : 'var(--control-bg)',
                  color:
                    runStatus === 'running'
                      ? 'var(--text)'
                      : runStatus === 'finished'
                      ? 'var(--text)'
                      : runStatus === 'error'
                      ? 'var(--text-secondary)'
                      : 'var(--text-muted)',
                  border: `1px solid ${
                    runStatus === 'running'
                      ? 'var(--border-focus)'
                      : runStatus === 'finished'
                      ? 'var(--border)'
                      : runStatus === 'error'
                      ? 'var(--border)'
                      : 'var(--border)'
                  }`,
                }}
              >
                {runStatus}
              </span>
              {activeTaskUuid && (
                <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                  task: {activeTaskUuid.slice(0, 8)}…
                </span>
              )}
              {/* Timings summary */}
              {Object.keys(nodeTimings).length > 0 && (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Node timings:</span>
                  {Object.entries(nodeTimings).map(([nid, ms]) => (
                    <span
                      key={nid}
                      data-testid={`node-timing-${nid}`}
                      style={{
                        fontSize: 10,
                        color: 'var(--text-secondary)', background: 'var(--control-bg)',
                        padding: '1px 5px',
                        borderRadius: 4,
                      }}
                    >
                      {nid}: {ms}ms
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {isScrolledUp && (
                <button
                  data-testid="btn-resume-autoscroll"
                  onClick={() => setIsScrolledUp(false)}
                  style={{
                    background: 'var(--surface-2)',
                    border: '1px solid var(--border)',
                    color: 'var(--text)',
                    fontSize: 10,
                    padding: '2px 8px',
                    borderRadius: 4,
                    cursor: 'pointer',
                  }}
                >
                  Resume Auto-Scroll
                </button>
              )}
              <button
                data-testid="btn-clear-logs"
                onClick={() => setRunLogs([])}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-muted)',
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                Clear
              </button>
              <button
                data-testid="btn-close-live-run"
                onClick={() => setShowLiveRun(false)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-secondary)',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                ✕
              </button>
            </div>
          </div>

          {/* Log Lines Box */}
          <div
            ref={logsContainerRef}
            data-testid="live-run-logs"
            onScroll={(e) => {
              const target = e.currentTarget;
              const auto = shouldAutoScroll(target.scrollTop, target.scrollHeight, target.clientHeight, 30);
              setIsScrolledUp(!auto);
            }}
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '8px 16px',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              fontSize: 11,
              lineHeight: 1.5,
              color: 'var(--text-secondary)',
            }}
          >
            {runError && (
              <div style={{ color: 'var(--text)', fontWeight: 600, marginBottom: 6 }}>
                [ERROR] {runError}
              </div>
            )}
            {runLogs.length === 0 && !runError && (
              <div style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
                {isRunning ? 'Waiting for log stream...' : 'No logs yet. Click "Run Flow" to start.'}
              </div>
            )}
            {runLogs.map((log, idx) => {
              const screenshot = extractScreenshotRef(log.line);
              return (
                <div
                  key={idx}
                  data-testid="log-line"
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                    padding: '2px 0',
                    borderBottom: '1px solid var(--divider)',
                  }}
                >
                  <div style={{ display: 'flex', gap: 8 }}>
                    {log.created_at && (
                      <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
                        {new Date(log.created_at).toLocaleTimeString()}
                      </span>
                    )}
                    <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{log.line}</span>
                  </div>
                  {screenshot && (
                    <div
                      data-testid="screenshot-preview"
                      style={{
                        margin: '4px 0 4px 20px',
                        padding: 6,
                        borderRadius: 4,
                        background: 'var(--surface-2)',
                        border: '1px solid var(--border)',
                        maxWidth: 400,
                      }}
                    >
                      {screenshot.startsWith('data:image/') ? (
                        <img
                          src={screenshot}
                          alt="screenshot preview"
                          style={{ width: '100%', maxHeight: 180, objectFit: 'contain', borderRadius: 2 }}
                        />
                      ) : (
                        <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>
                          🖼️ Screenshot: {screenshot}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          </div>

          {/* Fleet run view: one row per profile + selected profile's log.
              Selecting a fleet row shows that profile's own log stream. */}
          {showFleetPanel && (
            <div
              data-testid="fleet-panel-container"
              style={{
                height: 300,
                borderTop: '1px solid rgba(255,255,255,0.12)',
                background: 'var(--panel)',
                zIndex: 41,
              }}
            >
              {fleetRunError && (
                <div
                  style={{
                    color: 'var(--text)',
                    fontSize: 11,
                    padding: '4px 12px',
                    background: 'var(--control-bg-active)',
                    borderBottom: '1px solid var(--border)',
                  }}
                >
                  [ERROR] {fleetRunError}
                </div>
              )}
              <FleetPanel
                state={fleetState}
                profileNames={profileNames}
                selectedTaskUuid={selectedFleetTaskUuid}
                onSelectProfile={uuid => setSelectedFleetTaskUuid(uuid)}
                onStop={handleStopFleetRun}
                running={isRunning}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
export default FlowCanvas;
