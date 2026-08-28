import { useCallback, useEffect, useState } from 'react';
import { api, type ScriptItem, type ScriptRunItem, type KeyItem, type TriggerItem, type ProfileListItem } from '../api';
import { useI18n } from '../i18n';
import { PlusIcon, TrashIcon, EditIcon, PlayIcon, RefreshIcon, KeyIcon } from '../icons';

type Tab = 'scripts' | 'keys' | 'triggers';

export function Scripts() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('scripts');

  return (
    <div>
      <div className="modal-tabs" style={{ marginBottom: 16, borderBottom: '1px solid var(--border)', display: 'flex', gap: 4 }}>
        {(['scripts', 'keys', 'triggers'] as Tab[]).map((tb) => (
          <button key={tb} className={`tab-btn ${tab === tb ? 'active' : ''}`} onClick={() => setTab(tb)}>
            {tb === 'scripts' ? <PlayIcon size={13} /> : tb === 'keys' ? <KeyIcon size={13} /> : <RefreshIcon size={13} />}
            <span>{t(tb === 'scripts' ? 'Scripts' : tb === 'keys' ? 'Global Keys' : 'Triggers')}</span>
          </button>
        ))}
      </div>
      {tab === 'scripts' ? <ScriptsTab /> : tab === 'keys' ? <KeysTab /> : <TriggersTab />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scripts tab
// ---------------------------------------------------------------------------

function ScriptsTab() {
  const { t } = useI18n();
  const [scripts, setScripts] = useState<ScriptItem[]>([]);
  const [profiles, setProfiles] = useState<ProfileListItem[]>([]);
  const [runs, setRuns] = useState<Record<string, ScriptRunItem[]>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<ScriptItem | null>(null);
  const [form, setForm] = useState<{ name: string; code: string }>({ name: '', code: '' });
  const [runPick, setRunPick] = useState<ScriptItem | null>(null);
  const [runSel, setRunSel] = useState<string[]>([]);
  const [openRuns, setOpenRuns] = useState<string | null>(null);

  const loadScripts = useCallback(async () => {
    try {
      const res = await api.scriptsList();
      if (res.code === 0) setScripts(res.data.list);
    } catch { /* ignore */ }
  }, []);

  const loadProfiles = useCallback(async () => {
    try {
      const res = await api.list({ page: 1, pageSize: 500 });
      if (res.code === 0) setProfiles(res.data.list);
    } catch { /* ignore */ }
  }, []);

  const loadRuns = useCallback(async (scriptId: string) => {
    try {
      const res = await api.scriptRuns(scriptId);
      if (res.code === 0) setRuns((r) => ({ ...r, [scriptId]: res.data.list }));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    void loadScripts();
    void loadProfiles();
  }, [loadScripts, loadProfiles]);

  const save = async () => {
    if (!form.name.trim() || !form.code.trim()) return;
    setBusy(true);
    setError('');
    try {
      const res = editing
        ? await api.scriptUpdate(editing.id, form)
        : await api.scriptCreate(form.name.trim(), form.code);
      if (res.code === 0) {
        setForm({ name: '', code: '' });
        setEditing(null);
        await loadScripts();
      } else {
        setError(res.msg);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm(t('Delete this script and its run history?'))) return;
    setBusy(true);
    try {
      await api.scriptDelete(id);
      await loadScripts();
    } finally {
      setBusy(false);
    }
  };

  const doRun = async () => {
    if (!runPick) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.scriptRun(runPick.id, runSel);
      if (res.code === 0) {
        setRunPick(null);
        setRunSel([]);
        await loadScripts();
        await loadRuns(runPick.id);
        setOpenRuns(runPick.id);
      } else {
        setError(res.msg);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const statusBadge = (s: string): string =>
    s === 'done' ? 'badge closed' : s === 'running' ? 'badge running' : 'badge';

  return (
    <div>
      {error ? <div className="error-banner">{error}</div> : null}

      {/* Editor */}
      <div className="card" style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <strong style={{ fontSize: 13.5 }}>{editing ? t('Edit script') : t('New script')}</strong>
          {editing ? (
            <button className="btn btn-sm" onClick={() => { setEditing(null); setForm({ name: '', code: '' }); }}>{t('Cancel')}</button>
          ) : null}
        </div>
        <div className="form-group">
          <input placeholder={t('Script name')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div className="form-group">
          <textarea
            style={{ fontFamily: 'var(--font-mono)', minHeight: 140, fontSize: 12.5 }}
            placeholder={'// app.profiles.list(), app.log("hi"), app.http.fetch(url), app.keys.get/set'}
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
          />
          <p className="hint">
            {t('Sandboxed JS: no require/process/fs. 60s timeout, max 100 http calls per run.')}
          </p>
        </div>
        <button className="btn primary" onClick={() => void save()} disabled={busy || !form.name.trim() || !form.code.trim()}>
          {editing ? t('Save') : t('Create')}
        </button>
      </div>

      {/* List */}
      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: '25%' }}>{t('Name')}</th>
              <th style={{ width: '15%' }}>{t('Last status')}</th>
              <th style={{ width: '20%' }}>{t('Updated')}</th>
              <th style={{ width: '40%', textAlign: 'right' }}>{t('Actions')}</th>
            </tr>
          </thead>
          <tbody>
            {scripts.length === 0 ? (
              <tr><td colSpan={4} className="empty-cell">{t('No scripts yet — create one or install from the Catalog.')}</td></tr>
            ) : (
              scripts.map((s) => (
                <tr key={s.id}>
                  <td>
                    <strong style={{ fontSize: 13.5 }}>{s.name}</strong>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{s.id.slice(0, 14)}...</div>
                  </td>
                  <td>
                    <span className={statusBadge(s.last_status || '—')}>{s.last_status || '—'}</span>
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{new Date(s.updated_at).toLocaleString()}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                      <button className="btn btn-sm" onClick={() => { setEditing(s); setForm({ name: s.name, code: s.code }); }} disabled={busy}>
                        <EditIcon size={11} /> {t('Edit')}
                      </button>
                      <button className="btn btn-sm" onClick={() => { setRunPick(s); setRunSel([]); }} disabled={busy}>
                        <PlayIcon size={11} /> {t('Run')}
                      </button>
                      <button className="btn btn-sm" onClick={() => { void loadRuns(s.id); setOpenRuns(openRuns === s.id ? null : s.id); }}>
                        {t('Runs')}
                      </button>
                      <button className="btn btn-sm btn-danger" onClick={() => void remove(s.id)} disabled={busy}>
                        <TrashIcon size={11} />
                      </button>
                    </div>
                    {openRuns === s.id ? (
                      <div style={{ marginTop: 8, textAlign: 'left', maxHeight: 220, overflowY: 'auto' }}>
                        {(runs[s.id] || []).length === 0 ? (
                          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('No runs yet.')}</div>
                        ) : (
                          (runs[s.id] || []).map((r) => (
                            <div key={r.id} style={{ fontSize: 11.5, borderTop: '1px solid var(--border)', padding: '5px 0' }}>
                              <span className={statusBadge(r.status)}>{r.status}</span>{' '}
                              <span style={{ color: 'var(--text-muted)' }}>{new Date(r.started_at).toLocaleString()}</span>
                              <pre style={{ fontSize: 11, margin: '4px 0 0', whiteSpace: 'pre-wrap', color: 'var(--text-secondary)' }}>
                                {r.log.slice(0, 500) || '—'}
                              </pre>
                            </div>
                          ))
                        )}
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Run picker */}
      {runPick ? (
        <div className="modal-overlay" onClick={() => setRunPick(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
            <div className="modal-header">
              <h3>{t('Run')} — {runPick.name}</h3>
              <button className="btn-icon" onClick={() => setRunPick(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p className="hint">{t('Pick profiles to run the script against (one worker per profile):')}</p>
              <div style={{ maxHeight: 260, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {profiles.map((p) => (
                  <label key={p.user_id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={runSel.includes(p.user_id)}
                      onChange={() => setRunSel((s) => s.includes(p.user_id) ? s.filter((x) => x !== p.user_id) : [...s, p.user_id])}
                    />
                    {p.name || p.user_id} <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>({p.status})</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setRunPick(null)}>{t('Cancel')}</button>
              <button className="btn primary" onClick={() => void doRun()} disabled={busy || runSel.length === 0}>
                <PlayIcon size={12} /> {t('Run')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Keys tab
// ---------------------------------------------------------------------------

function KeysTab() {
  const { t } = useI18n();
  const [keys, setKeys] = useState<KeyItem[]>([]);
  const [form, setForm] = useState({ key: '', value: '' });
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await api.keysList();
      if (res.code === 0) setKeys(res.data.list);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    if (!form.key.trim() || !form.value) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.keySet(form.key.trim(), form.value);
      if (res.code === 0) {
        setForm({ key: '', value: '' });
        await load();
      } else {
        setError(res.msg);
      }
    } finally {
      setBusy(false);
    }
  };

  const reveal = async (key: string) => {
    if (revealed[key]) {
      setRevealed((r) => { const n = { ...r }; delete n[key]; return n; });
      return;
    }
    const res = await api.keyReveal(key);
    if (res.code === 0) {
      setRevealed((r) => ({ ...r, [key]: res.data.value }));
      setTimeout(() => setRevealed((r) => { const n = { ...r }; delete n[key]; return n; }), 10000);
    }
  };

  return (
    <div>
      {error ? <div className="error-banner">{error}</div> : null}
      <div className="card" style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <input style={{ flex: 1 }} placeholder={t('Key name (e.g. api_token)')} value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} />
          <input style={{ flex: 1 }} type="password" placeholder={t('Value (encrypted at rest)')} value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} />
          <button className="btn primary" onClick={() => void save()} disabled={busy || !form.key.trim() || !form.value}>
            <PlusIcon size={13} /> {t('Save')}
          </button>
        </div>
        <p className="hint">{t('Values are AES-256-GCM encrypted. Scripts read them via app.keys.get — names only appear in lists.')}</p>
      </div>

      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: '30%' }}>{t('Key')}</th>
              <th style={{ width: '35%' }}>{t('Value')}</th>
              <th style={{ width: '35%', textAlign: 'right' }}>{t('Actions')}</th>
            </tr>
          </thead>
          <tbody>
            {keys.length === 0 ? (
              <tr><td colSpan={3} className="empty-cell">{t('No keys yet.')}</td></tr>
            ) : (
              keys.map((k) => (
                <tr key={k.key}>
                  <td><code style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5 }}>{k.key}</code></td>
                  <td><code style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5 }}>{revealed[k.key] || '******'}</code></td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <button className="btn btn-sm" onClick={() => void reveal(k.key)}>{t('Reveal')}</button>
                      <button className="btn btn-sm btn-danger" onClick={async () => { await api.keyDelete(k.key); await load(); }}>
                        <TrashIcon size={11} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Triggers tab
// ---------------------------------------------------------------------------

function TriggersTab() {
  const { t } = useI18n();
  const [triggers, setTriggers] = useState<TriggerItem[]>([]);
  const [scripts, setScripts] = useState<ScriptItem[]>([]);
  const [form, setForm] = useState<{ name: string; script_id: string; type: 'schedule' | 'event'; schedule: string; event: 'profile_started' | 'profile_stopped' }>({ name: '', script_id: '', type: 'schedule', schedule: 'interval:60', event: 'profile_started' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [tr, sc] = await Promise.all([api.triggersList(), api.scriptsList()]);
      if (tr.code === 0) setTriggers(tr.data.list);
      if (sc.code === 0) setScripts(sc.data.list);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    if (!form.name.trim() || !form.script_id) return;
    setBusy(true);
    setError('');
    try {
      const body: Record<string, unknown> = { name: form.name.trim(), script_id: form.script_id, type: form.type };
      if (form.type === 'schedule') body.schedule = form.schedule.trim();
      else body.event = form.event;
      const res = await api.triggerCreate(body as Parameters<typeof api.triggerCreate>[0]);
      if (res.code === 0) {
        setForm({ ...form, name: '' });
        await load();
      } else {
        setError(res.msg);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {error ? <div className="error-banner">{error}</div> : null}
      <div className="card" style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input style={{ flex: 1, minWidth: 140 }} placeholder={t('Trigger name')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <select value={form.script_id} onChange={(e) => setForm({ ...form, script_id: e.target.value })} style={{ minWidth: 140 }}>
            <option value="">{t('Script...')}</option>
            {scripts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as 'schedule' | 'event' })}>
            <option value="schedule">{t('Schedule')}</option>
            <option value="event">{t('Event')}</option>
          </select>
          {form.type === 'schedule' ? (
            <input style={{ width: 150 }} placeholder="interval:60 / daily:09:30" value={form.schedule} onChange={(e) => setForm({ ...form, schedule: e.target.value })} />
          ) : (
            <select value={form.event} onChange={(e) => setForm({ ...form, event: e.target.value as 'profile_started' | 'profile_stopped' })}>
              <option value="profile_started">{t('Profile started')}</option>
              <option value="profile_stopped">{t('Profile stopped')}</option>
            </select>
          )}
          <button className="btn primary" onClick={() => void save()} disabled={busy || !form.name.trim() || !form.script_id}>
            <PlusIcon size={13} /> {t('Create')}
          </button>
        </div>
        <p className="hint">{t('Schedule: "interval:<minutes>" or "daily:HH:MM". Event: fires on profile start/stop.')}</p>
      </div>

      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: '22%' }}>{t('Name')}</th>
              <th style={{ width: '18%' }}>{t('Type')}</th>
              <th style={{ width: '23%' }}>{t('Script')}</th>
              <th style={{ width: '15%' }}>{t('Enabled')}</th>
              <th style={{ width: '15%', textAlign: 'right' }}>{t('Actions')}</th>
            </tr>
          </thead>
          <tbody>
            {triggers.length === 0 ? (
              <tr><td colSpan={5} className="empty-cell">{t('No triggers yet.')}</td></tr>
            ) : (
              triggers.map((tr) => (
                <tr key={tr.id}>
                  <td style={{ fontSize: 13 }}>{tr.name}</td>
                  <td style={{ fontSize: 12 }}>
                    {tr.type === 'schedule' ? (tr.schedule || '') : (tr.event || '')}
                  </td>
                  <td style={{ fontSize: 12 }}>{scripts.find((s) => s.id === tr.script_id)?.name || tr.script_id.slice(0, 12) + '...'}</td>
                  <td>
                    <input
                      type="checkbox"
                      checked={tr.enabled === 1}
                      onChange={async () => { await api.triggerToggle(tr.id, tr.enabled !== 1); await load(); }}
                      style={{ cursor: 'pointer' }}
                    />
                  </td>
                  <td>
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <button className="btn btn-sm btn-danger" onClick={async () => { await api.triggerDelete(tr.id); await load(); }}>
                        <TrashIcon size={11} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}