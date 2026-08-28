import { useCallback, useEffect, useState } from 'react';
import { api, type TeamItem, type TeamMemberItem, type TeamPermissions } from '../api';
import { useI18n } from '../i18n';
import { PlusIcon, TrashIcon, CopyIcon, RefreshIcon, CheckIcon } from '../icons';

const PERM_FLAGS: Array<{ key: keyof TeamPermissions; label: string }> = [
  { key: 'can_run_profiles', label: 'Run profiles' },
  { key: 'can_add_profiles', label: 'Add profiles' },
  { key: 'can_remove_profiles', label: 'Remove profiles' },
  { key: 'can_invite', label: 'Invite members' },
];

const defaultPerms = (): TeamPermissions => ({
  can_run_profiles: true,
  can_add_profiles: false,
  can_remove_profiles: false,
  can_invite: false,
});

export function Teams() {
  const { t } = useI18n();
  const [teams, setTeams] = useState<TeamItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  // create-team form
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');

  // invite form
  const [inviteTeam, setInviteTeam] = useState<TeamItem | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [invitePerms, setInvitePerms] = useState<TeamPermissions>(defaultPerms());
  const [inviteCode, setInviteCode] = useState('');

  // members panel
  const [membersOf, setMembersOf] = useState<string | null>(null);
  const [members, setMembers] = useState<TeamMemberItem[]>([]);

  // accept invite
  const [acceptTeam, setAcceptTeam] = useState('');
  const [acceptEmail, setAcceptEmail] = useState('');
  const [acceptCode, setAcceptCode] = useState('');

  const load = useCallback(() => {
    setBusy(true);
    api.teamsList()
      .then((res) => {
        if (res.code === 0) setTeams(res.data.list);
        else setError(res.msg);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setBusy(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const loadMembers = useCallback((teamId: string) => {
    api.teamMembers(teamId)
      .then((res) => {
        if (res.code === 0) {
          setMembers(res.data.list);
          setMembersOf(teamId);
        }
      })
      .catch(() => undefined);
  }, []);

  const onCreate = async () => {
    setError('');
    setMsg('');
    if (!newName.trim()) return;
    setBusy(true);
    try {
      const res = await api.teamCreate(newName.trim());
      if (res.code === 0) {
        setMsg(t('Team created'));
        setNewName('');
        setShowCreate(false);
        load();
      } else {
        setError(res.msg);
      }
    } finally {
      setBusy(false);
    }
  };

  const onInvite = async () => {
    if (!inviteTeam || !inviteEmail.trim()) return;
    setError('');
    setMsg('');
    setBusy(true);
    try {
      const res = await api.teamInvite(inviteTeam.id, inviteEmail.trim(), invitePerms);
      if (res.code === 0) {
        setInviteCode(res.data.activation_code ?? '');
        load();
      } else {
        setError(res.msg);
      }
    } finally {
      setBusy(false);
    }
  };

  const onAccept = async () => {
    setError('');
    setMsg('');
    if (!acceptTeam.trim() || !acceptEmail.trim() || !acceptCode.trim()) return;
    setBusy(true);
    try {
      const res = await api.inviteAccept(acceptTeam.trim(), acceptEmail.trim(), acceptCode.trim());
      if (res.code === 0) {
        setMsg(t('Invite accepted'));
        setAcceptTeam('');
        setAcceptEmail('');
        setAcceptCode('');
        load();
      } else {
        setError(res.msg);
      }
    } finally {
      setBusy(false);
    }
  };

  const onDeleteTeam = async (team: TeamItem) => {
    if (!window.confirm(`${t('Delete team')} "${team.name}"?`)) return;
    setBusy(true);
    try {
      const res = await api.teamDelete(team.id);
      if (res.code === 0) {
        setMsg(t('Team deleted'));
        if (membersOf === team.id) setMembersOf(null);
        load();
      } else {
        setError(res.msg);
      }
    } finally {
      setBusy(false);
    }
  };

  const onRemoveMember = async (teamId: string, memberId: string) => {
    if (!window.confirm(t('Remove this member?'))) return;
    setBusy(true);
    try {
      const res = await api.teamMemberRemove(teamId, memberId);
      if (res.code === 0) loadMembersSafe(teamId);
      else setError(res.msg);
    } finally {
      setBusy(false);
    }
  };

  const onCancelInvite = async (teamId: string, memberId: string) => {
    setBusy(true);
    try {
      const res = await api.teamInviteCancel(teamId, memberId);
      if (res.code === 0) loadMembersSafe(teamId);
      else setError(res.msg);
    } finally {
      setBusy(false);
    }
  };

  const loadMembersSafe = (teamId: string) => {
    if (membersOf === teamId) loadMembers(teamId);
  };

  const onPermToggle = async (teamId: string, m: TeamMemberItem, key: keyof TeamPermissions) => {
    if (!m.permissions) return;
    const next = { ...m.permissions, [key]: !m.permissions[key] };
    setBusy(true);
    try {
      const res = await api.teamMemberPermissions(teamId, m.member_id, next);
      if (res.code === 0) loadMembersSafe(teamId);
      else setError(res.msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="toolbar">
        <button className="btn primary" onClick={() => setShowCreate((v) => !v)} disabled={busy}>
          <PlusIcon size={15} /> {t('New Team')}
        </button>
        <button className="btn" onClick={load} disabled={busy}>
          <RefreshIcon size={15} /> {t('Refresh')}
        </button>
      </div>

      {showCreate && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="row" style={{ gap: 8 }}>
            <input
              className="input"
              placeholder={t('Team name')}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              maxLength={100}
            />
            <button className="btn primary" onClick={() => void onCreate()} disabled={busy || !newName.trim()}>
              {t('Create')}
            </button>
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>{t('Accept invite')}</div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <input className="input" placeholder={t('Team ID')} value={acceptTeam} onChange={(e) => setAcceptTeam(e.target.value)} style={{ maxWidth: 260 }} />
          <input className="input" placeholder={t('Email')} value={acceptEmail} onChange={(e) => setAcceptEmail(e.target.value)} style={{ maxWidth: 220 }} />
          <input className="input" placeholder={t('Activation code')} value={acceptCode} onChange={(e) => setAcceptCode(e.target.value)} style={{ maxWidth: 200 }} />
          <button className="btn primary" onClick={() => void onAccept()} disabled={busy}>
            {t('Accept')}
          </button>
        </div>
      </div>

      {error && <div className="error-banner">{t(error)}</div>}
      {msg && <div className="ok-banner">{t(msg)}</div>}

      {teams.length === 0 && !busy ? (
        <div className="empty">{t('No teams yet. Create a team or accept an invite.')}</div>
      ) : (
        teams.map((team) => (
          <div key={team.id} className="card" style={{ marginBottom: 10 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontWeight: 600 }}>{team.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {team.id} · {team.member_count} {t('members')}
                  {team.local_role === 'owner' ? ` · ${t('you are the owner')}` : ''}
                  {team.local_status === 'pending' ? ` · ${t('pending membership')}` : ''}
                </div>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <button className="btn" onClick={() => (membersOf === team.id ? setMembersOf(null) : loadMembers(team.id))}>
                  {t('Members')}
                </button>
                {team.local_role === 'owner' && (
                  <button className="btn" onClick={() => { setInviteTeam(team); setInviteCode(''); setInviteEmail(''); setInvitePerms(defaultPerms()); }}>
                    {t('Invite')}
                  </button>
                )}
                {team.local_role === 'owner' && (
                  <button className="btn danger" onClick={() => void onDeleteTeam(team)}>
                    <TrashIcon size={14} />
                  </button>
                )}
              </div>
            </div>

            {inviteTeam?.id === team.id && (
              <div style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <input className="input" placeholder={t('Email')} value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} style={{ maxWidth: 240 }} />
                  {PERM_FLAGS.map((f) => (
                    <label key={f.key} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <input
                        type="checkbox"
                        checked={invitePerms[f.key]}
                        onChange={() => setInvitePerms((p) => ({ ...p, [f.key]: !p[f.key] }))}
                      />
                      {t(f.label)}
                    </label>
                  ))}
                  <button className="btn primary" onClick={() => void onInvite()} disabled={busy || !inviteEmail.trim()}>
                    {t('Invite')}
                  </button>
                  <button className="btn" onClick={() => setInviteTeam(null)}>{t('Cancel')}</button>
                </div>
                {inviteCode && (
                  <div className="row" style={{ marginTop: 8, gap: 8 }}>
                    <code className="code">{inviteCode}</code>
                    <button className="btn" onClick={() => void navigator.clipboard.writeText(inviteCode)}>
                      <CopyIcon size={13} /> {t('Copy code')}
                    </button>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {t('Shown once — share with the invitee')}
                    </span>
                  </div>
                )}
              </div>
            )}

            {membersOf === team.id && (
              <div style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                {members.length === 0 ? (
                  <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>{t('No members visible')}</div>
                ) : (
                  members.map((m) => (
                    <div key={m.member_id} className="row" style={{ justifyContent: 'space-between', padding: '6px 0', flexWrap: 'wrap' }}>
                      <div style={{ fontSize: 13 }}>
                        <strong>{m.email ?? m.member_id.slice(0, 12)}</strong>{' '}
                        <span style={{ color: 'var(--text-muted)' }}>
                          ({m.role === 'owner' ? t('owner') : t('member')}, {m.status})
                        </span>
                      </div>
                      <div className="row" style={{ gap: 6 }}>
                        {m.role === 'member' &&
                          PERM_FLAGS.map((f) => (
                            <label key={f.key} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 3 }}>
                              <input type="checkbox" checked={Boolean(m.permissions?.[f.key])} onChange={() => void onPermToggle(team.id, m, f.key)} />
                              {t(f.label)}
                            </label>
                          ))}
                        {m.role === 'member' && m.status === 'pending' && (
                          <button className="btn" onClick={() => void onCancelInvite(team.id, m.member_id)}>
                            {t('Cancel invite')}
                          </button>
                        )}
                        {m.role === 'member' && m.status === 'active' && team.local_role === 'owner' && (
                          <button className="btn danger" onClick={() => void onRemoveMember(team.id, m.member_id)}>
                            {t('Remove')}
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        ))
      )}
      <div style={{ height: 8 }} />
      <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
        <CheckIcon size={12} /> {t('Owner has all rights. Only the owner removes members.')}
      </div>
    </div>
  );
}