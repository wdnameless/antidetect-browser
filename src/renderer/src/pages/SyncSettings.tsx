import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useI18n } from '../i18n';
import { RefreshIcon } from '../icons';

/**
 * Settings → Sync: endpoint mode (cloud default / custom self-host), URL
 * input and live connection status. An unreachable endpoint never blocks the
 * rest of the app.
 */
export function SyncSettings() {
  const { t } = useI18n();
  const [mode, setMode] = useState<'cloud' | 'custom'>('cloud');
  const [url, setUrl] = useState('');
  const [defaultUrl, setDefaultUrl] = useState('');
  const [status, setStatus] = useState<{ connected: boolean; url: string; error?: string; version?: string; token: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [licenseOk, setLicenseOk] = useState(true);

  const load = useCallback(() => {
    setBusy(true);
    void api
      .licenseState()
      .then((res) => setLicenseOk(res.data?.plan === 'pro'))
      .catch(() => undefined);
    api
      .syncEndpoint()
      .then((res) => {
        if (res.code === 0) {
          setMode(res.data.mode);
          setUrl(res.data.mode === 'custom' ? res.data.url : '');
          setDefaultUrl(res.data.default_url ?? '');
        }
      })
      .catch(() => undefined);
    api
      .syncStatus()
      .then((res) => {
        if (res.code === 0) setStatus(res.data);
      })
      .catch(() => undefined)
      .finally(() => setBusy(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (nextMode: 'cloud' | 'custom', nextUrl?: string) => {
    setMsg('');
    setBusy(true);
    try {
      const res = await api.syncEndpointSet(nextMode, nextUrl);
      if (res.code === 0) {
        setMode(nextMode);
        if (nextMode === 'custom' && nextUrl) setUrl(nextUrl);
        const st = await api.syncStatus();
        if (st.code === 0) setStatus(st.data);
        setMsg(t('Saved'));
      } else {
        setMsg(res.msg);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      <div className="panel-header">{t('Team Sync')}</div>

      <div className="setting-row">
        <span className="setting-label">{t('Endpoint mode')}</span>
        <select
          className="select-input"
          value={mode}
          onChange={(e) => {
            const m = e.target.value as 'cloud' | 'custom';
            if (m === 'cloud') void save('cloud');
            else setMode('custom');
          }}
          style={{ minWidth: 160 }}
        >
          <option value="cloud">{t('Cloud (default)')}</option>
          <option value="custom">{t('Custom (self-host)')}</option>
        </select>
      </div>

      {mode === 'custom' ? (
        <div className="setting-row">
          <span className="setting-label">{t('Server URL')}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="input"
              placeholder="http://your-server:8787"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              style={{ minWidth: 280 }}
            />
            <button className="btn primary" onClick={() => void save('custom', url.trim())} disabled={busy || !url.trim()}>
              {t('Save')}
            </button>
          </div>
        </div>
      ) : (
        <div className="setting-row">
          <span className="setting-label">{t('Endpoint URL')}</span>
          <code>{defaultUrl || '—'}</code>
        </div>
      )}

      <div className="setting-row">
        <span className="setting-label">{t('Connection status')}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              display: 'inline-block',
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: status?.connected ? 'var(--ok, #3fa34d)' : 'var(--warn, #c0392b)',
            }}
          />
          <span style={{ fontSize: 13 }}>
            {status?.connected
              ? `${t('Connected')} · ${status.url}${status.version ? ` · v${status.version}` : ''}`
              : status
                ? `${t('Unreachable')}: ${status.error ?? '—'}`
                : t('Checking…')}
          </span>
          <button className="btn" onClick={load} disabled={busy} title={t('Refresh')}>
            <RefreshIcon size={13} />
          </button>
        </div>
      </div>

      {!licenseOk ? <p className="hint" style={{ color: 'var(--warn)' }}>{t('Teams and sync require a Pro license (Settings → License).')}</p> : null}
      {msg ? <p className="hint">{msg}</p> : null}
      <p className="hint">
        {t('Bundles are end-to-end encrypted (AES-256-GCM, HKDF team key). The server stores only ciphertext.')}
      </p>
    </div>
  );
}