import { useCallback, useEffect, useState } from 'react';
import { api, type CatalogScriptItem } from '../api';
import { useI18n } from '../i18n';
import { RefreshIcon, CheckIcon } from '../icons';

export function Catalog() {
  const { t } = useI18n();
  const [entries, setEntries] = useState<CatalogScriptItem[]>([]);
  const [url, setUrl] = useState('');
  const [urlEditing, setUrlEditing] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [viewCodeState, setViewCodeState] = useState<{ name: string; code: string; checksum: string; entry: CatalogScriptItem } | null>(null);
  const [installedIds, setInstalledIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await api.catalogFetch();
      if (res.code === 0) {
        setEntries(res.data.scripts || []);
        setUrl(res.data.url || '');
        setUrlEditing(res.data.url || '');
      } else {
        setEntries([]);
        setError(`${res.code}: ${res.msg}`);
        const urlRes = await api.catalogGetUrl();
        if (urlRes.code === 0) {
          setUrl(urlRes.data.url || '');
          setUrlEditing(urlRes.data.url || '');
        }
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const saveUrl = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const res = await api.catalogSetUrl(urlEditing.trim());
      if (res.code === 0) {
        setNotice(t('Catalog URL saved.'));
        await load();
      } else {
        setError(res.msg);
      }
    } finally {
      setBusy(false);
    }
  };

  const viewCode = async (entry: CatalogScriptItem) => {
    setBusy(true);
    setError('');
    try {
      const res = await api.catalogCode(entry.url);
      if (res.code === 0) {
        setViewCodeState({ name: entry.name, code: res.data.code, checksum: res.data.checksum, entry });
      } else {
        setError(res.msg);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const install = async (entry: CatalogScriptItem) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const res = await api.catalogInstall(entry.id);
      if (res.code === 0) {
        setNotice(t('Script installed: ') + entry.name);
        setInstalledIds((s) => new Set([...s, entry.id]));
      } else {
        setError(String(res.code) === 'CHECKSUM_MISMATCH' ? `${t('Checksum mismatch — install blocked.')} (${res.msg})` : res.msg);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="page-header-actions" style={{ marginBottom: 14 }}>
        <div className="header-filters" style={{ flex: 1 }}>
          <input
            className="select-input"
            style={{ flex: 1, minWidth: 260 }}
            placeholder={t('Catalog manifest URL (GitHub raw JSON)')}
            value={urlEditing}
            onChange={(e) => setUrlEditing(e.target.value)}
          />
        </div>
        <div className="header-btn-group">
          <button className="btn" onClick={() => void saveUrl()} disabled={busy}>
            {t('Save URL')}
          </button>
          <button className="btn primary" onClick={() => void load()} disabled={busy}>
            <RefreshIcon size={14} />
            <span>{t('Refresh')}</span>
          </button>
        </div>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}
      {notice ? <div className="endpoint-banner"><span style={{ color: 'var(--ok)', fontSize: 13 }}>{notice}</span></div> : null}

      {entries.length === 0 ? (
        <div className="table-container" style={{ padding: '40px 16px', textAlign: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)' }}>
            {t('No catalog entries. Point the manifest URL at your GitHub raw JSON and refresh.')}
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
          {entries.map((entry) => (
            <div
              key={entry.id}
              className="card"
              style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <strong style={{ fontSize: 14, flex: 1 }}>{entry.name}</strong>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>v{entry.version}</span>
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', minHeight: 32 }}>{entry.description}</div>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                {(entry.tags || []).map((tg) => (
                  <span key={tg} className="group-tag" style={{ fontSize: 10.5 }}>#{tg}</span>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 'auto' }}>
                <button className="btn btn-sm" onClick={() => void viewCode(entry)} disabled={busy}>
                  {t('View code')}
                </button>
                <button
                  className="btn btn-sm primary"
                  onClick={() => void install(entry)}
                  disabled={busy || installedIds.has(entry.id)}
                >
                  {installedIds.has(entry.id) ? <><CheckIcon size={11} /> {t('Installed')}</> : t('Install')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* View code modal */}
      {viewCodeState ? (
        <div className="modal-overlay" onClick={() => setViewCodeState(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720 }}>
            <div className="modal-header">
              <h3>{t('View code')} — {viewCodeState.name}</h3>
              <button className="btn-icon" onClick={() => setViewCodeState(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p className="hint">
                {t('Review before installing. sha256:')} <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{viewCodeState.checksum}</code>
              </p>
              <pre
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 12,
                  maxHeight: 380,
                  overflow: 'auto',
                  background: 'rgba(255,255,255,0.03)',
                  padding: 12,
                  borderRadius: 8,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {viewCodeState.code}
              </pre>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setViewCodeState(null)}>{t('Cancel')}</button>
              <button
                className="btn primary"
                onClick={async () => { const e = viewCodeState.entry; setViewCodeState(null); await install(e); }}
                disabled={busy || installedIds.has(viewCodeState.entry.id)}
              >
                {t('Install')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}