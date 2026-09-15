import { useEffect, useState } from 'react';
import { api } from '../api';

/**
 * Security settings section (parity program: screen-capture-protection):
 * capture-protection toggle + idle auto-lock timeout.
 */
export function SecuritySettings() {
  const [captureProtection, setCaptureProtection] = useState(false);
  const [autoLockMinutes, setAutoLockMinutes] = useState(15);
  // MCP privilege level. `standard` allows the 35 read/write tools; `admin` additionally
  // unlocks the 12 destructive ones (delete / restore / import / export).
  const [mcpScope, setMcpScope] = useState<'standard' | 'admin'>('standard');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.securitySettingsGet();
        if (res.data) {
          setCaptureProtection(res.data.captureProtection);
          setAutoLockMinutes(res.data.autoLockMinutes);
          if (res.data.mcpScope === 'admin' || res.data.mcpScope === 'standard') setMcpScope(res.data.mcpScope);
        }
        setLoaded(true);
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }, []);

  const persist = async (next: { captureProtection?: boolean; autoLockMinutes?: number | null; mcpScope?: 'standard' | 'admin' }) => {
    setBusy(true);
    setError('');
    try {
      const res = await api.securitySettingsSet(next);
      if (res.data) {
        setCaptureProtection(res.data.captureProtection);
        setAutoLockMinutes(res.data.autoLockMinutes);
        if (res.data.mcpScope === 'admin' || res.data.mcpScope === 'standard') setMcpScope(res.data.mcpScope);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      <div className="panel-header">Security</div>
      {!loaded ? (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>…</div>
      ) : (
        <>
          <div className="setting-row">
            <span className="setting-label">Exclude app windows from screen capture</span>
            <input
              type="checkbox"
              data-testid="settings-capture-protection"
              checked={captureProtection}
              disabled={busy}
              onChange={(e) => void persist({ captureProtection: e.target.checked })}
            />
          </div>
          <div className="setting-row">
            <span className="setting-label">Auto-lock after idle (minutes, 0 = off)</span>
            <input
              type="number"
              data-testid="settings-autolock-minutes"
              min={0}
              max={720}
              value={autoLockMinutes}
              disabled={busy}
              onChange={(e) => {
                const v = Math.max(0, parseInt(e.target.value, 10) || 0);
                setAutoLockMinutes(v);
              }}
              onBlur={() => void persist({ autoLockMinutes })}
              style={{ width: 100 }}
            />
          </div>
          <div className="setting-row">
            <span className="setting-label">
              MCP privileges
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                Admin unlocks destructive MCP tools (delete, restore, import, export). Applies on the next MCP start.
              </div>
            </span>
            <select
              data-testid="settings-mcp-scope"
              value={mcpScope}
              disabled={busy}
              onChange={(e) => {
                const v = e.target.value === 'admin' ? 'admin' : 'standard';
                setMcpScope(v);
                void persist({ mcpScope: v });
              }}
            >
              <option value="standard">Standard</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          {error && <div style={{ color: 'var(--danger)', fontSize: 12 }}>{error}</div>}
        </>
      )}
    </div>
  );
}