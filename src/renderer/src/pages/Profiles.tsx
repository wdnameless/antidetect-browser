import { useCallback, useEffect, useState } from 'react';
import { api, type ProfileListItem, type ExtensionItem } from '../api';

export function Profiles() {
  const [profiles, setProfiles] = useState<ProfileListItem[]>([]);
  const [extensions, setExtensions] = useState<ExtensionItem[]>([]);
  const [error, setError] = useState('');
  const [endpoint, setEndpoint] = useState<{ id: string; ws: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [showBatch, setShowBatch] = useState(false);
  const [batchCount, setBatchCount] = useState('5');
  const [batchPrefix, setBatchPrefix] = useState('profile');
  const [showCsv, setShowCsv] = useState(false);
  const [csvText, setCsvText] = useState('');
  const [manage, setManage] = useState<{ id: string; tab: 'cookies' | 'fingerprint' | 'extensions' } | null>(null);
  const [cookiesText, setCookiesText] = useState('');
  const [fpConfig, setFpConfig] = useState('');
  const [extSel, setExtSel] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      const [p, e] = await Promise.all([api.list(), api.extensionList()]);
      if (p.code === 0) setProfiles(p.data.list);
      if (e.code === 0) setExtensions(e.data.list);
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
      const name = 'profile-' + Math.random().toString(36).slice(2, 7);
      const res = await api.create(name);
      if (res.code !== 0) setError(res.msg);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const batchCreate = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await api.batchCreate({ count: Number(batchCount) || 1, name_prefix: batchPrefix });
      if (res.code !== 0) setError(res.msg);
      setShowBatch(false);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const importCsv = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await api.importCsv(csvText);
      if (res.code !== 0) setError(res.msg);
      setShowCsv(false);
      setCsvText('');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const start = async (id: string) => {
    setBusy(true);
    setError('');
    try {
      const res = await api.start(id);
      if (res.code === 0) setEndpoint({ id, ws: res.data.ws.puppeteer });
      else setError(res.msg);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const stop = async (id: string) => {
    setBusy(true);
    setError('');
    try {
      await api.stop(id);
      if (endpoint?.id === id) setEndpoint(null);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const openManage = async (id: string, tab: 'cookies' | 'fingerprint' | 'extensions') => {
    setError('');
    setManage({ id, tab });
    setCookiesText('');
    setFpConfig('');
    setExtSel([]);
    if (tab === 'extensions') {
      const res = await api.profileExtensions(id);
      if (res.code === 0) setExtSel(res.data.extension_ids);
    }
  };

  const saveCookies = async () => {
    if (!manage) return;
    setBusy(true);
    setError('');
    try {
      let cookies: Array<Record<string, unknown>>;
      try {
        cookies = JSON.parse(cookiesText);
      } catch {
        setError('Invalid JSON for cookies');
        setBusy(false);
        return;
      }
      const res = await api.cookiesImport(manage.id, cookies);
      if (res.code !== 0) setError(res.msg);
      setManage(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const exportCookies = async () => {
    if (!manage) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.cookiesExport(manage.id);
      if (res.code === 0) {
        setCookiesText(JSON.stringify(res.data.cookies, null, 2));
      } else {
        setError(res.msg);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveFingerprint = async () => {
    if (!manage) return;
    setBusy(true);
    setError('');
    try {
      let config: Record<string, unknown>;
      try {
        config = JSON.parse(fpConfig || '{}');
      } catch {
        setError('Invalid JSON for fingerprint config');
        setBusy(false);
        return;
      }
      const res = await api.fingerprintUpdate(manage.id, config);
      if (res.code !== 0) setError(res.msg);
      setManage(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveExtensions = async () => {
    if (!manage) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.profileExtensionsBind(manage.id, extSel);
      if (res.code !== 0) setError(res.msg);
      setManage(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <header className="page-header">
        <h1>Profiles</h1>
        <div className="actions">
          <button onClick={() => setShowBatch((v) => !v)}>Batch create</button>
          <button onClick={() => setShowCsv((v) => !v)}>Import CSV</button>
          <button className="primary" onClick={() => void create()} disabled={busy}>
            + New profile
          </button>
        </div>
      </header>

      {error ? <div className="error">{error}</div> : null}

      {showBatch ? (
        <div className="panel">
          <div className="form-row">
            <input
              placeholder="count"
              value={batchCount}
              onChange={(e) => setBatchCount(e.target.value)}
              style={{ width: 80 }}
            />
            <input
              placeholder="name prefix"
              value={batchPrefix}
              onChange={(e) => setBatchPrefix(e.target.value)}
            />
            <button className="primary" onClick={() => void batchCreate()} disabled={busy}>
              Create
            </button>
          </div>
        </div>
      ) : null}

      {showCsv ? (
        <div className="panel">
          <textarea
            placeholder={'name,timezone\nacc-1,Europe/Sofia\nacc-2,Europe/Paris'}
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            rows={4}
            style={{ width: '100%', fontFamily: 'monospace' }}
          />
          <div className="form-row" style={{ marginTop: 8 }}>
            <button className="primary" onClick={() => void importCsv()} disabled={busy}>
              Import
            </button>
          </div>
        </div>
      ) : null}

      {endpoint ? (
        <div className="endpoint">
          <strong>CDP endpoint ({endpoint.id}):</strong>
          <code>{endpoint.ws}</code>
          <span className="hint">
            Connect with puppeteer.connect(&#123; browserWSEndpoint &#125;) or
            playwright.chromium.connectOverCDP(...)
          </span>
        </div>
      ) : null}

      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>ID</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {profiles.length === 0 ? (
            <tr>
              <td colSpan={4} className="empty">
                No profiles yet. Create one to get started.
              </td>
            </tr>
          ) : (
            profiles.map((p) => (
              <tr key={p.user_id}>
                <td>{p.name ?? '—'}</td>
                <td className="mono">{p.user_id}</td>
                <td>
                  <span className={p.status === 'running' ? 'badge running' : 'badge'}>
                    {p.status}
                  </span>
                </td>
                <td className="actions">
                  {p.status === 'running' ? (
                    <button onClick={() => void stop(p.user_id)} disabled={busy}>
                      Stop
                    </button>
                  ) : (
                    <button onClick={() => void start(p.user_id)} disabled={busy}>
                      Start
                    </button>
                  )}
                  <button onClick={() => void openManage(p.user_id, 'cookies')}>Cookies</button>
                  <button onClick={() => void openManage(p.user_id, 'fingerprint')}>Fingerprint</button>
                  <button onClick={() => void openManage(p.user_id, 'extensions')}>Extensions</button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {manage ? (
        <div className="panel">
          <div className="form-row">
            <strong>Profile {manage.id}</strong>
            <button onClick={() => setManage(null)}>Close</button>
          </div>
          {manage.tab === 'cookies' ? (
            <>
              <textarea
                placeholder='[{"name":"a","value":"b","domain":"example.com","path":"/"}]'
                value={cookiesText}
                onChange={(e) => setCookiesText(e.target.value)}
                rows={5}
                style={{ width: '100%', fontFamily: 'monospace' }}
              />
              <div className="form-row" style={{ marginTop: 8 }}>
                <button className="primary" onClick={() => void saveCookies()} disabled={busy}>
                  Import cookies
                </button>
                <button onClick={() => void exportCookies()} disabled={busy}>
                  Export cookies
                </button>
              </div>
            </>
          ) : manage.tab === 'fingerprint' ? (
            <>
              <textarea
                placeholder={'{"platform":"windows","brand":"Chrome","hardwareConcurrency":8,"disableSpoofing":"canvas"}'}
                value={fpConfig}
                onChange={(e) => setFpConfig(e.target.value)}
                rows={3}
                style={{ width: '100%', fontFamily: 'monospace' }}
              />
              <div className="form-row" style={{ marginTop: 8 }}>
                <button className="primary" onClick={() => void saveFingerprint()} disabled={busy}>
                  Save fingerprint config
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="form-row" style={{ marginTop: 8 }}>
                {extensions.map((e) => (
                  <label key={e.extension_id} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      checked={extSel.includes(e.extension_id)}
                      onChange={(ev) =>
                        setExtSel((prev) =>
                          ev.target.checked
                            ? [...prev, e.extension_id]
                            : prev.filter((x) => x !== e.extension_id)
                        )
                      }
                    />
                    {e.name}
                  </label>
                ))}
                {extensions.length === 0 ? <span className="hint">No extensions imported.</span> : null}
              </div>
              <div className="form-row" style={{ marginTop: 8 }}>
                <button className="primary" onClick={() => void saveExtensions()} disabled={busy}>
                  Save extensions
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
