import { useEffect, useState } from 'react';
import { getApiBase } from '../api';
import type { UpdateStatus } from '../global';
import { SettingsIcon, RefreshIcon } from '../icons';

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

export function Settings() {
  const [apiKey, setApiKey] = useState('');
  const [status, setStatus] = useState<UpdateStatus | null>(null);

  useEffect(() => {
    if (window.antidetect?.getApiKey) {
      void window.antidetect.getApiKey().then(setApiKey).catch(() => undefined);
    }
    if (window.antidetect?.update?.onStatus) {
      const off = window.antidetect.update.onStatus(setStatus);
      return off;
    }
  }, []);

  const busy = status?.state === 'checking' || status?.state === 'downloading';
  const updaterAvailable = Boolean(window.antidetect?.update);

  const onCheck = (): void => {
    setStatus({ state: 'checking' });
    void window.antidetect?.update.check();
  };

  const onDownload = (): void => {
    if (status?.state !== 'available') return;
    setStatus({ state: 'checking' });
    void window.antidetect?.update.download();
  };

  const onRestart = (): void => {
    void window.antidetect?.update.quitAndInstall();
  };

  const renderStatus = (): React.ReactNode => {
    if (!status) return null;
    switch (status.state) {
      case 'checking':
        return <p className="hint">Checking for updates…</p>;
      case 'not-available':
        return <p className="hint" style={{ color: 'var(--ok)', fontWeight: 500 }}>✓ You are on the latest version.</p>;
      case 'available':
        return (
          <div className="setting-row">
            <span className="setting-label">
              New version available: <strong>{status.info.version ? `v${status.info.version}` : 'New build'}</strong>
            </span>
            <button className="btn primary" onClick={onDownload} disabled={busy}>
              Download Update
            </button>
          </div>
        );
      case 'downloading':
        return (
          <div className="setting-row">
            <span className="setting-label">
              Downloading… {Math.round(status.percent)}% ({formatBytes(status.transferred)} /{' '}
              {formatBytes(status.total)})
            </span>
          </div>
        );
      case 'downloaded':
        return (
          <div className="setting-row">
            <span className="setting-label">
              Update ready: <strong>{status.info.version ? `v${status.info.version}` : 'Ready to install'}</strong>
            </span>
            <button className="btn primary" onClick={onRestart}>
              Restart &amp; install
            </button>
          </div>
        );
      case 'error':
        return <p className="hint" style={{ color: 'var(--danger)' }}>Update check failed: {status.message}</p>;
    }
  };

  return (
    <div>
      <div className="page-header-actions">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <SettingsIcon size={20} style={{ color: 'var(--accent)' }} />
          <h2 style={{ fontSize: 16, fontWeight: 700 }}>Settings &amp; Automation</h2>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">Local REST API (AdsPower-Compatible)</div>
        <div className="setting-row">
          <span className="setting-label">Endpoint URL</span>
          <code>{getApiBase()}</code>
        </div>
        <div className="setting-row">
          <span className="setting-label">Bearer API Key</span>
          <code>{apiKey || '—'}</code>
        </div>
        <p className="hint">
          Pass this key in your HTTP header: <code>Authorization: Bearer &lt;key&gt;</code> when connecting Puppeteer, Playwright, Selenium, or custom Python bots to the Local API.
        </p>
      </div>

      {updaterAvailable && (
        <div className="panel">
          <div className="panel-header">Software Updates</div>
          <div className="setting-row">
            <span className="setting-label">Release Channel (GitHub Releases)</span>
            <button className="btn" onClick={onCheck} disabled={busy}>
              <RefreshIcon size={14} />
              <span>Check for updates</span>
            </button>
          </div>
          {renderStatus()}
        </div>
      )}
    </div>
  );
}
