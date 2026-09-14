import React, { useState, useEffect } from 'react';
import { getMcpStatus, startMcp, stopMcp, McpStatus } from '../api';

export function McpPanel() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    getMcpStatus()
      .then((res) => {
        const s = (res && typeof res === 'object' && 'data' in res && res.data) ? res.data : (res as unknown as McpStatus);
        if (s && typeof s.running === 'boolean') {
          setStatus(s);
        }
      })
      .catch((err) => {
        console.warn('[McpPanel] status fetch error:', err);
      });
  };

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen((prev) => !prev);
  };

  const getClientConfigString = (): string => {
    // Two transports, both verified against the real server:
    //  - Running: HTTP JSON-RPC. The server exposes `POST /mcp` (mcp/src/server.ts:190);
    //    there is no `/sse` route, so a config pointing at one would 404 on connect.
    //  - Stopped: stdio, launched by the app. The entry is `mcp/dist/mcp/src/index.js`,
    //    not `mcp/dist/index.js` — the MCP source imports from `src/main/motion`, so tsc
    //    nests the output one level deeper. A wrong path here fails silently in the client.
    if (status?.running && status.httpUrl) {
      return JSON.stringify(
        {
          mcpServers: {
            nulltrace: {
              type: 'http',
              url: status.httpUrl,
            },
          },
        },
        null,
        2
      );
    }

    return JSON.stringify(
      {
        mcpServers: {
          nulltrace: {
            command: 'node',
            args: ['mcp/dist/mcp/src/index.js'],
          },
        },
      },
      null,
      2
    );
  };

  const handleCopyConfig = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const configStr = getClientConfigString();
    try {
      await navigator.clipboard.writeText(configStr);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('[McpPanel] copy failed:', err);
    }
  };

  const handleStart = (e: React.MouseEvent) => {
    e.stopPropagation();
    setActionLoading(true);
    setError(null);
    startMcp()
      .then((res) => {
        // `startMcp` returns the envelope; the nested status is the fresh server state.
        if (res.code === 0 && res.data?.status) {
          setStatus(res.data.status);
        } else {
          refresh();
        }
      })
      .catch((err) => setError(err.message || 'Failed to start MCP server'))
      .finally(() => setActionLoading(false));
  };

  const handleStop = (e: React.MouseEvent) => {
    e.stopPropagation();
    setActionLoading(true);
    setError(null);
    stopMcp()
      .then((res) => {
        // `startMcp` returns the envelope; the nested status is the fresh server state.
        if (res.code === 0 && res.data?.status) {
          setStatus(res.data.status);
        } else {
          refresh();
        }
      })
      .catch((err) => setError(err.message || 'Failed to stop MCP server'))
      .finally(() => setActionLoading(false));
  };

  const isRunning = Boolean(status?.running);
  const toolCount = status?.toolCount;
  const transport = status?.transport ?? 'http';

  return (
    <div className="mcp-panel-root" style={{ width: '100%' }}>
      <button
        type="button"
        onClick={handleToggle}
        className="footer-panel-header"
        aria-expanded={open}
        title="MCP Server Status & Controls"
      >
        <span
          className="footer-panel-dot"
          style={{
            backgroundColor: isRunning ? 'var(--ok)' : 'var(--text-muted)',
          }}
        />
        <span className="footer-panel-title">MCP</span>
        <span className="footer-panel-badge">
          {isRunning && toolCount !== undefined ? `${toolCount} tools` : isRunning ? 'ON' : 'OFF'}
        </span>
        <span className="footer-panel-chevron">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="footer-panel-body">
          <div className="footer-panel-row">
            <span className="footer-panel-label">STATUS</span>
            <span
              className="footer-panel-value"
              style={{
                color: isRunning ? 'var(--ok)' : 'var(--text-muted)',
                fontWeight: 'var(--weight-medium)',
              }}
            >
              {isRunning ? 'RUNNING' : 'STOPPED'}
            </span>
          </div>

          <div className="footer-panel-row">
            <span className="footer-panel-label">TOOLS</span>
            <span className="footer-panel-value">
              {toolCount === undefined
                ? '—'
                : `${toolCount} (T1: ${status?.tier1Count ?? '—'} / T2: ${status?.tier2Count ?? '—'})`}
            </span>
          </div>

          <div className="footer-panel-row">
            <span className="footer-panel-label">TRANSPORT</span>
            <span className="footer-panel-value">{transport.toUpperCase()}</span>
          </div>

          {isRunning && status?.httpUrl && (
            <div className="footer-panel-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 'var(--space-1)' }}>
              <span className="footer-panel-label">ENDPOINT</span>
              <span
                className="footer-panel-code"
                title={status.httpUrl}
                style={{
                  wordBreak: 'break-all',
                  userSelect: 'all',
                }}
              >
                {status.httpUrl}
              </span>
            </div>
          )}

          {error && (
            <div
              style={{
                color: 'var(--danger)',
                fontSize: 'var(--text-xs)',
                lineHeight: 'var(--leading-normal)',
                marginBottom: 'var(--space-1)',
              }}
            >
              {error}
            </div>
          )}

          <div className="footer-panel-actions">
            {isRunning ? (
              <button
                type="button"
                onClick={handleStop}
                disabled={actionLoading}
                className="footer-panel-btn danger"
              >
                {actionLoading ? 'Stopping…' : 'Stop'}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleStart}
                disabled={actionLoading}
                className="footer-panel-btn primary"
              >
                {actionLoading ? 'Starting…' : 'Start'}
              </button>
            )}

            <button
              type="button"
              onClick={handleCopyConfig}
              className="footer-panel-btn secondary"
              title="Copy client configuration JSON"
            >
              {copied ? 'Copied!' : 'Copy config'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
