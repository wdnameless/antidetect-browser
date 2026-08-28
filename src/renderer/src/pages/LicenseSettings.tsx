import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useI18n } from '../i18n';

/**
 * Settings → License: activate/deactivate the offline license key
 * (base64url payload + Ed25519 signature, validated locally).
 */
export function LicenseSettings() {
  const { t } = useI18n();
  const [state, setState] = useState<{ plan: 'free' | 'pro'; email?: string; exp?: number; expired: boolean } | null>(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState(false);

  const load = useCallback(() => {
    api
      .licenseState()
      .then((res) => {
        if (res.code === 0) setState(res.data);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const activate = async () => {
    if (!key.trim()) return;
    setBusy(true);
    setMsg('');
    setErr(false);
    try {
      const res = await api.licenseActivate(key.trim());
      if (res.code === 0) {
        setState(res.data);
        setMsg(t('License activated'));
        setKey('');
      } else if (String(res.code) === 'LICENSE_EXPIRED') {
        setMsg(t('License expired'));
        setErr(true);
      } else {
        setMsg(t('Invalid license key'));
        setErr(true);
      }
    } finally {
      setBusy(false);
    }
  };

  const deactivate = async () => {
    setBusy(true);
    try {
      const res = await api.licenseDeactivate();
      if (res.code === 0) setState(res.data);
      setMsg(t('License removed'));
    } finally {
      setBusy(false);
    }
  };

  const isPro = state?.plan === 'pro';

  return (
    <div className="panel">
      <div className="panel-header">{t('License')}</div>

      <div className="setting-row">
        <span className="setting-label">{t('Current plan')}</span>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{isPro ? 'Pro' : 'Free'}</span>
      </div>

      {state?.email ? (
        <div className="setting-row">
          <span className="setting-label">{t('Licensed to')}</span>
          <code>{state.email}</code>
        </div>
      ) : null}

      {typeof state?.exp === 'number' ? (
        <div className="setting-row">
          <span className="setting-label">{t('Valid until')}</span>
          <code>{new Date(state.exp * 1000).toLocaleDateString()}</code>
        </div>
      ) : null}

      {state?.expired ? (
        <p className="hint" style={{ color: 'var(--warn)' }}>{t('Your license has expired — the app is running in Free mode.')}</p>
      ) : null}

      {!isPro ? (
        <div className="setting-row">
          <span className="setting-label">{t('License key')}</span>
          <div style={{ display: 'flex', gap: 8, flex: 1 }}>
            <input
              className="input"
              placeholder="eyJwbGFu...  .  <signature>"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              style={{ flex: 1, minWidth: 280 }}
            />
            <button className="btn primary" onClick={() => void activate()} disabled={busy || !key.trim()}>
              {t('Activate')}
            </button>
          </div>
        </div>
      ) : (
        <div className="setting-row">
          <span className="setting-label">{t('Actions')}</span>
          <button className="btn" onClick={() => void deactivate()} disabled={busy}>
            {t('Deactivate')}
          </button>
        </div>
      )}

      {msg ? <p className="hint" style={err ? { color: 'var(--warn)' } : undefined}>{msg}</p> : null}
      <p className="hint">
        {t('Pro unlocks Teams, RBAC and encrypted cloud sync. Keys are validated offline — no account needed.')}
      </p>
    </div>
  );
}