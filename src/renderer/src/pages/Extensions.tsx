import { useCallback, useEffect, useState } from 'react';
import { api, type ExtensionItem, type ProfileListItem } from '../api';
import { ExtensionsIcon, PlusIcon, TrashIcon } from '../icons';

export function Extensions() {
  const [extensions, setExtensions] = useState<ExtensionItem[]>([]);
  const [profiles, setProfiles] = useState<ProfileListItem[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [extPath, setExtPath] = useState('');

  const [bindTarget, setBindTarget] = useState<{ extId: string; profileId: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [extRes, profRes] = await Promise.all([api.extensionList(), api.list()]);
      if (extRes.code === 0) setExtensions(extRes.data.list);
      if (profRes.code === 0) setProfiles(profRes.data.list);
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
      const res = await api.extensionImport(name.trim(), extPath.trim());
      if (res.code === 0) {
        setShowForm(false);
        setName('');
        setExtPath('');
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
    if (!confirm('Are you sure you want to delete this extension?')) return;
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
    <div>
      <div className="page-header-actions">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <ExtensionsIcon size={20} style={{ color: 'var(--accent)' }} />
          <h2 style={{ fontSize: 16, fontWeight: 700 }}>Extensions Manager</h2>
          <span className="hint" style={{ margin: 0 }}>({extensions.length} extensions imported)</span>
        </div>

        <button className="btn primary" onClick={() => setShowForm((v) => !v)}>
          <PlusIcon size={15} />
          <span>{showForm ? 'Cancel' : 'Import Extension'}</span>
        </button>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      {showForm ? (
        <div className="panel" style={{ marginBottom: 20 }}>
          <div className="panel-header">Import Unpacked / CRX Extension</div>
          <div className="form-group" style={{ marginBottom: 12 }}>
            <label>Extension Name</label>
            <input
              placeholder="e.g. MetaMask, EditThisCookie"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="form-group" style={{ marginBottom: 16 }}>
            <label>Absolute Folder Path or .CRX Path</label>
            <input
              placeholder="C:\extensions\metamask or /path/to/extension"
              value={extPath}
              onChange={(e) => setExtPath(e.target.value)}
              style={{ fontFamily: 'var(--font-mono)' }}
            />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn primary"
              onClick={() => void importExt()}
              disabled={busy || !name.trim() || !extPath.trim()}
            >
              Import Extension
            </button>
            <button className="btn" onClick={() => setShowForm(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: '22%' }}>Extension Name</th>
              <th style={{ width: '12%' }}>Version</th>
              <th style={{ width: '42%' }}>Folder Path</th>
              <th style={{ width: '24%', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {extensions.length === 0 ? (
              <tr>
                <td colSpan={4} className="empty-cell">
                  No extensions imported yet. Click "+ Import Extension" to register an unpacked extension folder.
                </td>
              </tr>
            ) : (
              extensions.map((e) => (
                <tr key={e.extension_id}>
                  <td>
                    <strong style={{ fontSize: 13.5 }}>{e.name}</strong>
                  </td>
                  <td>
                    <span className="proxy-type-badge">{e.version || '1.0.0'}</span>
                  </td>
                  <td>
                    <code style={{ fontSize: 12, color: 'var(--text-muted)' }}>{e.path}</code>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                      {bindTarget?.extId === e.extension_id ? (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <select
                            className="select-input"
                            value={bindTarget.profileId}
                            onChange={(evt) =>
                              setBindTarget({ extId: e.extension_id, profileId: evt.target.value })
                            }
                          >
                            <option value="">Select Profile</option>
                            {profiles.map((p) => (
                              <option key={p.user_id} value={p.user_id}>
                                {p.name || p.user_id}
                              </option>
                            ))}
                          </select>
                          <button
                            className="btn primary"
                            onClick={() => void bind()}
                            disabled={busy || !bindTarget.profileId}
                          >
                            Save
                          </button>
                          <button className="btn" onClick={() => setBindTarget(null)}>
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <>
                          <button
                            className="btn"
                            onClick={() => setBindTarget({ extId: e.extension_id, profileId: '' })}
                          >
                            Bind to Profile
                          </button>
                          <button
                            className="btn-icon"
                            style={{ color: 'var(--danger)' }}
                            onClick={() => void remove(e.extension_id)}
                            disabled={busy}
                            title="Delete Extension"
                          >
                            <TrashIcon size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
