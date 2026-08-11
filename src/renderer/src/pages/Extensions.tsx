import { useCallback, useEffect, useState } from 'react';
import { api, type ExtensionItem, type ProfileListItem } from '../api';

export function Extensions() {
  const [extensions, setExtensions] = useState<ExtensionItem[]>([]);
  const [profiles, setProfiles] = useState<ProfileListItem[]>([]);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [bindTarget, setBindTarget] = useState<{ extId: string; profileId: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [e, p] = await Promise.all([api.extensionList(), api.list()]);
      if (e.code === 0) setExtensions(e.data.list);
      if (p.code === 0) setProfiles(p.data.list);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const importExt = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await api.extensionImport(name || 'extension', path);
      if (res.code !== 0) setError(res.msg);
      setName('');
      setPath('');
      setShowForm(false);
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
      const res = await api.extensionDelete(id);
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
      const res = await api.profileExtensionsBind(bindTarget.profileId, [bindTarget.extId]);
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
        <h1>Extensions</h1>
        <button className="primary" onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Cancel' : '+ Import extension'}
        </button>
      </header>

      {error ? <div className="error">{error}</div> : null}

      {showForm ? (
        <div className="panel">
          <div className="form-row">
            <input placeholder="name" value={name} onChange={(e) => setName(e.target.value)} />
            <input
              placeholder="path to unpacked folder or .zip"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              style={{ minWidth: 320 }}
            />
            <button className="primary" onClick={() => void importExt()} disabled={busy}>
              Import
            </button>
          </div>
          <p className="hint">
            Укажите путь к распакованной папке расширения или .zip (с manifest.json внутри).
          </p>
        </div>
      ) : null}

      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Version</th>
            <th>Path</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {extensions.length === 0 ? (
            <tr>
              <td colSpan={4} className="empty">
                No extensions imported.
              </td>
            </tr>
          ) : (
            extensions.map((e) => (
              <tr key={e.extension_id}>
                <td>{e.name}</td>
                <td>{e.version ?? '—'}</td>
                <td className="mono">{e.path}</td>
                <td className="actions">
                  <button
                    onClick={() =>
                      setBindTarget({ extId: e.extension_id, profileId: profiles[0]?.user_id ?? '' })
                    }
                  >
                    Bind to profile
                  </button>
                  <button onClick={() => void remove(e.extension_id)} disabled={busy}>
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
            <span>Bind extension to profile:</span>
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
