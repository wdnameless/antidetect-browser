import { useEffect, useState } from 'react';
import { getApiBase, api } from '../api';
import type { UpdateStatus } from '../global';
import { useI18n, type Lang } from '../i18n';
import { SettingsIcon, RefreshIcon, CopyIcon, CheckIcon } from '../icons';
import { SyncSettings } from './SyncSettings';
import { LicenseSettings } from './LicenseSettings';
import { SecuritySettings } from './SecuritySettings';

function TelegramSettings() {
  const { t } = useI18n();
  const [enabled, setEnabled] = useState(false);
  const [hasToken, setHasToken] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [chatIdsInput, setChatIdsInput] = useState('');
  const [tokenVisible, setTokenVisible] = useState(false);
  const [tokenCopied, setTokenCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  useEffect(() => {
    setBusy(true);
    fetch('/api/v1/settings/telegram')
      .then((r) => r.json())
      .then((res) => {
        if (res.code === 0 && res.data) {
          setEnabled(Boolean(res.data.enabled));
          setHasToken(Boolean(res.data.has_token));
          if (Array.isArray(res.data.chatIds)) {
            setChatIdsInput(res.data.chatIds.join(', '));
          }
        }
      })
      .catch(() => undefined)
      .finally(() => setBusy(false));
  }, []);

  const onSave = async () => {
    setBusy(true);
    setSaveMsg('');
    try {
      const chatIds = chatIdsInput
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      const body: { enabled: boolean; chatIds: string[]; token?: string } = {
        enabled,
        chatIds,
      };
      if (tokenInput.trim().length > 0) {
        body.token = tokenInput.trim();
      }

      const res = await fetch('/api/v1/settings/telegram', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then((r) => r.json());

      if (res.code === 0 && res.data) {
        setHasToken(Boolean(res.data.has_token));
        setTokenInput('');
        setSaveMsg('Settings saved successfully');
        setTimeout(() => setSaveMsg(''), 3000);
      } else {
        setSaveMsg(res.msg || 'Save failed');
      }
    } catch (e) {
      setSaveMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const copyToken = () => {
    if (!tokenInput) return;
    void navigator.clipboard.writeText(tokenInput).then(() => {
      setTokenCopied(true);
      setTimeout(() => setTokenCopied(false), 1500);
    });
  };

  return (
    <div className="panel">
      <div className="panel-header">{t('Telegram Bot Settings')}</div>
      <p className="hint">
        {t('Configure Telegram bot for profile events and automation notifications.')}
      </p>

      <div className="setting-row">
        <span className="setting-label">{t('Enable Telegram Bot')}</span>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          disabled={busy}
        />
      </div>

      <div className="setting-row">
        <span className="setting-label">{t('Bot Token')}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, maxWidth: 400 }}>
          <input
            type={tokenVisible ? 'text' : 'password'}
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder={hasToken ? t('Token is set and securely stored.') : t('Enter bot token')}
            disabled={busy}
            style={{ flex: 1 }}
          />
          <button
            type="button"
            className="btn-icon"
            onClick={() => setTokenVisible((v) => !v)}
            title={tokenVisible ? t('Hide') : t('Show')}
          >
            {tokenVisible ? '🙈' : '👁'}
          </button>
          <button
            type="button"
            className="btn-icon"
            onClick={copyToken}
            disabled={!tokenInput}
            title={t('Copy')}
          >
            {tokenCopied ? <CheckIcon size={13} style={{ color: 'var(--text)' }} /> : <CopyIcon size={13} />}
          </button>
        </div>
      </div>
      <p className="hint" style={{ marginTop: 2, marginBottom: 12 }}>
        {hasToken ? t('Token is set and securely stored.') : t('Token not configured.')}
      </p>

      <div className="setting-row">
        <span className="setting-label">{t('Chat IDs (comma-separated)')}</span>
        <input
          type="text"
          value={chatIdsInput}
          onChange={(e) => setChatIdsInput(e.target.value)}
          placeholder={t('e.g. 12345678, -100123456789')}
          disabled={busy}
          style={{ maxWidth: 400, flex: 1 }}
        />
      </div>

      <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
        <button className="btn primary" onClick={onSave} disabled={busy}>
          {busy ? t('Saving…') : t('Save Telegram Settings')}
        </button>
        {saveMsg && <span className="hint" style={{ color: 'var(--text-secondary)' }}>{saveMsg}</span>}
      </div>
    </div>
  );
}

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

type Section = 'general' | 'api' | 'data' | 'security' | 'telegram' | 'updates' | 'diagnostics' | 'sync' | 'license';

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
  const [kernelBusy, setKernelBusy] = useState(false);
  const [kernelInstallError, setKernelInstallError] = useState<string | null>(null);
  const [kernelProgress, setKernelProgress] = useState<{ received: number; total: number } | null>(null);
  const [backups, setBackups] = useState<Array<{ name: string; size: number; modified: number }>>([]);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restoreDone, setRestoreDone] = useState(false);
  const [restoreMsg, setRestoreMsg] = useState('');
  const [scanBusy, setScanBusy] = useState(false);
  const [scanResults, setScanResults] = useState<Array<{ dir: string; profiles: number; modified: number; dbSize: number }>>([]);
  const [migrating, setMigrating] = useState(false);

  const checkKernel = (): void => {
    setKernelChecking(true);
    void import('../api').then(({ api }) => {
      api.kernelCheckUpdate().then((res) => {
        if (res.code === 0) setKernelInfo(res.data);
        setKernelChecking(false);
      }).catch(() => setKernelChecking(false));
    });
  };

  /**
   * Download the kernel. 425 MB over a real network, so the button reports progress from
   * the server's own byte counters rather than a spinner that says nothing, and a failure
   * keeps the reason on screen instead of a button that silently does nothing.
   */
  const installKernel = (): void => {
    setKernelBusy(true);
    setKernelInstallError(null);
    setKernelProgress({ received: 0, total: 0 });
    // Poll the server's own counters; a 425 MB download with no feedback looks hung.
    const poll = window.setInterval(() => {
      void import('../api').then(({ api }) => {
        api
          .kernelStatus()
          .then((res) => {
            if (res.code !== 0) return;
            if (res.data.status === 'downloading') {
              setKernelProgress({ received: res.data.received, total: res.data.total });
            } else if (res.data.status === 'error') {
              setKernelInstallError(res.data.error ?? 'Kernel install failed');
            }
          })
          .catch(() => undefined);
      });
    }, 1000);

    void import('../api').then(({ api }) => {
      api
        .kernelInstall()
        .then((res) => {
          if (res.code !== 0) {
            setKernelInstallError(res.msg || 'Kernel install failed');
          } else {
            setKernelProgress(null);
            return api.kernelInfo().then((info) => {
              if (info.code === 0) setKernelInfo((prev) => ({ ...(prev ?? { latest: null, updateAvailable: false }), installed: info.data.installed }));
            });
          }
        })
        .catch((err: unknown) => setKernelInstallError(err instanceof Error ? err.message : 'Kernel install failed'))
        .finally(() => {
          window.clearInterval(poll);
          setKernelBusy(false);
          setKernelProgress(null);
        });
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
      api.backupsList().then((res) => {
        if (res.code === 0) setBackups(res.data.list);
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
    void window.antidetect?.data.prepareDir?.().then(async (picked) => {
      if (!picked.ok) return;
      const target = picked.dir;
      // Ask what to do with the existing data.
      const migrate = window.confirm(
        `${t('Move profiles and ALL data to')}:\n${target}\n\n${t('OK = migrate everything (recommended). Cancel = switch to an empty folder.')}`
      );
      setMigrating(true);
      setDataDirMsg('');
      try {
        const r = await window.antidetect?.data.migrateDir?.(target, migrate);
        if (r?.ok) {
          setDataDir(target);
          setDataDirMsg(
            migrate
              ? `${t('Data migrated to the new folder.')} ${t('Restart the app to apply.')}`
              : t('Folder changed. Restart the app to apply.')
          );
        } else {
          setDataDirMsg(`${t('Migration failed')}: ${r?.error ?? 'unknown'}`);
        }
      } finally {
        setMigrating(false);
      }
    });
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
      case 'error': {
        const isReleaseMissing =
          status.message?.includes('Could not fetch a valid release JSON') ||
          status.message?.includes('404') ||
          status.message?.includes('release JSON');
        if (isReleaseMissing) {
          return (
            <div>
              <p className="hint" style={{ color: 'var(--text-secondary)' }}>
                {t('Automatic updates are not configured for this build yet.')}
              </p>
              <p className="hint" style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }} title={status.message}>
                {t('Diagnostics: Remote release metadata not found')}
              </p>
            </div>
          );
        }
        return (
          <div>
            <p className="hint" style={{ color: 'var(--text-secondary)' }}>
              {t('Update check could not complete.')}
            </p>
            <p className="hint" style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
              {status.message}
            </p>
          </div>
        );
      }
    }
  };

  const SECTIONS: Array<{ key: Section; label: string }> = [
    { key: 'general', label: t('General') },
    { key: 'api', label: t('Automation API') },
    { key: 'data', label: t('Data Folder') },
    { key: 'security', label: t('Security') },
    { key: 'telegram', label: t('Telegram Notifications') },
    { key: 'sync', label: t('Sync') },
    { key: 'license', label: t('License') },
    { key: 'updates', label: t('Updates') },
    { key: 'diagnostics', label: t('Diagnostics') },
  ];

  const renderSection = (): React.ReactNode => {
    if (section === 'sync') return <SyncSettings />;
    if (section === 'license') return <LicenseSettings />;
    return null;
  };

  const renderSectionContent = (): React.ReactNode => {
    if (section === 'sync' || section === 'license') return renderSection();
    return null;
  };

  void renderSectionContent;

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
          {section === 'sync' ? (
            <SyncSettings />
          ) : section === 'license' ? (
            <LicenseSettings />
          ) : section === 'general' ? (
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

          {section === 'security' && <SecuritySettings />}
          {section === 'telegram' && <TelegramSettings />}

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
                  <button className="btn" onClick={onChangeDataDir} disabled={migrating}>
                    {migrating ? t('Migrating data…') : t('Change Folder…')}
                  </button>
                  <button className="btn" onClick={onOpenDataDir} disabled={migrating}>
                    {t('Open in Explorer')}
                  </button>
                </div>
              </div>
              {dataDirMsg ? <p className="hint" style={{ color: 'var(--warn)' }}>{dataDirMsg}</p> : null}
              <p className="hint">
                {t('All browser profiles, cookies, extensions, the Chromium kernel and the database are stored here. Changing the folder takes effect after restarting the app.')}
              </p>

              <div style={{ borderTop: '1px solid var(--border)', margin: '14px 0', paddingTop: 14 }}>
                <div className="panel-header" style={{ padding: 0, marginBottom: 8 }}>{t('Recover old data')}</div>
                <p className="hint" style={{ marginTop: 0 }}>
                  {t('Profiles/groups disappeared after an update? Scan the system for existing antidetect databases and switch to the one that contains your profiles.')}
                </p>
                <button
                  type="button"
                  className="btn"
                  disabled={scanBusy}
                  onClick={() => {
                    setScanBusy(true);
                    setScanResults([]);
                    void import('../api').then(({ api }) =>
                      api.dataScan().then((r) => {
                        setScanBusy(false);
                        if (r.code === 0) setScanResults(r.data.found.filter((f) => !f.isCurrent));
                      }).catch(() => setScanBusy(false))
                    );
                  }}
                >
                  <RefreshIcon size={14} />
                  <span>{scanBusy ? t('Scanning…') : t('Scan for existing data folders')}</span>
                </button>
                {scanResults.length > 0 ? (
                  <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {scanResults.map((f) => (
                      <div key={f.dir} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, fontSize: 12.5 }}>
                        <span style={{ color: 'var(--text-secondary)', wordBreak: 'break-all' }}>
                          <code style={{ fontSize: 11 }}>{f.dir}</code>{' '}
                          <strong style={{ color: f.profiles > 0 ? 'var(--text)' : 'var(--text-muted)' }}>
                            ({f.profiles >= 0 ? `${f.profiles} ${f.profiles === 1 ? 'profile' : 'profiles'}` : t('unreadable')})
                          </strong>{' '}
                          <span style={{ color: 'var(--text-muted)' }}>{new Date(f.modified).toLocaleString()}</span>
                        </span>
                        <button
                          type="button"
                          className="btn btn-sm primary"
                          disabled={f.profiles <= 0}
                          onClick={() => {
                            void window.antidetect?.data.setDirPath?.(f.dir).then((r) => {
                              if (r.ok) {
                                setDataDir(r.dir);
                                setDataDirMsg(t('Folder changed. Restart the app to apply.'));
                              } else {
                                setDataDirMsg(t('Could not switch to this folder.'));
                              }
                            });
                          }}
                        >
                          {t('Use this folder')}
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
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

                {/* Installing the kernel from the app, because a shipped artefact does not
                    contain it: the kernel is ~425 MB of patched Chromium, so bundling it
                    would dwarf the app. Before this, a fresh install had no kernel and
                    every profile launch failed with no in-app way to fix it. */}
                <div className="setting-row">
                  <span className="setting-label">{t('Kernel')}</span>
                  {kernelProgress ? (
                    <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
                      {kernelProgress.total > 0
                        ? `${t('Downloading…')} ${Math.round((kernelProgress.received / kernelProgress.total) * 100)}%`
                        : t('Downloading…')}
                    </span>
                  ) : (
                    <button className="btn" onClick={installKernel} disabled={kernelBusy}>
                      <span>{kernelBusy ? t('Installing…') : t('Download and install kernel')}</span>
                    </button>
                  )}
                </div>
                {kernelInstallError ? (
                  <p className="hint" style={{ color: 'var(--danger)' }} role="alert">
                    {kernelInstallError}
                  </p>
                ) : null}
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

              <div style={{ borderTop: '1px solid var(--border)', margin: '14px 0', paddingTop: 14 }}>
                <div className="panel-header" style={{ padding: 0, marginBottom: 8 }}>{t('Database Backups (restore)')}</div>
                <p className="hint" style={{ marginTop: 0 }}>
                  {t('If profiles/groups suddenly disappeared, restore the database from an automatic daily backup. The current (broken) database is snapshotted before restoring — the operation is reversible. Restart the app after restoring.')}
                </p>
                {backups.length === 0 ? (
                  <p className="hint" style={{ color: 'var(--text-secondary)' }}>{t('No backups found yet (they are created daily after the first run).')}</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {backups.map((b) => (
                      <div key={b.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12.5 }}>
                        <span style={{ color: 'var(--text-secondary)' }}>
                          <code>{b.name}</code>{' '}
                          <span style={{ color: 'var(--text-muted)' }}>({formatBytes(b.size)}, {new Date(b.modified).toLocaleString()})</span>
                        </span>
                        <button
                          type="button"
                          className="btn btn-sm"
                          disabled={restoreBusy}
                          onClick={() => {
                            if (!window.confirm(t('Restore database from this backup? The app must be restarted afterwards.'))) return;
                            setRestoreBusy(true);
                            void import('../api').then(({ api }) =>
                              api.backupRestore(b.name).then((r) => {
                                setRestoreBusy(false);
                                if (r.code === 0) setRestoreDone(true);
                                else setRestoreMsg(r.msg);
                              }).catch(() => setRestoreBusy(false))
                            );
                          }}
                        >
                          {t('Restore')}
                        </button>
                      </div>
                    ))}
                    {restoreDone ? (
                      <p className="hint" style={{ color: 'var(--warn)', fontWeight: 600 }}>
                        ✓ {t('Database restored. Restart the app to see your profiles.')}
                      </p>
                    ) : null}
                    {restoreMsg ? <p className="hint" style={{ color: 'var(--text-secondary)' }}>{restoreMsg}</p> : null}
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
