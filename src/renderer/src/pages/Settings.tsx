import { useEffect, useState } from 'react';
import { getApiBase } from '../api';
import type { UpdateStatus } from '../global';
import { useI18n, type Lang } from '../i18n';
import { SettingsIcon, RefreshIcon, CopyIcon, CheckIcon } from '../icons';

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

type Section = 'general' | 'api' | 'data' | 'updates' | 'diagnostics';

export function Settings() {
  const { t, lang, setLang } = useI18n();
  const [section, setSection] = useState<Section>('general');
  const [apiKey, setApiKey] = useState('');
  const [keyVisible, setKeyVisible] = useState(false);
  const [keyCopied, setKeyCopied] = useState(false);
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
          setLogFiles(res.data.list.slice(0, 5));
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

  const copyKey = (): void => {
    void navigator.clipboard.writeText(apiKey);
    setKeyCopied(true);
    setTimeout(() => setKeyCopied(false), 1500);
  };

  const renderUpdateStatus = (): React.ReactNode => {
    if (!status) return null;
    switch (status.state) {
      case 'checking':
        return <p className="hint">{t('Checking for updates…')}</p>;
      case 'not-available':
        return <p className="hint" style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>✓ {t('You are on the latest version.')}</p>;
      case 'available':
        return (
          <div className="setting-row">
            <span className="setting-label">
              {t('New version available')}: <strong>{status.info.version ? `v${status.info.version}` : t('New build')}</strong>
            </span>
            <button className="btn primary" onClick={onDownload} disabled={busy}>
              {t('Download Update')}
            </button>
          </div>
        );
      case 'downloading':
        return (
          <div className="setting-row">
            <span className="setting-label">
              {t('Downloading…')} {Math.round(status.percent)}% ({formatBytes(status.transferred)} / {formatBytes(status.total)})
            </span>
          </div>
        );
      case 'downloaded':
        return (
          <div className="setting-row">
            <span className="setting-label">
              {t('Update ready')}: <strong>{status.info.version ? `v${status.info.version}` : t('Ready to install')}</strong>
            </span>
            <button className="btn primary" onClick={onRestart}>
              {t('Restart & install')}
            </button>
          </div>
        );
      case 'error':
        return <p className="hint" style={{ color: 'var(--text-secondary)' }}>{t('Update check failed')}: {status.message}</p>;
    }
  };

  const SECTIONS: Array<{ key: Section; label: string }> = [
    { key: 'general', label: t('General') },
    { key: 'api', label: t('Automation API') },
    { key: 'data', label: t('Data Folder') },
    { key: 'updates', label: t('Updates') },
    { key: 'diagnostics', label: t('Diagnostics') },
  ];

  return (
    <div>
      <div className="page-header-actions">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <SettingsIcon size={20} style={{ color: 'var(--text-secondary)' }} />
          <h2 style={{ fontSize: 16, fontWeight: 700 }}>{t('Settings & Automation')}</h2>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
        {/* Section nav */}
        <div style={{ width: 200, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {SECTIONS.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setSection(s.key)}
              className={`settings-nav-item ${section === s.key ? 'active' : ''}`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Section content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {section === 'general' ? (
            <div className="panel">
              <div className="panel-header">{t('General')}</div>
              <div className="setting-row">
                <span className="setting-label">{t('Language')}</span>
                <select
                  className="select-input"
                  value={lang}
                  onChange={(e) => setLang(e.target.value as Lang)}
                  style={{ minWidth: 160 }}
                >
                  <option value="en">English</option>
                  <option value="ru">Русский</option>
                </select>
              </div>
              <p className="hint">
                {t('Interface language. Applies immediately.')}
              </p>
            </div>
          ) : null}

          {section === 'api' ? (
            <div className="panel">
              <div className="panel-header">{t('Automation API (for your scripts)')}</div>
              <div className="setting-row">
                <span className="setting-label">{t('Endpoint URL')}</span>
                <code>{getApiBase()}</code>
              </div>
              <div className="setting-row">
                <span className="setting-label">{t('Bearer API Key')}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <code style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {apiKey ? (keyVisible ? apiKey : `${apiKey.slice(0, 8)}${'•'.repeat(24)}`) : '—'}
                  </code>
                  <button
                    type="button"
                    className="btn-icon"
                    onClick={() => setKeyVisible((v) => !v)}
                    title={keyVisible ? t('Hide') : t('Show')}
                  >
                    {keyVisible ? '🙈' : '👁'}
                  </button>
                  <button
                    type="button"
                    className="btn-icon"
                    onClick={copyKey}
                    disabled={!apiKey}
                    title={t('Copy')}
                  >
                    {keyCopied ? <CheckIcon size={13} style={{ color: 'var(--text)' }} /> : <CopyIcon size={13} />}
                  </button>
                </div>
              </div>
              <p className="hint">
                {t('Use this key to connect your own bots and scripts (Puppeteer, Playwright, Selenium, Python) to the local API. Pass it in the HTTP header:')} <code>Authorization: Bearer &lt;key&gt;</code>.
              </p>
            </div>
          ) : null}

          {section === 'data' && dataApiAvailable ? (
            <div className="panel">
              <div className="panel-header">{t('Data Folder (Profiles, Cache, Kernel)')}</div>
              <div className="setting-row">
                <span className="setting-label">{t('Current folder')}</span>
                <code style={{ wordBreak: 'break-all', maxWidth: '55%' }}>{dataDir || '—'}</code>
              </div>
              <div className="setting-row">
                <span className="setting-label">{t('Actions')}</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn" onClick={onChangeDataDir}>
                    {t('Change Folder…')}
                  </button>
                  <button className="btn" onClick={onOpenDataDir}>
                    {t('Open in Explorer')}
                  </button>
                </div>
              </div>
              {dataDirMsg ? <p className="hint" style={{ color: 'var(--warn)' }}>{dataDirMsg}</p> : null}
              <p className="hint">
                {t('All browser profiles, cookies, extensions, the Chromium kernel and the database are stored here. Changing the folder takes effect after restarting the app.')}
              </p>
            </div>
          ) : null}

          {section === 'updates' ? (
            <>
              <div className="panel">
                <div className="panel-header">{t('Software Updates')}</div>
                {updaterAvailable ? (
                  <>
                    <div className="setting-row">
                      <span className="setting-label">{t('Release Channel (GitHub Releases)')}</span>
                      <button className="btn" onClick={onCheck} disabled={busy}>
                        <RefreshIcon size={14} />
                        <span>{t('Check for updates')}</span>
                      </button>
                    </div>
                    {renderUpdateStatus()}
                  </>
                ) : (
                  <p className="hint">{t('Updates are available in the installed app.')}</p>
                )}
              </div>

              <div className="panel">
                <div className="panel-header">{t('Browser Kernel (fingerprint-chromium)')}</div>
                <div className="setting-row">
                  <span className="setting-label">{t('Installed version')}</span>
                  <code>{kernelInfo?.installed ?? '—'}</code>
                </div>
                <div className="setting-row">
                  <span className="setting-label">{t('Upstream check')}</span>
                  <button className="btn" onClick={checkKernel} disabled={kernelChecking}>
                    <RefreshIcon size={14} />
                    <span>{kernelChecking ? t('Checking…') : t('Check for kernel update')}</span>
                  </button>
                </div>
                {kernelInfo?.latest ? (
                  <p className="hint" style={{ color: kernelInfo.updateAvailable ? 'var(--warn)' : 'var(--text-secondary)', fontWeight: 500 }}>
                    {kernelInfo.updateAvailable
                      ? `⚠ ${t('Update available')}: v${kernelInfo.latest} (v${kernelInfo.installed})`
                      : `✓ ${t('You are on the latest kernel')} (v${kernelInfo.latest})`}
                    {kernelInfo.releaseUrl ? (
                      <>
                        {' '}
                        <a href={kernelInfo.releaseUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--text)', textDecoration: 'underline' }}>
                          {t('Open releases')} ↗
                        </a>
                      </>
                    ) : null}
                  </p>
                ) : null}
                <p className="hint">
                  {t('The kernel is intentionally pinned (stealth patches are version-specific). Updating is manual: download the new Windows build, replace the folder under')} <code>data/chromium/fingerprint-chromium</code>.
                </p>
              </div>
            </>
          ) : null}

          {section === 'diagnostics' ? (
            <div className="panel">
              <div className="panel-header">{t('Diagnostics & Logs')}</div>
              <div className="setting-row">
                <span className="setting-label">{t('Log folder')}</span>
                <code style={{ wordBreak: 'break-all', maxWidth: '55%' }}>{logDir || '—'}</code>
              </div>
              <div className="setting-row">
                <span className="setting-label">{t('Actions')}</span>
                <button className="btn" onClick={onOpenLogsDir}>
                  {t('Open Logs Folder')}
                </button>
              </div>
              {logFiles.length > 0 ? (
                <div style={{ padding: '4px 0' }}>
                  <p className="hint" style={{ marginBottom: 6 }}>{t('Recent log files (kept 14 days):')}</p>
                  {logFiles.map((f) => (
                    <div key={f.name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0', color: 'var(--text-secondary)' }}>
                      <code>{f.name}</code>
                      <span style={{ color: 'var(--text-muted)' }}>{formatBytes(f.size)}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              <p className="hint">
                {t('Logs include service lifecycle, profile start/stop errors, backups and crash recovery events. Send the newest')} <code>app-*.log</code> {t('when reporting an issue.')}
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
