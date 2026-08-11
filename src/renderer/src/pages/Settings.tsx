import { useEffect, useState } from 'react';
import { getApiBase } from '../api';
import type { UpdateStatus } from '../global';

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
        return <p className="hint ok-text">You are on the latest version.</p>;
      case 'available':
        return (
          <div className="setting-row">
            <span className="setting-label">
              Update available{status.info.version ? ` v${status.info.version}` : ''}
            </span>
            <button className="btn" onClick={onDownload} disabled={busy}>
              Download
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
            <span className="setting-label">Update ready{status.info.version ? ` v${status.info.version}` : ''}</span>
            <button className="btn primary" onClick={onRestart}>
              Restart &amp; install
            </button>
          </div>
        );
      case 'error':
        return <p className="hint error-text">Update failed: {status.message}</p>;
    }
  };

  return (
    <section>
      <header className="page-header">
        <h1>Settings</h1>
      </header>

      <div className="panel">
        <div className="setting-row">
          <span className="setting-label">Local API base</span>
          <code>{getApiBase()}</code>
        </div>
        <div className="setting-row">
          <span className="setting-label">API key</span>
          <code>{apiKey || '—'}</code>
        </div>
        <p className="hint">
          Используйте ключ в заголовке <code>Authorization: Bearer &lt;key&gt;</code> для вызовов Local API из
          ваших автоматизаций (Puppeteer / Playwright / Selenium / Python).
        </p>
      </div>

      {updaterAvailable && (
        <div className="panel">
          <div className="setting-row">
            <span className="setting-label">Updates</span>
            <button className="btn" onClick={onCheck} disabled={busy}>
              Check for updates
            </button>
          </div>
          {renderStatus()}
        </div>
      )}
    </section>
  );
}
