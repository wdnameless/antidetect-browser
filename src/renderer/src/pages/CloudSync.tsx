import React, { useState, useEffect } from 'react';
import { api, CloudStateData, CloudSessionItem, ProfileListItem, SyncResultRow } from '../api';
import { useI18n } from '../i18n';

// Self-hosted deployment: the bootstrap script and its guides live in the repository
// under `deploy/`, served from the main branch so an operator always gets the current one.
const BOOTSTRAP_URL =
  'https://raw.githubusercontent.com/wdnameless/antidetect-browser/main/deploy/bootstrap.ps1';
const DEPLOY_GUIDE_RU =
  'https://github.com/wdnameless/antidetect-browser/blob/main/deploy/DEDICATED_AGENT_PROMPT.ru.md';
const DEPLOY_GUIDE_EN =
  'https://github.com/wdnameless/antidetect-browser/blob/main/README.md#dedicated-server';

const DEPLOY_COMMAND = [
  `irm ${BOOTSTRAP_URL} -OutFile bootstrap.ps1`,
  'Set-ExecutionPolicy -Scope Process Bypass -Force',
  '.\\bootstrap.ps1 -Peers 3',
].join('\n');

interface GDriveStatusState {
  configured: boolean;
  connected: boolean;
  userEmail: string | null;
  folderId: string | null;
  lastPushTimestamp: number | null;
  lastPullTimestamp: number | null;
}

interface InspectPullResult {
  remoteTimestamp: number;
  profileCount: number;
  scriptCount: number;
  newProfiles: number;
  newScripts: number;
  conflicts: Array<{
    type: 'profile' | 'script';
    id: string;
    name: string;
    localUpdatedAt: number;
    remoteUpdatedAt: number;
  }>;
  unchanged: boolean;
}

export const CloudSync: React.FC = () => {
  const { t } = useI18n();

  // Self-hosted sync server state
  const [state, setState] = useState<CloudStateData | null>(null);
  const [url, setUrl] = useState('');
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [sessions, setSessions] = useState<CloudSessionItem[]>([]);
  const [localList, setLocalList] = useState<ProfileListItem[]>([]);
  const [remoteList, setRemoteList] = useState<ProfileListItem[]>([]);
  const [selLocal, setSelLocal] = useState<Set<string>>(new Set());
  const [selRemote, setSelRemote] = useState<Set<string>>(new Set());
  const [syncLog, setSyncLog] = useState<SyncResultRow[]>([]);

  // Google Drive state
  const [gdriveStatus, setGdriveStatus] = useState<GDriveStatusState | null>(null);
  const [gdriveClientId, setGdriveClientId] = useState('');
  const [gdriveClientSecret, setGdriveClientSecret] = useState('');
  const [gdriveBusy, setGdriveBusy] = useState(false);
  const [gdriveNotice, setGdriveNotice] = useState('');
  const [deviceAuthData, setDeviceAuthData] = useState<{
    userCode: string;
    verificationUrl: string;
    deviceCode: string;
    interval: number;
  } | null>(null);
  const [inspection, setInspection] = useState<InspectPullResult | null>(null);

  const refreshGDriveStatus = (): void => {
    api.gdriveStatus().then((r) => {
      if (r.code === 0) setGdriveStatus(r.data);
    }).catch(() => undefined);
  };

  const refreshState = (): void => {
    setBusy(true);
    api.cloudState().then((r) => {
      if (r.code === 0) {
        setState(r.data);
        setUrl(r.data.url ?? '');
      }
      setBusy(false);
    }).catch(() => setBusy(false));
  };

  useEffect(() => {
    refreshState();
    refreshGDriveStatus();
  }, []);

  const loadSessions = (): void => {
    api.cloudSessions().then((r) => {
      if (r.code === 0) setSessions(r.data.list ?? []);
    }).catch(() => undefined);
  };

  const loadLocalProfiles = (): void => {
    api.list({ pageSize: 500 }).then((r) => {
      if (r.code === 0) setLocalList(r.data.list ?? []);
    }).catch(() => undefined);
  };

  useEffect(() => {
    if (state?.connected && state?.authorized) {
      loadSessions();
      loadLocalProfiles();
    }
  }, [state?.connected, state?.authorized]);

  // Polling device auth
  useEffect(() => {
    if (!deviceAuthData) return;
    const intervalSec = Math.max(deviceAuthData.interval || 5, 5);
    const timer = setInterval(() => {
      api.gdrivePollDeviceAuth(deviceAuthData.deviceCode).then((r) => {
        if (r.code === 0 && r.data.status === 'success') {
          setDeviceAuthData(null);
          setGdriveNotice(t('Google Drive synced successfully'));
          refreshGDriveStatus();
        }
      }).catch((err) => {
        setDeviceAuthData(null);
        setGdriveNotice((err as Error).message || 'Authentication error');
      });
    }, intervalSec * 1000);

    return () => clearInterval(timer);
  }, [deviceAuthData]);

  const handleSaveCredentials = (): void => {
    if (!gdriveClientId.trim()) {
      setGdriveNotice('Client ID cannot be empty');
      return;
    }
    setGdriveBusy(true);
    setGdriveNotice('');
    api.gdriveSaveCredentials(gdriveClientId.trim(), gdriveClientSecret.trim() || undefined)
      .then((r) => {
        setGdriveBusy(false);
        if (r.code === 0) {
          setGdriveNotice(t('Drive credentials saved securely'));
          refreshGDriveStatus();
        } else {
          setGdriveNotice(r.msg);
        }
      })
      .catch((err) => {
        setGdriveBusy(false);
        setGdriveNotice((err as Error).message);
      });
  };

  const handleStartDeviceAuth = (): void => {
    setGdriveBusy(true);
    setGdriveNotice('');
    api.gdriveStartDeviceAuth()
      .then((r) => {
        setGdriveBusy(false);
        if (r.code === 0) {
          setDeviceAuthData(r.data);
        } else {
          setGdriveNotice(r.msg);
        }
      })
      .catch((err) => {
        setGdriveBusy(false);
        setGdriveNotice((err as Error).message);
      });
  };

  const handleDisconnectGDrive = (): void => {
    setGdriveBusy(true);
    api.gdriveDisconnect()
      .then(() => {
        setGdriveBusy(false);
        setInspection(null);
        refreshGDriveStatus();
      })
      .catch((err) => {
        setGdriveBusy(false);
        setGdriveNotice((err as Error).message);
      });
  };

  const handleGDrivePush = (): void => {
    setGdriveBusy(true);
    setGdriveNotice('');
    api.gdrivePush()
      .then((r) => {
        setGdriveBusy(false);
        if (r.code === 0) {
          setGdriveNotice(
            `${t('Pushed')}: ${r.data.pushedProfiles} ${t('Profiles')}, ${r.data.pushedScripts} scripts`
          );
          refreshGDriveStatus();
        } else {
          setGdriveNotice(r.msg);
        }
      })
      .catch((err) => {
        setGdriveBusy(false);
        setGdriveNotice((err as Error).message);
      });
  };

  const handleInspectPull = (): void => {
    setGdriveBusy(true);
    setGdriveNotice('');
    api.gdriveInspectPull()
      .then((r) => {
        setGdriveBusy(false);
        if (r.code === 0) {
          setInspection(r.data);
          if (r.data.unchanged) {
            setGdriveNotice(t('No remote updates detected (local and remote data are identical).'));
          }
        } else {
          setGdriveNotice(r.msg);
        }
      })
      .catch((err) => {
        setGdriveBusy(false);
        setGdriveNotice((err as Error).message);
      });
  };

  const handleExecutePull = (resolution?: 'keep_local' | 'overwrite_remote' | 'cancel'): void => {
    setGdriveBusy(true);
    setGdriveNotice('');
    api.gdrivePull(resolution)
      .then((r) => {
        setGdriveBusy(false);
        if (r.code === 0) {
          setInspection(null);
          setGdriveNotice(
            `${t('Pulled')}: ${r.data.pulledProfiles} ${t('Profiles')}, ${r.data.pulledScripts} scripts`
          );
          refreshGDriveStatus();
        } else {
          setGdriveNotice(r.msg);
        }
      })
      .catch((err) => {
        setGdriveBusy(false);
        setGdriveNotice((err as Error).message);
      });
  };

  // Self-hosted actions
  const handleConnect = (): void => {
    if (!url.trim()) return;
    setBusy(true); setNotice('');
    api.cloudConnect(url.trim()).then((r) => {
      setState(r.data);
      if (r.code !== 0) setNotice(r.msg);
      setBusy(false);
    }).catch((e: Error) => { setNotice(e.message); setBusy(false); });
  };

  const handleAuth = (): void => {
    if (!user.trim() || !pass) return;
    if (!state?.hasPassword && pass !== pass2) {
      setNotice(t('Passwords do not match'));
      return;
    }
    setBusy(true); setNotice('');
    const call = state?.hasPassword ? api.cloudLogin(user.trim(), pass) : api.cloudSetup(user.trim(), pass);
    call.then((r) => {
      if (r.code === 0) {
        setPass(''); setPass2('');
        refreshState();
      } else {
        setNotice(r.msg);
      }
      setBusy(false);
    }).catch((e: Error) => { setNotice(e.message); setBusy(false); });
  };

  const handleDisconnect = (): void => {
    setBusy(true);
    api.cloudDisconnect().then(() => {
      setSessions([]); setRemoteList([]); setSyncLog([]);
      setBusy(false);
      refreshState();
    }).catch(() => setBusy(false));
  };

  const handlePush = (ids?: string[]): void => {
    setBusy(true); setNotice(''); setSyncLog([]);
    api.cloudPush(ids).then((r) => {
      if (r.code === 0) {
        setSyncLog(r.data.results);
        setNotice(`${t('Pushed')}: ${r.data.pushed}, ${t('Failed')}: ${r.data.failed}`);
      } else {
        setNotice(r.msg);
      }
      setBusy(false);
    }).catch((e: Error) => { setNotice(e.message); setBusy(false); });
  };

  const handlePull = (ids?: string[]): void => {
    setBusy(true); setNotice(''); setSyncLog([]);
    api.cloudPull(ids).then((r) => {
      if (r.code === 0) {
        setSyncLog(r.data.results);
        setNotice(`${t('Pulled')}: ${r.data.pulled}, ${t('Failed')}: ${r.data.failed}`);
      } else {
        setNotice(r.msg);
      }
      setBusy(false);
    }).catch((e: Error) => { setNotice(e.message); setBusy(false); });
  };

  const handleRemoteList = (): void => {
    setBusy(true);
    api.cloudRemoteList().then((r) => {
      if (r.code === 0) {
        setRemoteList(r.data.list ?? []);
        setSelRemote(new Set());
      }
      setBusy(false);
    }).catch(() => setBusy(false));
  };

  return (
    <div className="page cloud-sync-page">
      <div className="page-header">
        <h2>{t('Cloud Synchronization')}</h2>
        <span className="page-subtitle">
          {t('Sync browser profiles across machines via Google Drive or self-hosted server')}
        </span>
      </div>

      {/* =================================================================== */}
      {/* GOOGLE DRIVE SYNC SECTION (nulltrace-gdrive)                         */}
      {/* =================================================================== */}
      <div className="card" style={{ marginBottom: '20px', borderLeft: '4px solid var(--border-color)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <div>
            <h3 style={{ margin: 0 }}>{t('Google Drive Sync')}</h3>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              {t('Store profiles, scripts, and settings securely in your personal Google Drive')}
            </span>
          </div>
          {/* Status text badge: Accessible without color alone (has text: [CONFIGURED] / [CONNECTED] / [DISCONNECTED]) */}
          <span className="badge" style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {gdriveStatus?.connected
              ? `[CONNECTED] ${gdriveStatus.userEmail || ''}`
              : gdriveStatus?.configured
              ? '[CONFIGURED / DISCONNECTED]'
              : '[NOT CONFIGURED]'}
          </span>
        </div>

        {gdriveNotice && (
          <div className="notice-banner" style={{ marginBottom: '12px', padding: '8px 12px' }}>
            {gdriveNotice}
          </div>
        )}

        {/* Step-by-step Setup Instructions */}
        {!gdriveStatus?.connected && (
          <div style={{ background: 'var(--bg-secondary)', padding: '12px', borderRadius: '4px', marginBottom: '16px' }}>
            <strong style={{ display: 'block', marginBottom: '6px' }}>{t('Setup Instructions')}:</strong>
            <ol style={{ margin: 0, paddingLeft: '18px', fontSize: '13px', lineHeight: '1.6' }}>
              <li>{t('1. Create a Google Cloud project or use an existing one in the Google Cloud Console.')}</li>
              <li>{t('2. Enable the Google Drive API for your project.')}</li>
              <li>{t('3. Configure an OAuth consent screen (External, add drive.file scope).')}</li>
              <li>{t('4. Create OAuth 2.0 credentials (Desktop Application or TV/Limited Input Device).')}</li>
              <li>{t('5. Paste the Client ID below. Secret is optional for desktop clients.')}</li>
            </ol>
          </div>
        )}

        {/* Configuration inputs */}
        {!gdriveStatus?.connected && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <label style={{ width: '160px', fontSize: '13px' }}>{t('OAuth Client ID')}:</label>
              <input
                type="text"
                value={gdriveClientId}
                onChange={(e) => setGdriveClientId(e.target.value)}
                placeholder="xxxx.apps.googleusercontent.com"
                style={{ flex: 1 }}
                disabled={gdriveBusy}
              />
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <label style={{ width: '160px', fontSize: '13px' }}>{t('OAuth Client Secret (optional)')}:</label>
              <input
                type="password"
                value={gdriveClientSecret}
                onChange={(e) => setGdriveClientSecret(e.target.value)}
                placeholder="(Optional for Desktop Client)"
                style={{ flex: 1 }}
                disabled={gdriveBusy}
              />
            </div>
            <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
              <button className="btn" onClick={handleSaveCredentials} disabled={gdriveBusy || !gdriveClientId.trim()}>
                {t('Save Credentials')}
              </button>
              {gdriveStatus?.configured && !deviceAuthData && (
                <button className="btn btn-primary" onClick={handleStartDeviceAuth} disabled={gdriveBusy}>
                  {t('Connect Google Drive')}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Device Auth active flow dialog */}
        {deviceAuthData && (
          <div style={{ border: '1px solid var(--border-color)', padding: '16px', borderRadius: '4px', marginBottom: '16px' }}>
            <h4>{t('Authorizing Google Drive...')}</h4>
            <p style={{ margin: '8px 0', fontSize: '13px' }}>
              {t('To authorize, open the following URL in any browser:')}
            </p>
            <div style={{ margin: '8px 0', wordBreak: 'break-all' }}>
              <a href={deviceAuthData.verificationUrl} target="_blank" rel="noreferrer">
                {deviceAuthData.verificationUrl}
              </a>
            </div>
            <p style={{ margin: '8px 0', fontSize: '14px' }}>
              <strong>{t('Enter Code:')}</strong>{' '}
              <span style={{ fontSize: '18px', letterSpacing: '0.1em', fontWeight: 'bold' }}>
                {deviceAuthData.userCode}
              </span>
            </p>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              {t('Waiting for approval in browser...')}
            </p>
            <button className="btn" onClick={() => setDeviceAuthData(null)}>
              {t('Cancel Authorization')}
            </button>
          </div>
        )}

        {/* Connected state & Operations */}
        {gdriveStatus?.connected && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '16px' }}>
              <div style={{ padding: '8px', background: 'var(--bg-secondary)', borderRadius: '4px' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'block' }}>{t('Connected Account:')}</span>
                <strong>{gdriveStatus.userEmail || 'OAuth Connected'}</strong>
              </div>
              <div style={{ padding: '8px', background: 'var(--bg-secondary)', borderRadius: '4px' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'block' }}>{t('Drive Folder ID:')}</span>
                <span style={{ fontFamily: 'monospace', fontSize: '12px' }}>{gdriveStatus.folderId || 'auto'}</span>
              </div>
              <div style={{ padding: '8px', background: 'var(--bg-secondary)', borderRadius: '4px' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'block' }}>{t('Last Push:')}</span>
                <span>{gdriveStatus.lastPushTimestamp ? new Date(gdriveStatus.lastPushTimestamp).toLocaleString() : 'Never'}</span>
              </div>
              <div style={{ padding: '8px', background: 'var(--bg-secondary)', borderRadius: '4px' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'block' }}>{t('Last Pull:')}</span>
                <span>{gdriveStatus.lastPullTimestamp ? new Date(gdriveStatus.lastPullTimestamp).toLocaleString() : 'Never'}</span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
              <button className="btn btn-primary" onClick={handleGDrivePush} disabled={gdriveBusy}>
                {t('Push to Google Drive')}
              </button>
              <button className="btn" onClick={handleInspectPull} disabled={gdriveBusy}>
                {t('Check for Remote Updates')}
              </button>
              <button className="btn" onClick={() => handleExecutePull()} disabled={gdriveBusy}>
                {t('Pull from Google Drive')}
              </button>
              <button className="btn" onClick={handleDisconnectGDrive} disabled={gdriveBusy}>
                {t('Disconnect Google Drive')}
              </button>
            </div>

            {/* Inspection details / Conflict Resolution Dialog */}
            {inspection && (
              <div style={{ border: '1px solid var(--border-color)', padding: '16px', borderRadius: '4px', marginBottom: '16px' }}>
                <h4 style={{ margin: '0 0 8px 0' }}>{t('Remote Data Inspection')}</h4>
                <div style={{ fontSize: '13px', lineHeight: '1.6' }}>
                  <div>{t('Remote Timestamp:')} {new Date(inspection.remoteTimestamp).toLocaleString()}</div>
                  <div>{t('Remote Profiles:')} {inspection.profileCount} ({t('New Profiles to add:')} {inspection.newProfiles})</div>
                  <div>{t('Remote Scripts:')} {inspection.scriptCount} ({t('New Scripts to add:')} {inspection.newScripts})</div>
                </div>

                {inspection.conflicts.length > 0 && (
                  <div style={{ marginTop: '12px', padding: '12px', background: 'var(--bg-secondary)', borderRadius: '4px' }}>
                    <strong style={{ color: 'var(--text)', display: 'block', marginBottom: '6px' }}>
                      {t('Local changes detected that conflict with remote data:')}
                    </strong>
                    <ul style={{ margin: '0 0 12px 0', paddingLeft: '18px', fontSize: '12px' }}>
                      {inspection.conflicts.map((c) => (
                        <li key={`${c.type}-${c.id}`}>
                          [{c.type.toUpperCase()}] {c.name} — Local edited {new Date(c.localUpdatedAt).toLocaleString()} vs Remote {new Date(c.remoteUpdatedAt).toLocaleString()}
                        </li>
                      ))}
                    </ul>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button className="btn btn-primary" onClick={() => handleExecutePull('overwrite_remote')}>
                        {t('Overwrite Local Data')}
                      </button>
                      <button className="btn" onClick={() => handleExecutePull('keep_local')}>
                        {t('Keep Local (Skip Conflicts)')}
                      </button>
                      <button className="btn" onClick={() => setInspection(null)}>
                        {t('Cancel Pull')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* =================================================================== */}
      {/* SELF-HOSTED SYNC SERVER SECTION (Existing / Untouched)             */}
      {/* =================================================================== */}
      <div className="card" style={{ marginBottom: '20px' }}>
        <h3>{t('Self-Hosted Sync Server')}</h3>
        <span style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'block', marginBottom: '12px' }}>
          {t('Connect to your dedicated team sync-server')}
        </span>

        {notice && <div className="notice-banner" style={{ marginBottom: '12px' }}>{notice}</div>}

        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="http://localhost:3000"
            disabled={state?.connected || busy}
            style={{ flex: 1 }}
          />
          {state?.connected ? (
            <button className="btn" onClick={handleDisconnect} disabled={busy}>
              {t('Disconnect')}
            </button>
          ) : (
            <button className="btn btn-primary" onClick={handleConnect} disabled={busy || !url.trim()}>
              {t('Connect')}
            </button>
          )}
        </div>

        {state?.connected && !state.authorized && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxWidth: '360px' }}>
            <h4>{state.hasPassword ? t('Login') : t('First-time Setup')}</h4>
            <input
              type="text"
              value={user}
              onChange={(e) => setUser(e.target.value)}
              placeholder={t('Username')}
              disabled={busy}
            />
            <input
              type="password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              placeholder={t('Password')}
              disabled={busy}
            />
            {!state.hasPassword && (
              <input
                type="password"
                value={pass2}
                onChange={(e) => setPass2(e.target.value)}
                placeholder={t('Confirm Password')}
                disabled={busy}
              />
            )}
            <button className="btn btn-primary" onClick={handleAuth} disabled={busy}>
              {state.hasPassword ? t('Login') : t('Setup & Login')}
            </button>
          </div>
        )}

        {state?.connected && state.authorized && (
          <div>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
              <button className="btn btn-primary" onClick={() => handlePush()} disabled={busy}>
                {t('Push All Local Profiles')}
              </button>
              <button className="btn" onClick={() => handlePull()} disabled={busy}>
                {t('Pull All Remote Profiles')}
              </button>
              <button className="btn" onClick={handleRemoteList} disabled={busy}>
                {t('List Remote Profiles')}
              </button>
            </div>

            {/* Sync results log */}
            {syncLog.length > 0 && (
              <div style={{ marginTop: '12px' }}>
                <h4>{t('Sync Results')}</h4>
                <div style={{ maxHeight: '160px', overflowY: 'auto', fontSize: '12px' }}>
                  {syncLog.map((r, i) => (
                    <div key={i} style={{ padding: '2px 0' }}>
                      {r.name || r.user_id}: {r.ok ? 'ok' : 'failed'} {r.error ? `(${r.error})` : ''}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* =================================================================== */}
      {/* DEPLOY TO YOUR OWN SERVER                                           */}
      {/* Restored: the Drive work on this file dropped this block while        */}
      {/* rewriting the page. R85i requires the self-hosted path to keep        */}
      {/* working, and this is the part an operator needs to stand one up.      */}
      {/* =================================================================== */}
      <div className="card" style={{ marginBottom: '20px' }}>
        <h3>{t('Deploy to your own server')}</h3>
        <span style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'block', marginBottom: '12px' }}>
          {t('Run this on your Windows dedicated machine (PowerShell as Administrator). It installs Node, WireGuard (10.8.0.1 + peers), builds the app and registers an auto-start service.')}
        </span>
        <textarea
          readOnly
          value={DEPLOY_COMMAND}
          rows={4}
          style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: 12 }}
        />
        <div style={{ display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn"
            onClick={() => {
              void navigator.clipboard?.writeText(DEPLOY_COMMAND);
            }}
          >
            {t('Copy deploy command')}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => window.open(DEPLOY_GUIDE_RU, '_blank')}
          >
            {t('Guide (RU)')}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => window.open(DEPLOY_GUIDE_EN, '_blank')}
          >
            {t('Guide (EN)')}
          </button>
        </div>
        <p className="hint" style={{ marginTop: '12px', fontSize: 12, color: 'var(--text-muted)' }}>
          {t('After bootstrap finishes, import peer-*.conf from C:\\antidetect-clients into WireGuard on your devices, then connect here using http://10.8.0.1.')}
        </p>
      </div>
    </div>
  );
};

export default CloudSync;
