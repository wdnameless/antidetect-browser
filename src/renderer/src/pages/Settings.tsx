import { useEffect, useState } from 'react';
import { getApiBase } from '../api';
import type { UpdateStatus } from '../global';
import { useI18n, type Lang } from '../i18n';
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
  const { t, lang, setLang } = useI18n();
  const [apiKey, setApiKey] = useState('');
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [dataDir, setDataDir] = useState('');
  const [dataDirMsg, setDataDirMsg] = useState('');
  const [logDir, setLogDir] = useState('');
  const [logFiles, setLogFiles] = useState<Array<{ name: string; size: number; modified: number }>>([]);
  const [kernelInfo, setKernelInfo] = useState<{ installed: string | null; latest: string | null; updateAvailable: boolean; releaseUrl?: string; error?: string } | null>(null);
  const [kernelChecking, setKernelChecking] = useState(false);

  const checkKernel = (): void => {
    setKernelChecking(true);
    void import('../api').then(({ api }) => {
      api.kernelCheckUpdate().then((res) => {
        if (res.code === 0) setKernelInfo(res.data);
        setKernelChecking(false);
      }).catch(() => setKernelChecking(false));
    });
  };

  useEffect(() => {
    if (window.antidetect?.getApiKey) {
      void window.antidetect.getApiKey().then(setApiKey).catch(() => undefined);
    }
    if (window.antidetect?.data?.getDir) {
      void window.antidetect.data.getDir().then(setDataDir).catch(() => undefined);
    }
    void import('../api').then(({ api }) => {
      api.logsList().then((res) => {
        if (res.code === 0) {
          setLogDir(res.data.dir);
          setLogFiles(res.data.list.slice(0, 3));
        }
      }).catch(() => undefined);
      api.kernelInfo().then((res) => {
        if (res.code === 0) setKernelInfo({ installed: res.data.installed, latest: null, updateAvailable: false });
      }).catch(() => undefined);
    });
    if (window.antidetect?.update?.onStatus) {
      const off = window.antidetect.update.onStatus(setStatus);
      return off;
    }
  }, []);

  const busy = status?.state === 'checking' || status?.state === 'downloading';
  const updaterAvailable = Boolean(window.antidetect?.update);
  const dataApiAvailable = Boolean(window.antidetect?.data);

  const onChangeDataDir = (): void => {
    void window.antidetect?.data.setDir().then((r) => {
      setDataDir(r.dir);
      setDataDirMsg(r.ok ? 'Folder changed. Restart the app to apply.' : '');
    }).catch(() => setDataDirMsg('Failed to change folder.'));
  };

  const onOpenDataDir = (): void => {
    void window.antidetect?.data.openDir();
  };

  const onOpenLogsDir = (): void => {
    if (window.antidetect?.logs?.openDir) {
      void window.antidetect.logs.openDir();
    } else {
      void window.open(`file:///${logDir.replace(/\\/g, '/')}`);
    }
  };

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
        <div className="panel-header">{t('Language')}</div>
        <div className="setting-row">
          <span className="setting-label">{t('Language')}</span>
          <select
            className="select-input"
            value={lang}
            onChange={(e) => setLang(e.target.value as Lang)}
            style={{ minWidth: 140 }}
          >
            <option value="en">{t('English')}</option>
            <option value="ru">{t('Russian')}</option>
          </select>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">{t('Automation API (for your scripts)')}</div>
        <div className="setting-row">
          <span className="setting-label">Endpoint URL</span>
          <code>{getApiBase()}</code>
        </div>
        <div className="setting-row">
          <span className="setting-label">Bearer API Key</span>
          <code>{apiKey || '—'}</code>
        </div>
        <p className="hint">
          Use this key to connect your own bots and scripts (Puppeteer, Playwright, Selenium, Python) to the
          local API. Pass it in the HTTP header: <code>Authorization: Bearer &lt;key&gt;</code>.
        </p>
      </div>

      {dataApiAvailable && (
        <div className="panel">
          <div className="panel-header">Data Folder (Profiles, Cache, Kernel)</div>
          <div className="setting-row">
            <span className="setting-label">Current folder</span>
            <code style={{ wordBreak: 'break-all', maxWidth: '60%' }}>{dataDir || '—'}</code>
          </div>
          <div className="setting-row">
            <span className="setting-label">Actions</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" onClick={onChangeDataDir}>
                Change Folder…
              </button>
              <button className="btn" onClick={onOpenDataDir}>
                Open in Explorer
              </button>
            </div>
          </div>
          {dataDirMsg ? <p className="hint" style={{ color: 'var(--warn)' }}>{dataDirMsg}</p> : null}
          <p className="hint">
            All browser profiles, cookies, extensions, the Chromium kernel and the database are stored here.
            Changing the folder takes effect after restarting the app.
          </p>
        </div>
      )}

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

      <div className="panel">
        <div className="panel-header">Browser Kernel (fingerprint-chromium)</div>
        <div className="setting-row">
          <span className="setting-label">Installed version</span>
          <code>{kernelInfo?.installed ?? '—'}</code>
        </div>
        <div className="setting-row">
          <span className="setting-label">Upstream check</span>
          <button className="btn" onClick={checkKernel} disabled={kernelChecking}>
            <RefreshIcon size={14} />
            <span>{kernelChecking ? 'Checking…' : 'Check for kernel update'}</span>
          </button>
        </div>
        {kernelInfo?.latest ? (
          <p className="hint" style={{ color: kernelInfo.updateAvailable ? 'var(--warn)' : 'var(--ok)', fontWeight: 500 }}>
            {kernelInfo.updateAvailable
              ? `⚠ Update available: v${kernelInfo.latest} (installed v${kernelInfo.installed}). Download from the release page, then replace the folder in data/chromium.`
              : `✓ You are on the latest kernel (v${kernelInfo.latest}).`}
            {kernelInfo.releaseUrl ? (
              <>
                {' '}
                <a href={kernelInfo.releaseUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>
                  Open releases ↗
                </a>
              </>
            ) : null}
          </p>
        ) : null}
        {kernelInfo?.error ? <p className="hint" style={{ color: 'var(--danger)' }}>Check failed: {kernelInfo.error}</p> : null}
        <p className="hint">
          The kernel is intentionally pinned (stealth patches are version-specific). Updating is manual:
          download the new Windows build, replace the folder under <code>data/chromium/fingerprint-chromium</code>.
        </p>
      </div>

      <div className="panel">
        <div className="panel-header">Diagnostics &amp; Logs</div>
        <div className="setting-row">
          <span className="setting-label">Log folder</span>
          <code style={{ wordBreak: 'break-all', maxWidth: '55%' }}>{logDir || '—'}</code>
        </div>
        <div className="setting-row">
          <span className="setting-label">Actions</span>
          <button className="btn" onClick={onOpenLogsDir}>
            Open Logs Folder
          </button>
        </div>
        {logFiles.length > 0 ? (
          <div style={{ padding: '4px 0' }}>
            <p className="hint" style={{ marginBottom: 6 }}>Recent log files (kept 14 days):</p>
            {logFiles.map((f) => (
              <div key={f.name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0', color: 'var(--text-secondary)' }}>
                <code>{f.name}</code>
                <span style={{ color: 'var(--text-muted)' }}>{formatBytes(f.size)}</span>
              </div>
            ))}
          </div>
        ) : null}
        <p className="hint">
          Logs include service lifecycle, profile start/stop errors, backups and crash recovery events.
          Send the newest <code>app-*.log</code> file when reporting an issue.
        </p>
      </div>
    </div>
  );
}
