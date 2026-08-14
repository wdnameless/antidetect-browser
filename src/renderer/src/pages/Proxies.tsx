import { useCallback, useEffect, useState } from 'react';
import { api, type ProxyItem } from '../api';
import { ProxiesIcon, PlusIcon, TrashIcon, RefreshIcon, CheckIcon } from '../icons';

export function Proxies() {
  const [proxies, setProxies] = useState<ProxyItem[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [type, setType] = useState('http');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('');
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [checkResult, setCheckResult] = useState<Record<string, { ok: boolean; ip?: string; latencyMs?: number; error?: string }>>({});

  const load = useCallback(async () => {
    try {
      const res = await api.proxyList();
      if (res.code === 0) setProxies(res.data.list);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    setBusy(true);
    setError('');
    try {
      const body: Record<string, unknown> = {
        type,
        host: host.trim(),
        port: Number(port) || 0,
      };
      if (user.trim()) body.username = user.trim();
      if (pass.trim()) body.password = pass.trim();
      if (type === 'ssh' && privateKey.trim()) body.privateKey = privateKey.trim();

      const res = await api.proxyCreate(body);
      if (res.code === 0) {
        setShowModal(false);
        setHost('');
        setPort('');
        setUser('');
        setPass('');
        setPrivateKey('');
        await load();
      } else {
        setError(res.msg);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm('Are you sure you want to delete this proxy?')) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.proxyDelete(id);
      if (res.code === 0) await load();
      else setError(res.msg);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const check = async (id: string) => {
    setBusy(true);
    setError('');
    try {
      const res = await api.proxyCheck(id);
      if (res.code === 0) {
        setCheckResult((prev) => ({ ...prev, [id]: res.data }));
        await load();
      } else {
        setError(res.msg);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="page-header-actions">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <ProxiesIcon size={20} style={{ color: 'var(--accent)' }} />
          <h2 style={{ fontSize: 16, fontWeight: 700 }}>Proxy Manager</h2>
          <span className="hint" style={{ margin: 0 }}>({proxies.length} proxies configured)</span>
        </div>

        <button className="btn primary" onClick={() => setShowModal(true)}>
          <PlusIcon size={15} />
          <span>Add Proxy</span>
        </button>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      {/* Add Proxy Modal */}
      {showModal ? (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Add Proxy Server</h3>
              <button className="btn-icon" onClick={() => setShowModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Protocol</label>
                <select value={type} onChange={(e) => setType(e.target.value)}>
                  <option value="http">HTTP</option>
                  <option value="https">HTTPS</option>
                  <option value="socks5">SOCKS5</option>
                  <option value="ssh">SSH Tunnel</option>
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label>Host / IP</label>
                  <input placeholder="192.168.1.1 or proxy.example.com" value={host} onChange={(e) => setHost(e.target.value)} autoFocus />
                </div>
                <div className="form-group">
                  <label>Port</label>
                  <input placeholder="8080" value={port} onChange={(e) => setPort(e.target.value)} />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label>Username (optional)</label>
                  <input placeholder="Username" value={user} onChange={(e) => setUser(e.target.value)} />
                </div>
                <div className="form-group">
                  <label>Password (optional)</label>
                  <input type="password" placeholder="Password" value={pass} onChange={(e) => setPass(e.target.value)} />
                </div>
              </div>

              {type === 'ssh' ? (
                <div className="form-group">
                  <label>SSH Private Key (OpenSSH PEM format)</label>
                  <textarea
                    rows={4}
                    placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;..."
                    value={privateKey}
                    onChange={(e) => setPrivateKey(e.target.value)}
                    style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
                  />
                </div>
              ) : null}
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn primary" onClick={() => void create()} disabled={busy || !host.trim() || !port.trim()}>
                Save Proxy
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: '12%' }}>Type</th>
              <th style={{ width: '30%' }}>Host : Port</th>
              <th style={{ width: '22%' }}>Username</th>
              <th style={{ width: '20%' }}>Location / IP</th>
              <th style={{ width: '16%', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {proxies.length === 0 ? (
              <tr>
                <td colSpan={5} className="empty-cell">
                  No proxies configured yet. Click "+ Add Proxy" to configure one.
                </td>
              </tr>
            ) : (
              proxies.map((p) => {
                const res = checkResult[p.proxy_id];
                return (
                  <tr key={p.proxy_id}>
                    <td>
                      <span className="proxy-type-badge">{p.type.toUpperCase()}</span>
                    </td>
                    <td>
                      <code style={{ fontSize: 13, color: 'var(--text)' }}>{p.host}:{p.port}</code>
                    </td>
                    <td>
                      <span style={{ color: p.username ? 'var(--text-secondary)' : 'var(--text-muted)', fontSize: 13 }}>
                        {p.username || '—'}
                      </span>
                    </td>
                    <td>
                      {res ? (
                        <span style={{ fontSize: 12, color: res.ok ? 'var(--ok)' : 'var(--danger)' }}>
                          {res.ok ? `✓ ${res.ip} (${res.latencyMs}ms)` : `✕ ${res.error || 'Failed'}`}
                        </span>
                      ) : p.country ? (
                        <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
                          {p.country} ({p.timezone || 'UTC'})
                        </span>
                      ) : (
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Not tested</span>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                        <button
                          className="btn-icon"
                          onClick={() => void check(p.proxy_id)}
                          disabled={busy}
                          title="Test Connection"
                        >
                          <RefreshIcon size={14} />
                        </button>
                        <button
                          className="btn-icon"
                          style={{ color: 'var(--danger)' }}
                          onClick={() => void remove(p.proxy_id)}
                          disabled={busy}
                          title="Delete Proxy"
                        >
                          <TrashIcon size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
