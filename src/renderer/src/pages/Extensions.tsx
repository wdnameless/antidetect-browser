import { useCallback, useEffect, useState } from 'react';
import { EmptyState } from '../components/EmptyState';
import { api, type ExtensionItem, type ProfileListItem } from '../api';
import { ExtensionsIcon, PlusIcon, TrashIcon } from '../icons';
import { useI18n } from '../i18n';

export function Extensions() {
  const { t } = useI18n();
  const [extensions, setExtensions] = useState<ExtensionItem[]>([]);
  const [profiles, setProfiles] = useState<ProfileListItem[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [extPath, setExtPath] = useState('');
  const [webStoreInput, setWebStoreInput] = useState('');
  const [webStoreBusy, setWebStoreBusy] = useState(false);
  const [webStoreSuccess, setWebStoreSuccess] = useState('');
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

  const installWebStore = async () => {
    if (!webStoreInput.trim()) return;
    setWebStoreBusy(true);
    setError('');
    setWebStoreSuccess('');
    try {
      const res = await api.extensionInstall({ url: webStoreInput.trim() });
      // Every other action on this page checks `code`; this one did not, so a refused install
      // still printed a success line. The failure is reported as an HTTP error envelope, and
      // `request()` returns that envelope rather than throwing — so without this the operator
      // saw `Installed "" (v)` for an extension that was never installed.
      if (res.code !== 0) {
        setError(res.msg || 'Install failed');
        return;
      }
      const info = res.data ?? { extension_id: '', name: '', version: '', reused: false };
      setWebStoreSuccess(`Installed "${info.name}" (v${info.version})${info.reused ? ' [reused]' : ''}`);
      setWebStoreInput('');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setWebStoreBusy(false);
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
      // `bindExtensions` REPLACES the profile's whole binding set, so sending only the clicked
      // extension silently unbound every other one the profile had. Verified: binding A, then
      // binding B, left the profile with B alone. The current set is read first and the new
      // extension added to it, which is what "Bind to Profile" means to the operator.
      const current = await api.profileExtensions(bindTarget.profileId);
      const existing = current.code === 0 ? current.data.extension_ids : [];
      const merged = Array.from(new Set([...existing, bindTarget.extId]));
      const res = await api.profileExtensionsBind(bindTarget.profileId, merged);
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

      <div className="panel" style={{ marginBottom: 20 }}>
        <div className="panel-header">Install from Chrome Web Store</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            style={{ flex: 1 }}
            placeholder="Enter Web Store URL or 32-char ID (e.g. https://chromewebstore.google.com/detail/...)"
            value={webStoreInput}
            onChange={(e) => setWebStoreInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void installWebStore();
            }}
            disabled={webStoreBusy}
          />
          <button
            className="btn primary"
            onClick={() => void installWebStore()}
            disabled={webStoreBusy || !webStoreInput.trim()}
          >
            {webStoreBusy ? 'Installing...' : 'Install from Web Store'}
          </button>
        </div>
        {webStoreSuccess ? (
          <div style={{ marginTop: 8, color: 'var(--ok)', fontSize: 13 }}>
            {webStoreSuccess}
          </div>
        ) : null}
      </div>
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
              <EmptyState
                colSpan={4}
                icon={<ExtensionsIcon size={32} />}
                title={t('No extensions imported yet')}
                description="Import an unpacked extension folder (e.g. MetaMask, EditThisCookie) to load it into your profiles. Click + Import Extension to get started."
                action={
                  <button className="btn btn-sm primary" onClick={() => setShowForm(true)}>
                    <PlusIcon size={13} />
                    <span>Import Extension</span>
                  </button>
                }
              />
            ) : (
            extensions.map((e) => (
              <tr key={e.extension_id} className="row-dense">
                <td>
                  <div className="row-dense__lead">
                    <strong style={{ fontSize: 13.5, color: 'var(--text)' }}>{e.name}</strong>
                  </div>
                </td>
                <td>
                  <span className="proxy-type-badge">{e.version || '1.0.0'}</span>
                </td>
                <td>
                  <div className="row-dense__meta">
                    <code style={{ fontSize: 12, color: 'var(--text-muted)' }}>{e.path}</code>
                  </div>
                </td>
                <td>
                  <div className="row-dense__actions" style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
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
                          title="Расширение будет загружаться в этом профиле / The extension loads in this profile"
                        >
                          {t('Bind to Profile')}
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
