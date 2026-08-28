import { useCallback, useEffect, useState } from 'react';
import { api, type TrashItem } from '../api';
import { useI18n } from '../i18n';
import { TrashIcon, RefreshIcon } from '../icons';

export function Trash() {
  const { t } = useI18n();
  const [items, setItems] = useState<TrashItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await api.trashList();
      if (res.code === 0) setItems(res.data.list);
      else setError(res.msg);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const restore = async (id: string) => {
    setBusy(true);
    setError('');
    try {
      const res = await api.trashRestore(id);
      if (res.code === 0) await load();
      else setError(res.msg);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const deleteForever = async (id: string, name: string) => {
    if (!window.confirm(t('Permanently delete this profile? This cannot be undone.') + ` (${name})`)) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.trashDeleteForever(id);
      if (res.code === 0) await load();
      else setError(res.msg);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="page-header-actions" style={{ marginBottom: 14 }}>
        <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
          {t('Deleted profiles are kept for 30 days, then purged automatically.')}
        </span>
        <div className="header-btn-group">
          <button className="btn" onClick={() => void load()} disabled={busy}>
            <RefreshIcon size={14} />
            <span>{t('Refresh')}</span>
          </button>
        </div>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: '30%' }}>{t('Profile Name')}</th>
              <th style={{ width: '20%' }}>{t('Group')}</th>
              <th style={{ width: '25%' }}>{t('Deleted at')}</th>
              <th style={{ width: '25%', textAlign: 'right' }}>{t('Actions')}</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={4} className="empty-cell">
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '24px 0' }}>
                    <TrashIcon size={32} style={{ opacity: 0.3 }} />
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)' }}>
                      {t('Trash is empty')}
                    </div>
                  </div>
                </td>
              </tr>
            ) : (
              items.map((it) => (
                <tr key={it.id}>
                  <td>
                    <strong style={{ fontSize: 13.5 }}>{it.name || it.id}</strong>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                      {it.id.slice(0, 14)}...
                    </div>
                  </td>
                  <td style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{it.group_name || t('(No Group / Ungrouped)')}</td>
                  <td style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
                    {it.deleted_at ? new Date(it.deleted_at).toLocaleString() : '—'}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <button className="btn btn-sm" onClick={() => void restore(it.id)} disabled={busy}>
                        {t('Restore')}
                      </button>
                      <button
                        className="btn btn-sm btn-danger"
                        onClick={() => void deleteForever(it.id, it.name || it.id)}
                        disabled={busy}
                      >
                        {t('Delete forever')}
                      </button>
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