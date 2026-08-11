import { useCallback, useEffect, useState } from 'react';
import { api, type ProxyItem, type ProfileListItem } from '../api';

const EMPTY_FORM = { type: 'http', host: '', port: '', username: '', password: '' };

export function Proxies() {
  const [proxies, setProxies] = useState<ProxyItem[]>([]);
  const [profiles, setProfiles] = useState<ProfileListItem[]>([]);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [bindTarget, setBindTarget] = useState<{ proxyId: string; profileId: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [p, pr] = await Promise.all([api.proxyList(), api.list()]);
      if (p.code === 0) setProxies(p.data.list);
      if (pr.code === 0) setProfiles(pr.data.list);
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
      const res = await api.proxyCreate({
        type: form.type,
        host: form.host,
        port: Number(form.port),
        username: form.username || undefined,
        password: form.password || undefined,
      });
      if (res.code !== 0) setError(res.msg);
      setForm({ ...EMPTY_FORM });
      setShowForm(false);
      await load();
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
        const d = res.data;
        alert(
          d.ok
            ? `Proxy OK\nIP: ${d.ip}\nCountry: ${d.country}\nTimezone: ${d.timezone}\nLatency: ${d.latencyMs}ms`
            : `Proxy FAIL: ${d.error}`
        );
      } else {
        setError(res.msg);
      }
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    setError('');
    try {
      const res = await api.proxyDelete(id);
      if (res.code !== 0) setError(res.msg);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const bind = async () => {
    if (!bindTarget) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.profileUpdate({ user_id: bindTarget.profileId, proxy_id: bindTarget.proxyId });
      if (res.code !== 0) setError(res.msg);
      setBindTarget(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <header className="page-header">
        <h1>Proxies</h1>
        <button className="primary" onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Cancel' : '+ New proxy'}
        </button>
      </header>

      {error ? <div className="error">{error}</div> : null}

      {showForm ? (
        <div className="panel">
          <div className="form-row">
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option value="http">HTTP</option>
              <option value="https">HTTPS</option>
              <option value="socks5">SOCKS5</option>
              <option value="ssh">SSH</option>
            </select>
            <input
              placeholder="host"
              value={form.host}
              onChange={(e) => setForm({ ...form, host: e.target.value })}
            />
            <input
              placeholder="port"
              value={form.port}
              onChange={(e) => setForm({ ...form, port: e.target.value })}
            />
            <input
              placeholder="username (optional)"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
            />
            <input
              placeholder="password (optional)"
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
            <button className="primary" onClick={() => void create()} disabled={busy}>
              Save
            </button>
          </div>
        </div>
      ) : null}

      <table className="table">
        <thead>
          <tr>
            <th>Type</th>
            <th>Host</th>
            <th>Port</th>
            <th>User</th>
            <th>Country</th>
            <th>Timezone</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {proxies.length === 0 ? (
            <tr>
              <td colSpan={8} className="empty">
                No proxies yet.
              </td>
            </tr>
          ) : (
            proxies.map((p) => (
              <tr key={p.proxy_id}>
                <td>{p.type}</td>
                <td className="mono">{p.host}</td>
                <td>{p.port}</td>
                <td>{p.username ?? '—'}</td>
                <td>{p.country ?? '—'}</td>
                <td>{p.timezone ?? '—'}</td>
                <td>
                  <span className={p.status === 'ok' ? 'badge running' : 'badge'}>{p.status}</span>
                </td>
                <td className="actions">
                  <button onClick={() => void check(p.proxy_id)} disabled={busy}>
                    Check
                  </button>
                  <button onClick={() => setBindTarget({ proxyId: p.proxy_id, profileId: profiles[0]?.user_id ?? '' })}>
                    Bind
                  </button>
                  <button onClick={() => void remove(p.proxy_id)} disabled={busy}>
                    Delete
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {bindTarget ? (
        <div className="panel">
          <div className="form-row">
            <span>Bind proxy to profile:</span>
            <select
              value={bindTarget.profileId}
              onChange={(e) => setBindTarget({ ...bindTarget, profileId: e.target.value })}
            >
              {profiles.map((pr) => (
                <option key={pr.user_id} value={pr.user_id}>
                  {pr.name ?? pr.user_id}
                </option>
              ))}
            </select>
            <button className="primary" onClick={() => void bind()} disabled={busy}>
              Bind
            </button>
            <button onClick={() => setBindTarget(null)}>Cancel</button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
