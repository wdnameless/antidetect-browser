import { useEffect, useMemo, useState } from 'react';
import { api, type CloudSessionItem, type CloudStateData, type ProfileListItem, type SyncResultRow } from '../api';
import { useI18n } from '../i18n';

const BOOTSTRAP_URL =
  'https://raw.githubusercontent.com/wdnameless/antidetect-browser/main/deploy/bootstrap.ps1';
const GUIDE_RU = 'https://github.com/wdnameless/antidetect-browser/blob/main/docs/SERVER_DEPLOY.ru.md';
const GUIDE_EN = 'https://github.com/wdnameless/antidetect-browser/blob/main/docs/SERVER_DEPLOY.md';

function CopyBtn({ value, label }: { value: string; label?: string }): React.ReactElement {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? '✓' : (label ?? 'Copy')}
    </button>
  );
}

export function CloudSync() {
  const { t } = useI18n();
  const [state, setState] = useState<CloudStateData | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  // connect form
  const [url, setUrl] = useState('');
  // credentials form
  const [user, setUser] = useState('admin');
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');

  // sessions (devices)
  const [sessions, setSessions] = useState<CloudSessionItem[]>([]);
  // sync lists
  const [localList, setLocalList] = useState<ProfileListItem[]>([]);
  const [remoteList, setRemoteList] = useState<ProfileListItem[]>([]);
  const [selLocal, setSelLocal] = useState<Set<string>>(new Set());
  const [selRemote, setSelRemote] = useState<Set<string>>(new Set());
  const [syncLog, setSyncLog] = useState<SyncResultRow[]>([]);

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
    if (state?.authorized) loadSessions();
    if (state?.configured) loadLocalProfiles();
  }, [state?.connected, state?.authorized]);

  const authorized = Boolean(state?.authorized);

  const doConnect = (): void => {
    if (!url.trim()) return;
    setBusy(true); setNotice('');
    api.cloudConnect(url.trim()).then((r) => {
      setState(r.data);
      if (r.code !== 0) setNotice(r.msg);
      setBusy(false);
      refreshState();
    }).catch(() => { setBusy(false); });
  };

  const doSetupOrLogin = (): void => {
    if (pass.length < 6) { setNotice(t('Password must be at least 6 characters')); return; }
    if (!state?.hasPassword && pass !== pass2) { setNotice(t('Passwords do not match')); return; }
    setBusy(true); setNotice('');
    const call = state?.hasPassword ? api.cloudLogin(user.trim(), pass) : api.cloudSetup(user.trim(), pass);
    call.then((r) => {
      if (r.code === 0) {
        setPass(''); setPass2('');
      } else {
        setNotice(r.msg);
      }
      setBusy(false);
      refreshState();
    }).catch(() => { setBusy(false); });
  };

  const doDisconnect = (): void => {
    setBusy(true);
    api.cloudDisconnect().then(() => {
      setSessions([]); setRemoteList([]); setSyncLog([]);
      setBusy(false);
      refreshState();
    }).catch(() => setBusy(false));
  };

  const pushSelected = (ids?: string[]): void => {
    setBusy(true); setNotice(''); setSyncLog([]);
    api.cloudPush(ids).then((r) => {
      if (r.code === 0) {
        setSyncLog(r.data.results);
        setNotice(`${t('Pushed')}: ${r.data.pushed}, ${t('Failed')}: ${r.data.failed}`);
      } else setNotice(r.msg);
      setBusy(false);
    }).catch(() => setBusy(false));
  };

  const pullSelected = (ids?: string[]): void => {
    setBusy(true); setNotice(''); setSyncLog([]);
    api.cloudPull(ids).then((r) => {
      if (r.code === 0) {
        setSyncLog(r.data.results);
        setNotice(`${t('Pulled')}: ${r.data.pulled}, ${t('Failed')}: ${r.data.failed}`);
      } else setNotice(r.msg);
      setBusy(false);
    }).catch(() => setBusy(false));
  };

  const loadRemote = (): void => {
    setBusy(true);
    api.cloudRemoteList().then((r) => {
      if (r.code === 0) {
        setRemoteList(r.data.list ?? []);
        setSelRemote(new Set());
      } else {
        setNotice(r.msg);
      }
      setBusy(false);
    }).catch(() => setBusy(false));
  };

  const deployCmd = useMemo(
    () =>
      [
        `irm ${BOOTSTRAP_URL} -OutFile bootstrap.ps1`,
        `Set-ExecutionPolicy -Scope Process Bypass -Force`,
        `.\\bootstrap.ps1 -Peers 3`,
      ].join('\n'),
    []
  );

  const badge = !state?.configured ? (
    <span className="badge">{t('Not connected')}</span>
  ) : state.connected ? (
    <span className="badge running">{state.authorized ? t('Connected') : t('Server found — sign in required')}</span>
  ) : (
    <span className="badge closed">{`${t('Unreachable')} (${state.error ?? ''})`}</span>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ---- status ---- */}
      <div className="panel">
        <div className="panel-header" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h3 style={{ margin: 0 }}>{t('Server connection')}</h3>
          {badge}
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={refreshState} disabled={busy}>{t('Refresh')}</button>
          {state?.configured ? (
            <button className="btn" onClick={doDisconnect} disabled={busy}>{t('Disconnect')}</button>
          ) : null}
        </div>
        <p className="hint">
          {state?.configured
            ? `${state.url ?? ''}${state.version ? ` · v${state.version}` : ''}${state.user ? ` · ${state.user}` : ''}`
            : t('Deploy the browser on your own server and manage its profiles from any device.')}
        </p>

        {!state?.configured ? (
          <>
            <div className="form-group" style={{ maxWidth: 480 }}>
              <label>{t('Server URL or IP (e.g. http://10.8.0.1)')}</label>
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://10.8.0.1" />
            </div>
            <button className="btn primary" onClick={doConnect} disabled={busy || !url.trim()}>
              {t('Connect')}
            </button>
          </>
        ) : null}

        {state?.configured && !authorized ? (
          <div style={{ marginTop: 12, maxWidth: 480 }}>
            {state.hasPassword === false ? (
              <p className="hint">{t('First time on this server: create the panel login and password.')}</p>
            ) : (
              <p className="hint">{t('Sign in to your server account.')}</p>
            )}
            <div className="form-group"><label>{t('Login')}</label>
              <input value={user} onChange={(e) => setUser(e.target.value)} /></div>
            <div className="form-group"><label>{t('Password')}</label>
              <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} /></div>
            {state.hasPassword === false ? (
              <div className="form-group"><label>{t('Repeat password')}</label>
                <input type="password" value={pass2} onChange={(e) => setPass2(e.target.value)} /></div>
            ) : null}
            <button className="btn primary" onClick={doSetupOrLogin} disabled={busy}>
              {state.hasPassword === false ? t('Create account & connect') : t('Sign in')}
            </button>
          </div>
        ) : null}

        {authorized ? (
          <div style={{ marginTop: 12 }}>
            <div className="setting-row">
              <span className="setting-label">API token</span>
              <span className="id-badge" style={{ marginRight: 8 }}>••••••••</span>
              <CopyBtn label={t('Copy token')} value={localStorage.getItem('apiKey') ?? ''} />
            </div>
            <div className="setting-row">
              <span className="setting-label">{t('Web panel')}</span>
              <span style={{ marginRight: 8 }}>{`${state?.url ?? ''}/ui`}</span>
              <CopyBtn label={t('Copy URL')} value={`${state?.url ?? ''}/ui`} />
            </div>
            <div className="setting-row">
              <span className="setting-label">{t('Automation endpoint example')}</span>
              <code style={{ fontSize: 11.5 }}>{`ws://<server-ip>/cdp/<profile-id>`}</code>
            </div>
          </div>
        ) : null}
      </div>

      {/* ---- deployment ---- */}
      <div className="panel">
        <div className="panel-header"><h3 style={{ margin: 0 }}>{t('Deploy to your own server')}</h3></div>
        <p className="hint">
          {t('Run this on your Windows dedicated machine (PowerShell as Administrator). It installs Node, WireGuard (10.8.0.1 + peers), builds the app and registers an auto-start service.')}
        </p>
        <textarea readOnly value={deployCmd} rows={4} style={{ width: '100%', fontFamily: 'monospace', fontSize: 12 }} />
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <CopyBtn value={deployCmd} label={t('Copy deploy command')} />
          <a className="btn" href={GUIDE_RU} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>{t('Guide (RU)')}</a>
          <a className="btn" href={GUIDE_EN} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>{t('Guide (EN)')}</a>
        </div>
        <p className="hint" style={{ marginTop: 8 }}>
          {t('After bootstrap finishes, import peer-*.conf from C:\\antidetect-clients into WireGuard on your devices, then connect here using http://10.8.0.1.')}
        </p>
      </div>

      {/* ---- sync ---- */}
      {authorized ? (
        <div className="panel">
          <div className="panel-header"><h3 style={{ margin: 0 }}>{t('Profile sync')}</h3></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <b>{t('This PC')}</b><span style={{ flex: 1 }} />
                <button className="btn" onClick={() => loadLocalProfiles()}>{t('Reload')}</button>
                <button className="btn primary" disabled={busy || selLocal.size === 0}
                  onClick={() => pushSelected(Array.from(selLocal))}>{t('Push selected →')}</button>
                <button className="btn" disabled={busy}
                  onClick={() => pushSelected(undefined)}>{t('Push all')}</button>
              </div>
              <table style={{ width: '100%', fontSize: 12.5, borderCollapse: 'collapse' }}>
                <tbody>
                  {localList.slice(0, 50).map((p) => (
                    <tr key={p.user_id}>
                      <td style={{ padding: '4px 6px' }}>
                        <input type="checkbox" checked={selLocal.has(p.user_id)}
                          onChange={(e) => {
                            const s = new Set(selLocal);
                            if (e.target.checked) s.add(p.user_id); else s.delete(p.user_id);
                            setSelLocal(s);
                          }} />
                      </td>
                      <td style={{ padding: '4px 6px' }}>{p.name}</td>
                      <td style={{ padding: '4px 6px', opacity: 0.55 }}>{p.status}</td>
                    </tr>
                  ))}
                  {localList.length === 0 ? (
                    <tr><td colSpan={3} className="empty-cell">{t('No local profiles')}</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <b>{t('Server')}</b><span style={{ flex: 1 }} />
                <button className="btn" onClick={loadRemote} disabled={busy}>{t('Load server list')}</button>
                <button className="btn primary" disabled={busy || selRemote.size === 0}
                  onClick={() => pullSelected(Array.from(selRemote))}>{t('Pull selected ←')}</button>
              </div>
              <table style={{ width: '100%', fontSize: 12.5, borderCollapse: 'collapse' }}>
                <tbody>
                  {remoteList.map((p) => (
                    <tr key={p.user_id}>
                      <td style={{ padding: '4px 6px' }}>
                        <input type="checkbox" checked={selRemote.has(p.user_id)}
                          onChange={(e) => {
                            const s = new Set(selRemote);
                            if (e.target.checked) s.add(p.user_id); else s.delete(p.user_id);
                            setSelRemote(s);
                          }} />
                      </td>
                      <td style={{ padding: '4px 6px' }}>{p.name}</td>
                      <td style={{ padding: '4px 6px', opacity: 0.55 }}>{p.status}</td>
                    </tr>
                  ))}
                  {remoteList.length === 0 ? (
                    <tr><td colSpan={3} className="empty-cell">{t('No server profiles loaded')}</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          {syncLog.length > 0 ? (
            <div style={{ marginTop: 10, maxHeight: 160, overflowY: 'auto', fontSize: 12 }}>
              {syncLog.map((r) => (
                <div key={r.user_id + (r.new_id ?? '')}>
                  {r.ok ? '✓' : '✗'} {r.name || r.user_id}{r.ok ? ` → ${r.new_id}` : ` — ${r.error}`}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ---- devices / sessions ---- */}
      {authorized ? (
        <div className="panel">
          <div className="panel-header" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h3 style={{ margin: 0 }}>{t('Devices (recent logins)')}</h3>
            <span style={{ flex: 1 }} />
            <button className="btn" onClick={loadSessions}>{t('Refresh')}</button>
          </div>
          <table style={{ width: '100%', fontSize: 12.5, borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '4px 8px' }}>{t('Time')}</th>
                <th style={{ textAlign: 'left', padding: '4px 8px' }}>IP</th>
                <th style={{ textAlign: 'left', padding: '4px 8px' }}>{t('Login')}</th>
                <th style={{ textAlign: 'left', padding: '4px 8px' }}>User-Agent</th>
              </tr>
            </thead>
            <tbody>
              {sessions.slice(0, 20).map((s, i) => (
                <tr key={i}>
                  <td style={{ padding: '4px 8px' }}>{new Date(s.at).toLocaleString()}</td>
                  <td style={{ padding: '4px 8px' }}>{s.ip}</td>
                  <td style={{ padding: '4px 8px' }}>{s.username}</td>
                  <td style={{ padding: '4px 8px', opacity: 0.6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 320 }}>{s.ua}</td>
                </tr>
              ))}
              {sessions.length === 0 ? (
                <tr><td colSpan={4} className="empty-cell">{t('No logins yet')}</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : null}

      {notice ? <div className="error-banner">{notice}</div> : null}
    </div>
  );
}
