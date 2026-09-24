import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useI18n } from '../i18n';

/**
 * External URL for purchasing or inquiring about Pro licenses.
 * Operator: replace this with your storefront / checkout URL when ready.
 */
export const PRO_STORE_URL =
  'https://github.com/wdnameless/nulltrace-antidetect-browser/discussions';

/**
 * Opens an external URL via the Tauri shell bridge if available,
 * falling back to window.open in browser environments.
 */
export function openExternalUrl(url: string): void {
  if (!url.startsWith('https://')) return;
  if (typeof window !== 'undefined' && window.antidetect?.openExternal) {
    void window.antidetect.openExternal(url);
  } else if (typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

function TierCard({
  title,
  badge,
  features,
  action,
  highlight,
}: {
  title: string;
  badge?: React.ReactNode;
  features: string[];
  action?: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <div
      style={{
        padding: 14,
        background: 'var(--surface-1)',
        border: highlight ? '1px solid var(--border-focus)' : '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{title}</span>
        {badge}
      </div>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {features.map((feat) => (
          <li key={feat}>{feat}</li>
        ))}
      </ul>
      {action}
    </div>
  );
}

/**
 * Navigates to the Settings → License view so an existing key can be entered.
 */
export function navigateToLicense(): void {
  const licenseSectionBtn = Array.from(document.querySelectorAll<HTMLButtonElement>('.settings-nav-item')).find((btn) => {
    const text = btn.textContent?.toLowerCase() ?? '';
    return text.includes('license') || text.includes('лиценз');
  });
  if (licenseSectionBtn) {
    licenseSectionBtn.click();
    return;
  }

  const settingsNavBtn = Array.from(document.querySelectorAll<HTMLButtonElement>('.nav-item')).find((btn) => {
    const text = btn.textContent?.toLowerCase() ?? '';
    const aria = btn.getAttribute('aria-label')?.toLowerCase() ?? '';
    return text.includes('settings') || text.includes('настройк') || aria.includes('settings') || aria.includes('настройк');
  });
  if (settingsNavBtn) {
    settingsNavBtn.click();
    setTimeout(() => {
      const btn = Array.from(document.querySelectorAll<HTMLButtonElement>('.settings-nav-item')).find((b) => {
        const text = b.textContent?.toLowerCase() ?? '';
        return text.includes('license') || text.includes('лиценз');
      });
      btn?.click();
    }, 50);
  }
}
/**
 * Shared call to action block for Pro-gated features (Sync, Teams).
 */
export function ProGateCallToAction({ message }: { message: string }) {
  const { t } = useI18n();
  return (
    <div
      style={{
        margin: '14px 0',
        padding: 14,
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border)',
        background: 'var(--surface-2)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ fontSize: 13, color: 'var(--text)' }}>{message}</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          className="btn primary"
          onClick={() => openExternalUrl(PRO_STORE_URL)}
        >
          {t('Get Pro')}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => navigateToLicense()}
        >
          {t('Enter license key')}
        </button>
      </div>
    </div>
  );
}


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
        setKey('');
        try {
          await window.antidetect?.licenseRefresh?.();
        } catch {
          // Non-blocking: background verdict file refresh for packaged shell
        }
        let fresh = await api.licenseState();
        if (fresh.code === 0 && fresh.data.plan !== 'pro') {
          await new Promise<void>((resolve) => {
            setTimeout(resolve, 150);
          });
          const retry = await api.licenseState();
          if (retry.code === 0) fresh = retry;
        }
        if (fresh.code === 0) {
          setState(fresh.data);
          if (fresh.data.plan === 'pro') {
            setMsg(t('License activated'));
          } else {
            setMsg(t('License activating…'));
          }
        } else {
          setState(res.data);
          setMsg(t('License activated'));
        }
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
      if (res.code === 0) {
        try {
          await window.antidetect?.licenseRefresh?.();
        } catch {
          // Non-blocking: background verdict file refresh for packaged shell
        }
        const fresh = await api.licenseState();
        if (fresh.code === 0) {
          setState(fresh.data);
        } else {
          setState(res.data);
        }
      }
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
      <div
        style={{
          margin: '16px 0',
          padding: 16,
          background: 'var(--surface-2)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)',
        }}
      >
        <p style={{ margin: '0 0 12px 0', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
          {t('Free is a complete product, not a trial: all local features, profiles, and API access are fully unlocked without limits.')}
        </p>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: 16,
          }}
        >
          <TierCard
            title="Free"
            badge={
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {isPro ? t('Included') : t('Current plan')}
              </span>
            }
            features={[
              t('Unlimited profiles, fingerprints, proxies, cookie farm'),
              t('The full local API and MCP tool surface'),
            ]}
          />

          <TierCard
            title="Pro"
            highlight={!isPro}
            badge={
              isPro ? (
                <span style={{ fontSize: 11, color: 'var(--ok)', fontWeight: 600 }}>{t('Active')}</span>
              ) : null
            }
            features={[
              t('Everything in Free'),
              t('Team collaboration (shared profiles, roles)'),
              t('Encrypted cloud sync (AES-256-GCM, HKDF team key)'),
              t('Support development of the project'),
            ]}
            action={
              !isPro ? (
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => openExternalUrl(PRO_STORE_URL)}
                  style={{ marginTop: 4, width: '100%' }}
                >
                  {t('Get Pro')}
                </button>
              ) : null
            }
          />
        </div>
      </div>


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
      ) : state?.email ? (
        <div className="setting-row">
          <span className="setting-label">{t('Actions')}</span>
          <button className="btn" onClick={() => void deactivate()} disabled={busy}>
            {t('Deactivate')}
          </button>
        </div>
      ) : null}

      {msg ? <p className="hint" style={err ? { color: 'var(--warn)' } : undefined}>{msg}</p> : null}
      <p className="hint">
        {t('Pro unlocks Teams, RBAC and encrypted cloud sync. Keys are validated offline — no account needed.')}
      </p>
    </div>
  );
}