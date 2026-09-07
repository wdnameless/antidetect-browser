import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  FlowNode,
  FlowEdge,
  FlowDocument,
  FlowNodeType,
  FlowValidationError,
  FlowNodeSchema,
  CanvasNodeState,
  CanvasEdgeState,
} from '../../../main/flows/types';
import { validateFlow } from '../../../main/flows/validator';
import { getApiBase } from '../api';
import {
  parseSseEventData,
  extractScreenshotRef,
  extractTimingRef,
  reduceLogLines,
  shouldAutoScroll,
  LiveRunLogEntry,
} from '../flowLiveRun';

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
  const [runLogs, setRunLogs] = useState<LiveRunLogEntry[]>([]);
  const [runError, setRunError] = useState<string | null>(null);
  const [nodeTimings, setNodeTimings] = useState<Record<string, number>>({});
  const [isScrolledUp, setIsScrolledUp] = useState<boolean>(false);

  const logsContainerRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

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
        const parsed = parseSseEventData(e.data);
        if (parsed.type === 'end') {
          setRunStatus(parsed.status as 'finished' | 'error' | 'stop');
          setIsRunning(false);
          es.close();
          eventSourceRef.current = null;
          return;
        }

        if (parsed.type === 'log') {
          const rawLine = parsed.entry.line;
          const timing = extractTimingRef(rawLine);
          if (timing) {
            setNodeTimings(prev => ({
              ...prev,
              [timing.nodeId]: timing.durationMs ?? (prev[timing.nodeId] || 0),
            }));
          }

          setRunLogs(prev => reduceLogLines(prev, parsed.entry, 200));
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

      setActiveTaskUuid(taskUuid);
      connectLogsStream(taskUuid);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setRunError(msg);
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
        background: '#09090b',
        color: '#fafafa',
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
          borderRight: '1px solid rgba(255,255,255,0.08)',
          background: '#0c0c0e',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 10,
          flexShrink: 0,
        }}
      >
        <div style={{ padding: '16px 14px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#a1a1aa' }}>
              Nodes Palette
            </span>
            <span style={{ fontSize: 11, background: 'rgba(255,255,255,0.08)', padding: '2px 6px', borderRadius: 4, color: '#d4d4d8' }}>
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
              background: '#141416',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 6,
              color: '#fafafa',
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
                background: '#141416',
                border: '1px solid rgba(255,255,255,0.07)',
                cursor: 'grab',
                transition: 'all 0.15s ease',
                display: 'flex',
                flexDirection: 'column',
                gap: 3,
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.25)';
                (e.currentTarget as HTMLElement).style.background = '#1a1a1e';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.07)';
                (e.currentTarget as HTMLElement).style.background = '#141416';
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#f4f4f5' }}>{item.label}</span>
                <span style={{ fontSize: 10, color: '#71717a', textTransform: 'uppercase', fontWeight: 600 }}>{item.category}</span>
              </div>
              <span style={{ fontSize: 11, color: '#a1a1aa', lineHeight: 1.3 }}>{item.description}</span>
            </div>
          ))}
        </div>

        {/* Validation Status summary footer */}
        <div
          data-testid="palette-validation-summary"
          style={{
            padding: '12px 14px',
            borderTop: '1px solid rgba(255,255,255,0.06)',
            background: validation.valid ? 'rgba(34, 197, 94, 0.06)' : 'rgba(239, 68, 68, 0.08)',
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
                background: validation.valid ? '#22c55e' : '#ef4444',
                boxShadow: validation.valid ? '0 0 8px #22c55e' : '0 0 8px #ef4444',
              }}
            />
            <span style={{ fontSize: 12, fontWeight: 600, color: validation.valid ? '#86efac' : '#fca5a5' }}>
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
              color: '#d4d4d8',
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
            'radial-gradient(circle, rgba(255,255,255,0.07) 1px, transparent 1px)',
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
            background: 'rgba(18, 18, 20, 0.85)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(255,255,255,0.1)',
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
              color: '#fafafa',
              fontSize: 13,
              fontWeight: 600,
              outline: 'none',
              width: 180,
            }}
          />
          <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.12)' }} />
          <span style={{ fontSize: 11, color: '#a1a1aa' }}>
            {nodes.length} nodes, {edges.length} edges
          </span>
          <button
            data-testid="btn-reset-pan"
            onClick={() => setPan({ x: 0, y: 0 })}
            style={{
              background: 'rgba(255,255,255,0.08)',
              border: 'none',
              color: '#d4d4d8',
              fontSize: 11,
              padding: '3px 8px',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            Reset View
          </button>
          <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.12)' }} />
          {/* Profile picker & Run action */}
          {profiles.length > 0 && (
            <select
              data-testid="live-run-profile-select"
              value={selectedProfileId}
              onChange={e => setSelectedProfileId(e.target.value)}
              style={{
                background: '#18181b',
                color: '#e4e4e7',
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
          <button
            data-testid="btn-run-flow"
            onClick={handleRunFlow}
            disabled={isRunning}
            style={{
              background: isRunning ? '#3f3f46' : '#22c55e',
              color: '#09090b',
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
            data-testid="btn-toggle-live-run"
            onClick={() => setShowLiveRun(v => !v)}
            style={{
              background: showLiveRun ? 'rgba(59, 130, 246, 0.2)' : 'rgba(255,255,255,0.08)',
              color: showLiveRun ? '#60a5fa' : '#d4d4d8',
              border: showLiveRun ? '1px solid rgba(59, 130, 246, 0.4)' : 'none',
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
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#a1a1aa" />
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
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#ffffff" />
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
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#ef4444" />
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
                  stroke={hasError ? '#ef4444' : isSelected ? '#ffffff' : '#71717a'}
                  strokeWidth={isSelected ? 2.5 : 1.5}
                  strokeDasharray={edge.branch !== 'default' ? '4 3' : undefined}
                  markerEnd={
                    hasError ? 'url(#arrow-error)' : isSelected ? 'url(#arrow-selected)' : 'url(#arrow-default)'
                  }
                  style={{ cursor: 'pointer', transition: 'stroke 0.15s ease' }}
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
                    fill="#d4d4d8"
                    fontSize="10"
                    textAnchor="middle"
                    style={{ background: '#111', padding: '2px 4px' }}
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
                  stroke="#3b82f6"
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
                background: isSelected ? '#18181b' : '#121214',
                border: hasError
                  ? '1.5px solid #ef4444'
                  : isSelected
                  ? '1.5px solid #ffffff'
                  : '1px solid rgba(255,255,255,0.1)',
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
                  background: '#09090b',
                  border: '2px solid #a1a1aa',
                  cursor: 'pointer',
                  zIndex: 20,
                  transition: 'transform 0.15s ease, border-color 0.15s ease',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.transform = 'scale(1.25)';
                  (e.currentTarget as HTMLElement).style.borderColor = '#ffffff';
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.transform = 'scale(1)';
                  (e.currentTarget as HTMLElement).style.borderColor = '#a1a1aa';
                }}
              />

              {/* Node Header */}
              <div
                style={{
                  padding: '10px 12px 8px',
                  borderBottom: '1px solid rgba(255,255,255,0.06)',
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
                        color: '#fafafa',
                        fontWeight: 700,
                        padding: '1px 5px',
                        borderRadius: 3,
                        textTransform: 'uppercase',
                      }}
                    >
                      Start
                    </span>
                  )}
                  <span style={{ fontSize: 11, color: '#a1a1aa', textTransform: 'uppercase', fontWeight: 600 }}>
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
                        background: '#ef4444',
                        color: '#fff',
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
                      color: '#71717a',
                      fontSize: 13,
                      cursor: 'pointer',
                      padding: '2px 4px',
                      borderRadius: 4,
                    }}
                    onMouseEnter={e => ((e.currentTarget as HTMLElement).style.color = '#ef4444')}
                    onMouseLeave={e => ((e.currentTarget as HTMLElement).style.color = '#71717a')}
                  >
                    ×
                  </button>
                </div>
              </div>

              {/* Node Body */}
              <div style={{ padding: '8px 12px 10px' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#f4f4f5', marginBottom: 4 }}>
                  {node.name}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: '#71717a',
                    fontFamily: 'var(--font-mono, monospace)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {node.type === 'navigate' && `URL: ${String(node.config.url || '')}`}
                  {node.type === 'click' && `Selector: ${String(node.config.selector || '')}`}
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
                      background: 'rgba(239, 68, 68, 0.12)',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      color: '#fca5a5',
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
                  background: '#09090b',
                  border: '2px solid #a1a1aa',
                  cursor: 'crosshair',
                  zIndex: 20,
                  transition: 'transform 0.15s ease, border-color 0.15s ease',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.transform = 'scale(1.25)';
                  (e.currentTarget as HTMLElement).style.borderColor = '#ffffff';
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.transform = 'scale(1)';
                  (e.currentTarget as HTMLElement).style.borderColor = '#a1a1aa';
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
                      background: 'rgba(34, 197, 94, 0.15)',
                      border: '1px solid rgba(34, 197, 94, 0.3)',
                      color: '#86efac',
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
                      background: 'rgba(239, 68, 68, 0.15)',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      color: '#fca5a5',
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
          borderLeft: '1px solid rgba(255,255,255,0.08)',
          background: '#0c0c0e',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 10,
          flexShrink: 0,
        }}
      >
        <div style={{ padding: '16px 16px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#a1a1aa' }}>
            Inspector & Config
          </span>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {selectedEdge && (
            <div data-testid="edge-config-form" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: '#f4f4f5' }}>Connection Edge</span>
                <button
                  data-testid="btn-delete-selected-edge"
                  onClick={() => handleDeleteEdge(selectedEdge.id)}
                  style={{
                    background: 'rgba(239, 68, 68, 0.15)',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    color: '#fca5a5',
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
                <label style={{ fontSize: 11, color: '#a1a1aa', display: 'block', marginBottom: 4 }}>
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
                    background: '#141416',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 6,
                    color: '#71717a',
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: 11, color: '#a1a1aa', display: 'block', marginBottom: 4 }}>
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
                    background: '#141416',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 6,
                    color: '#71717a',
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: 11, color: '#a1a1aa', display: 'block', marginBottom: 4 }}>
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
                    background: '#141416',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 6,
                    color: '#fafafa',
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
                <span style={{ fontSize: 14, fontWeight: 600, color: '#f4f4f5' }}>
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
                        color: '#d4d4d8',
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
                      background: 'rgba(239, 68, 68, 0.15)',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      color: '#fca5a5',
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
                <label style={{ fontSize: 11, color: '#a1a1aa', display: 'block', marginBottom: 4 }}>Node ID</label>
                <input
                  type="text"
                  disabled
                  value={selectedNode.id}
                  style={{
                    width: '100%',
                    padding: '6px 10px',
                    fontSize: 12,
                    background: '#141416',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 6,
                    color: '#71717a',
                  }}
                />
              </div>

              {/* Node Label / Name */}
              <div>
                <label style={{ fontSize: 11, color: '#a1a1aa', display: 'block', marginBottom: 4 }}>Display Name</label>
                <input
                  type="text"
                  data-testid="input-node-name"
                  value={selectedNode.name || ''}
                  onChange={e => handleUpdateNodeProp('name', e.target.value)}
                  style={{
                    width: '100%',
                    padding: '6px 10px',
                    fontSize: 12,
                    background: '#141416',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 6,
                    color: '#fafafa',
                  }}
                />
              </div>

              {/* Dynamic Type-specific Form Controls Bound to Schema */}
              <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '4px 0' }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: '#e4e4e7' }}>Step Parameters</span>

              {/* NAVIGATE CONFIG */}
              {selectedNode.type === 'navigate' && (
                <>
                  <div>
                    <label style={{ fontSize: 11, color: '#a1a1aa', display: 'block', marginBottom: 4 }}>Target URL</label>
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
                        background: '#141416',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: 6,
                        color: '#fafafa',
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: '#a1a1aa', display: 'block', marginBottom: 4 }}>Timeout (ms)</label>
                    <input
                      type="number"
                      data-testid="config-timeoutMs"
                      value={Number(selectedNode.config.timeoutMs || 30000)}
                      onChange={e => handleUpdateConfig('timeoutMs', parseInt(e.target.value, 10) || 0)}
                      style={{
                        width: '100%',
                        padding: '6px 10px',
                        fontSize: 12,
                        background: '#141416',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: 6,
                        color: '#fafafa',
                      }}
                    />
                  </div>
                </>
              )}

              {/* CLICK CONFIG */}
              {selectedNode.type === 'click' && (
                <>
                  <div>
                    <label style={{ fontSize: 11, color: '#a1a1aa', display: 'block', marginBottom: 4 }}>CSS Selector</label>
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
                        background: '#141416',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: 6,
                        color: '#fafafa',
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: '#a1a1aa', display: 'block', marginBottom: 4 }}>Click Count</label>
                    <input
                      type="number"
                      data-testid="config-clickCount"
                      value={Number(selectedNode.config.clickCount || 1)}
                      onChange={e => handleUpdateConfig('clickCount', parseInt(e.target.value, 10) || 1)}
                      style={{
                        width: '100%',
                        padding: '6px 10px',
                        fontSize: 12,
                        background: '#141416',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: 6,
                        color: '#fafafa',
                      }}
                    />
                  </div>
                </>
              )}

              {/* TYPE CONFIG */}
              {selectedNode.type === 'type' && (
                <>
                  <div>
                    <label style={{ fontSize: 11, color: '#a1a1aa', display: 'block', marginBottom: 4 }}>Input Selector</label>
                    <input
                      type="text"
                      data-testid="config-selector"
                      value={String(selectedNode.config.selector || '')}
                      onChange={e => handleUpdateConfig('selector', e.target.value)}
                      style={{
                        width: '100%',
                        padding: '6px 10px',
                        fontSize: 12,
                        background: '#141416',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: 6,
                        color: '#fafafa',
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: '#a1a1aa', display: 'block', marginBottom: 4 }}>Text Content</label>
                    <textarea
                      rows={3}
                      data-testid="config-text"
                      value={String(selectedNode.config.text || '')}
                      onChange={e => handleUpdateConfig('text', e.target.value)}
                      style={{
                        width: '100%',
                        padding: '6px 10px',
                        fontSize: 12,
                        background: '#141416',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: 6,
                        color: '#fafafa',
                        fontFamily: 'var(--font-mono, monospace)',
                      }}
                    />
                  </div>
                </>
              )}

              {/* WAIT CONFIG */}
              {selectedNode.type === 'wait' && (
                <>
                  <div>
                    <label style={{ fontSize: 11, color: '#a1a1aa', display: 'block', marginBottom: 4 }}>Wait Mode</label>
                    <select
                      data-testid="config-mode"
                      value={String(selectedNode.config.mode || 'time')}
                      onChange={e => handleUpdateConfig('mode', e.target.value)}
                      style={{
                        width: '100%',
                        padding: '6px 10px',
                        fontSize: 12,
                        background: '#141416',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: 6,
                        color: '#fafafa',
                      }}
                    >
                      <option value="time">Duration (ms)</option>
                      <option value="selector">Until Selector Visible</option>
                      <option value="navigation">Until Page Navigation</option>
                    </select>
                  </div>
                  {selectedNode.config.mode === 'selector' ? (
                    <div>
                      <label style={{ fontSize: 11, color: '#a1a1aa', display: 'block', marginBottom: 4 }}>Selector to Wait For</label>
                      <input
                        type="text"
                        data-testid="config-selector"
                        value={String(selectedNode.config.selector || '')}
                        onChange={e => handleUpdateConfig('selector', e.target.value)}
                        style={{
                          width: '100%',
                          padding: '6px 10px',
                          fontSize: 12,
                          background: '#141416',
                          border: '1px solid rgba(255,255,255,0.1)',
                          borderRadius: 6,
                          color: '#fafafa',
                        }}
                      />
                    </div>
                  ) : (
                    <div>
                      <label style={{ fontSize: 11, color: '#a1a1aa', display: 'block', marginBottom: 4 }}>Duration (ms)</label>
                      <input
                        type="number"
                        data-testid="config-durationMs"
                        value={Number(selectedNode.config.durationMs || 1000)}
                        onChange={e => handleUpdateConfig('durationMs', parseInt(e.target.value, 10) || 0)}
                        style={{
                          width: '100%',
                          padding: '6px 10px',
                          fontSize: 12,
                          background: '#141416',
                          border: '1px solid rgba(255,255,255,0.1)',
                          borderRadius: 6,
                          color: '#fafafa',
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
                    <label style={{ fontSize: 11, color: '#a1a1aa', display: 'block', marginBottom: 4 }}>JavaScript Expression</label>
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
                        background: '#141416',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: 6,
                        color: '#fafafa',
                        fontFamily: 'var(--font-mono, monospace)',
                      }}
                    />
                  </div>
                </>
              )}

              {/* LOOP CONFIG */}
              {selectedNode.type === 'loop' && (
                <>
                  <div>
                    <label style={{ fontSize: 11, color: '#a1a1aa', display: 'block', marginBottom: 4 }}>Iterations Count</label>
                    <input
                      type="number"
                      data-testid="config-count"
                      value={Number(selectedNode.config.count || 1)}
                      onChange={e => handleUpdateConfig('count', parseInt(e.target.value, 10) || 1)}
                      style={{
                        width: '100%',
                        padding: '6px 10px',
                        fontSize: 12,
                        background: '#141416',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: 6,
                        color: '#fafafa',
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: '#a1a1aa', display: 'block', marginBottom: 4 }}>Index Variable Name</label>
                    <input
                      type="text"
                      data-testid="config-loopVariable"
                      value={String(selectedNode.config.loopVariable || 'i')}
                      onChange={e => handleUpdateConfig('loopVariable', e.target.value)}
                      style={{
                        width: '100%',
                        padding: '6px 10px',
                        fontSize: 12,
                        background: '#141416',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: 6,
                        color: '#fafafa',
                      }}
                    />
                  </div>
                </>
              )}

              {/* EXTRACT CONFIG */}
              {selectedNode.type === 'extract' && (
                <>
                  <div>
                    <label style={{ fontSize: 11, color: '#a1a1aa', display: 'block', marginBottom: 4 }}>Selector</label>
                    <input
                      type="text"
                      data-testid="config-selector"
                      value={String(selectedNode.config.selector || '')}
                      onChange={e => handleUpdateConfig('selector', e.target.value)}
                      style={{
                        width: '100%',
                        padding: '6px 10px',
                        fontSize: 12,
                        background: '#141416',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: 6,
                        color: '#fafafa',
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: '#a1a1aa', display: 'block', marginBottom: 4 }}>Target Variable</label>
                    <input
                      type="text"
                      data-testid="config-targetVariable"
                      value={String(selectedNode.config.targetVariable || '')}
                      onChange={e => handleUpdateConfig('targetVariable', e.target.value)}
                      style={{
                        width: '100%',
                        padding: '6px 10px',
                        fontSize: 12,
                        background: '#141416',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: 6,
                        color: '#fafafa',
                      }}
                    />
                  </div>
                </>
              )}

              {/* EVAL CONFIG */}
              {selectedNode.type === 'eval' && (
                <>
                  <div>
                    <label style={{ fontSize: 11, color: '#a1a1aa', display: 'block', marginBottom: 4 }}>JavaScript Code</label>
                    <textarea
                      rows={5}
                      data-testid="config-code"
                      value={String(selectedNode.config.code || '')}
                      onChange={e => handleUpdateConfig('code', e.target.value)}
                      style={{
                        width: '100%',
                        padding: '6px 10px',
                        fontSize: 12,
                        background: '#141416',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: 6,
                        color: '#fafafa',
                        fontFamily: 'var(--font-mono, monospace)',
                      }}
                    />
                  </div>
                </>
              )}

              {/* SCREENSHOT CONFIG */}
              {selectedNode.type === 'screenshot' && (
                <>
                  <div>
                    <label style={{ fontSize: 11, color: '#a1a1aa', display: 'block', marginBottom: 4 }}>Save Path</label>
                    <input
                      type="text"
                      data-testid="config-path"
                      value={String(selectedNode.config.path || '')}
                      onChange={e => handleUpdateConfig('path', e.target.value)}
                      style={{
                        width: '100%',
                        padding: '6px 10px',
                        fontSize: 12,
                        background: '#141416',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: 6,
                        color: '#fafafa',
                      }}
                    />
                  </div>
                </>
              )}

              {/* SUBFLOW CONFIG */}
              {(selectedNode.type as string) === 'subflow' && (
                <>
                  <div>
                    <label style={{ fontSize: 11, color: '#a1a1aa', display: 'block', marginBottom: 4 }}>Target Flow ID</label>
                    <input
                      type="text"
                      data-testid="config-flowId"
                      value={String(selectedNode.config.flowId || '')}
                      onChange={e => handleUpdateConfig('flowId', e.target.value)}
                      style={{
                        width: '100%',
                        padding: '6px 10px',
                        fontSize: 12,
                        background: '#141416',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: 6,
                        color: '#fafafa',
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
                    background: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid rgba(239, 68, 68, 0.25)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#ef4444' }}>Configuration Issues:</span>
                  {errorsByNode.get(selectedNode.id)?.map((err, idx) => (
                    <div key={idx} style={{ fontSize: 11, color: '#fca5a5', lineHeight: 1.3 }}>
                      • {err.message}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {!selectedEdge && !selectedNode && (
            <div style={{ color: '#71717a', fontSize: 12, textAlign: 'center', marginTop: 40 }}>
              Select a node or connection line on the canvas to edit its properties.
            </div>
          )}
        </div>
      </div>

      {/* Bottom / Overlay Live Run Panel */}
      {showLiveRun && (
        <div
          data-testid="live-run-panel"
          style={{
            height: 240,
            borderTop: '1px solid rgba(255,255,255,0.12)',
            background: '#0d0d10',
            display: 'flex',
            flexDirection: 'column',
            zIndex: 40,
          }}
        >
          {/* Live Run Header */}
          <div
            style={{
              padding: '6px 16px',
              borderBottom: '1px solid rgba(255,255,255,0.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'rgba(255,255,255,0.02)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#fafafa' }}>Live Run Stream</span>
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
                      ? 'rgba(59, 130, 246, 0.2)'
                      : runStatus === 'finished'
                      ? 'rgba(34, 197, 94, 0.2)'
                      : runStatus === 'error'
                      ? 'rgba(239, 68, 68, 0.2)'
                      : 'rgba(255,255,255,0.08)',
                  color:
                    runStatus === 'running'
                      ? '#60a5fa'
                      : runStatus === 'finished'
                      ? '#4ade80'
                      : runStatus === 'error'
                      ? '#f87171'
                      : '#a1a1aa',
                  border: `1px solid ${
                    runStatus === 'running'
                      ? 'rgba(59, 130, 246, 0.3)'
                      : runStatus === 'finished'
                      ? 'rgba(34, 197, 94, 0.3)'
                      : runStatus === 'error'
                      ? 'rgba(239, 68, 68, 0.3)'
                      : 'rgba(255,255,255,0.1)'
                  }`,
                }}
              >
                {runStatus}
              </span>
              {activeTaskUuid && (
                <span style={{ fontSize: 10, color: '#71717a', fontFamily: 'monospace' }}>
                  task: {activeTaskUuid.slice(0, 8)}…
                </span>
              )}
              {/* Timings summary */}
              {Object.keys(nodeTimings).length > 0 && (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ fontSize: 10, color: '#71717a' }}>Node timings:</span>
                  {Object.entries(nodeTimings).map(([nid, ms]) => (
                    <span
                      key={nid}
                      data-testid={`node-timing-${nid}`}
                      style={{
                        fontSize: 10,
                        color: '#38bdf8',
                        background: 'rgba(56, 189, 248, 0.1)',
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
                    background: '#27272a',
                    border: '1px solid rgba(255,255,255,0.1)',
                    color: '#e4e4e7',
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
                  color: '#71717a',
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
                  color: '#a1a1aa',
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
              color: '#d4d4d8',
            }}
          >
            {runError && (
              <div style={{ color: '#ef4444', marginBottom: 6 }}>
                [ERROR] {runError}
              </div>
            )}
            {runLogs.length === 0 && !runError && (
              <div style={{ color: '#52525b', fontStyle: 'italic' }}>
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
                    borderBottom: '1px solid rgba(255,255,255,0.02)',
                  }}
                >
                  <div style={{ display: 'flex', gap: 8 }}>
                    {log.created_at && (
                      <span style={{ color: '#52525b', flexShrink: 0 }}>
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
                        background: '#18181b',
                        border: '1px solid rgba(255,255,255,0.1)',
                        maxWidth: 400,
                      }}
                    >
                      {screenshot.isDataUrl ? (
                        <img
                          src={screenshot.ref}
                          alt="screenshot preview"
                          style={{ width: '100%', maxHeight: 180, objectFit: 'contain', borderRadius: 2 }}
                        />
                      ) : (
                        <div style={{ fontSize: 10, color: '#38bdf8' }}>
                          🖼️ Screenshot: {screenshot.ref}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
export default FlowCanvas;
