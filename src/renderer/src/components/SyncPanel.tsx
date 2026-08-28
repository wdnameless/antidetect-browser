import { useCallback, useEffect, useState } from 'react';
import { api, type SyncSessionInfo, type ProfileListItem } from '../api';
import { useI18n } from '../i18n';
import { UsersIcon, StopIcon, CheckIcon } from '../icons';

interface Props {
  session: SyncSessionInfo;
  profiles: ProfileListItem[];
  onChanged: () => void;
  onClosed: () => void;
}

export function SyncPanel({ session, profiles, onChanged, onClosed }: Props) {
  const { t } = useI18n();
  const [info, setInfo] = useState<SyncSessionInfo>(session);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showJoin, setShowJoin] = useState(false);
  const [joinSel, setJoinSel] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    try {
      const res = await api.syncList();
      if (res.code === 0) {
        const cur = res.data.list.find((s) => s.id === info.id);
        if (cur) setInfo(cur);
        else onClosed(); // session ended (master closed / no slaves left)
      }
    } catch { /* ignore */ }
  }, [info.id, onClosed]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  const profileName = (id: string): string => profiles.find((p) => p.user_id === id)?.name || id;

  const stop = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await api.syncStop(info.id);
      if (res.code === 0) onClosed();
      else setError(res.msg);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const tile = async (layout: '2x2' | '3x3' | 'auto') => {
    setBusy(true);
    setError('');
    try {
      const res = await api.syncTile(info.id, layout);
      if (res.code !== 0) setError(res.msg);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const leave = async (profileId: string) => {
    setBusy(true);
    setError('');
    try {
      const res = await api.syncLeave(info.id, profileId);
      if (res.code === 0) {
        const next = res.data;
        if (next.status !== 'active') onClosed();
        else {
          setInfo(next);
          onChanged();
        }
      } else {
        setError(res.msg);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const join = async () => {
    setBusy(true);
    setError('');
    try {
      let lastErr = '';
      for (const pid of joinSel) {
        const res = await api.syncJoin(info.id, pid);
        if (res.code === 0) setInfo(res.data);
        else lastErr = res.msg;
      }
      if (lastErr) setError(lastErr);
      setShowJoin(false);
      setJoinSel([]);
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const joinable = profiles.filter(
    (p) => p.status === 'running' && !info.members.includes(p.user_id)
  );

  return (
    <div
      style={{
        position: 'fixed',
        right: 20,
        top: 64,
        width: 340,
        maxHeight: 'calc(100vh - 96px)',
        overflowY: 'auto',
        background: 'var(--panel)',
        border: '1px solid var(--accent)',
        borderRadius: 10,
        boxShadow: '0 12px 36px rgba(0,0,0,0.6)',
        padding: '14px 16px',
        zIndex: 950,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <UsersIcon size={16} style={{ color: 'var(--accent)' }} />
        <strong style={{ fontSize: 14, flex: 1 }}>{t('Action Sync')}</strong>
        <span
          className="badge running"
          style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 10 }}
        >
          {t('Session active')}
        </span>
      </div>

      {error ? (
        <div style={{ fontSize: 12, color: 'var(--danger)', fontFamily: 'var(--font-mono)' }}>{error}</div>
      ) : null}

      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
        {info.id.slice(0, 16)}...
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {info.members.map((pid) => {
          const isMaster = pid === info.master_profile_id;
          return (
            <div
              key={pid}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 9px',
                border: `1px solid ${isMaster ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: 6,
                background: isMaster ? 'rgba(255,255,255,0.04)' : 'transparent',
              }}
            >
              {isMaster ? (
                <span
                  style={{
                    fontSize: 9.5,
                    fontWeight: 800,
                    textTransform: 'uppercase',
                    color: 'var(--accent)',
                    letterSpacing: 0.5,
                  }}
                >
                  {t('Master')}
                </span>
              ) : (
                <span style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--text-muted)' }}>{t('Slave')}</span>
              )}
              <span style={{ fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={profileName(pid)}>
                {profileName(pid)}
              </span>
              {!isMaster ? (
                <button
                  type="button"
                  className="btn-icon"
                  style={{ padding: '2px 5px' }}
                  onClick={() => void leave(pid)}
                  disabled={busy}
                  title={t('Leave session')}
                >
                  ✕
                </button>
              ) : null}
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button className="btn btn-sm" onClick={() => void tile('2x2')} disabled={busy}>
          {t('Tile 2x2')}
        </button>
        <button className="btn btn-sm" onClick={() => void tile('3x3')} disabled={busy}>
          {t('Tile 3x3')}
        </button>
        <button className="btn btn-sm" onClick={() => void tile('auto')} disabled={busy}>
          {t('Tile auto')}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        {joinable.length > 0 ? (
          <button className="btn btn-sm" onClick={() => { setShowJoin(!showJoin); setJoinSel([]); }} disabled={busy}>
            {t('Join profile...')}
          </button>
        ) : null}
        <button className="btn btn-sm btn-danger" onClick={() => void stop()} disabled={busy} style={{ marginLeft: 'auto' }}>
          <StopIcon size={11} />
          <span>{t('Stop session')}</span>
        </button>
      </div>

      {showJoin ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 4, borderTop: '1px solid var(--border)' }}>
          {joinable.map((p) => (
            <label key={p.user_id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={joinSel.includes(p.user_id)}
                onChange={() => {
                  setJoinSel((s) =>
                    s.includes(p.user_id) ? s.filter((x) => x !== p.user_id) : [...s, p.user_id]
                  );
                }}
              />
              {p.name || p.user_id}
            </label>
          ))}
          <button className="btn btn-sm primary" onClick={() => void join()} disabled={busy || joinSel.length === 0}>
            <CheckIcon size={11} />
            <span>{t('Join selected')}</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}