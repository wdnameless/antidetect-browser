import React, { useState, useEffect, useCallback } from 'react';
import { api, type VaultEntry } from '../api';
import { useI18n } from '../i18n';
import { KeyIcon, CheckIcon, CopyIcon, TrashIcon } from '../icons';

export interface ProfileVaultProps {
  profileId: string;
}

export function ProfileVault({ profileId }: ProfileVaultProps) {
  const { t } = useI18n();
  const [vaultEntries, setVaultEntries] = useState<VaultEntry[]>([]);
  const [vaultForm, setVaultForm] = useState<{
    id: string | null;
    label: string;
    login: string;
    password: string;
    totp: string;
    notes: string;
  }>({
    id: null,
    label: '',
    login: '',
    password: '',
    totp: '',
    notes: '',
  });
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadVault = useCallback(async (pid: string) => {
    try {
      const res = await api.vaultList(pid);
      if (res.code === 0) setVaultEntries(res.data.list);
    } catch {
      /* ignore */
    }
  }, []);

  // Previously, `loadVault` was only called inside `openVaultTab`, which was never invoked anywhere in the codebase
  // because the Edit modal lacked a tab switcher and rendered sections in one continuous scroll. As a result,
  // the credentials vault list remained permanently empty even for profiles with saved credentials. Loading
  // on mount and whenever `profileId` changes ensures entries are fetched as soon as the modal is opened.
  useEffect(() => {
    if (profileId) {
      void loadVault(profileId);
    } else {
      setVaultEntries([]);
    }
  }, [profileId, loadVault]);

  const saveVaultEntry = async () => {
    if (!profileId) return;
    setBusy(true);
    setError('');
    try {
      const body = {
        label: vaultForm.label.trim() || undefined,
        login: vaultForm.login.trim() || undefined,
        password: vaultForm.password || undefined,
        totp_secret: vaultForm.totp.trim() || undefined,
        notes: vaultForm.notes.trim() || undefined,
      };
      const res = vaultForm.id
        ? await api.vaultUpdate(profileId, vaultForm.id, body)
        : await api.vaultCreate(profileId, body);
      if (res.code === 0) {
        setVaultForm({ id: null, label: '', login: '', password: '', totp: '', notes: '' });
        await loadVault(profileId);
      } else {
        setError(res.msg);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const editVaultEntry = (e: VaultEntry) => {
    setVaultForm({
      id: e.id,
      label: e.label || '',
      login: e.login || '',
      password: '',
      totp: '',
      notes: e.notes || '',
    });
  };

  const deleteVaultEntry = async (entryId: string) => {
    if (!profileId) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.vaultDelete(profileId, entryId);
      if (res.code === 0) await loadVault(profileId);
      else setError(res.msg);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const revealVaultField = async (entry: VaultEntry, field: 'password' | 'totp_secret') => {
    if (!profileId) return;
    const key = `${entry.id}:${field}`;
    if (revealed[key]) {
      // toggle off
      setRevealed((r) => {
        const n = { ...r };
        delete n[key];
        return n;
      });
      return;
    }
    try {
      const res = await api.vaultReveal(profileId, entry.id, field);
      if (res.code === 0) {
        setRevealed((r) => ({ ...r, [key]: res.data.value }));
        setTimeout(() => {
          setRevealed((r) => {
            const n = { ...r };
            delete n[key];
            return n;
          });
        }, 15000);
      } else {
        setError(res.msg);
      }
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const copyVaultValue = (text: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedValue(text);
    setTimeout(() => setCopiedValue(null), 1500);
  };

  return (
    <div className="pf-section" id="pf-section-vault">
      <div className="pf-section-label">{t('VAULT')}</div>
      {error ? <div className="error-banner" style={{ marginBottom: 8 }}>{error}</div> : null}
      <div className="form-group">
        <label>{vaultForm.id ? t('Edit entry') : t('Add entry')}</label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <input
            placeholder={t('Label (e.g. main account)')}
            value={vaultForm.label}
            onChange={(e) => setVaultForm({ ...vaultForm, label: e.target.value })}
          />
          <input
            placeholder={t('Login')}
            value={vaultForm.login}
            onChange={(e) => setVaultForm({ ...vaultForm, login: e.target.value })}
          />
          <input
            type="password"
            placeholder={t('Password')}
            value={vaultForm.password}
            onChange={(e) => setVaultForm({ ...vaultForm, password: e.target.value })}
          />
          <input
            placeholder={t('TOTP secret (optional)')}
            value={vaultForm.totp}
            onChange={(e) => setVaultForm({ ...vaultForm, totp: e.target.value })}
          />
        </div>
        <input
          style={{ marginTop: 8 }}
          placeholder={t('Notes')}
          value={vaultForm.notes}
          onChange={(e) => setVaultForm({ ...vaultForm, notes: e.target.value })}
        />
        <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
          <button className="btn primary" onClick={() => void saveVaultEntry()} disabled={busy}>
            {vaultForm.id ? t('Save') : t('Add')}
          </button>
          {vaultForm.id ? (
            <button
              className="btn"
              onClick={() => setVaultForm({ id: null, label: '', login: '', password: '', totp: '', notes: '' })}
            >
              {t('Cancel')}
            </button>
          ) : null}
        </div>
      </div>

      <div className="table-container" style={{ marginTop: 10 }}>
        <table className="table">
          <thead>
            <tr>
              <th>{t('Label')}</th>
              <th>{t('Login')}</th>
              <th>{t('Password')}</th>
              <th style={{ width: '20%', textAlign: 'right' }}>{t('Actions')}</th>
            </tr>
          </thead>
          <tbody>
            {vaultEntries.length === 0 ? (
              <tr>
                <td colSpan={4} className="empty-cell" style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                  {t('No saved credentials yet. Passwords are encrypted (AES-256-GCM) and never leave this machine.')}
                </td>
              </tr>
            ) : (
              vaultEntries.map((e) => {
                const pwKey = `${e.id}:password`;
                const totpKey = `${e.id}:totp_secret`;
                return (
                  <tr key={e.id}>
                    <td style={{ fontSize: 12.5 }}>{e.label || '—'}</td>
                    <td style={{ fontSize: 12.5 }}>{e.login || '—'}</td>
                    <td style={{ fontSize: 12.5 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <code style={{ fontFamily: 'var(--font-mono)' }}>
                          {revealed[pwKey] || (e.has_password ? '******' : '—')}
                        </code>
                        {e.has_password ? (
                          <>
                            <button
                              type="button"
                              className="btn-icon"
                              style={{ padding: '2px 6px' }}
                              onClick={() => void revealVaultField(e, 'password')}
                              title={t('Reveal / hide (15s)')}
                            >
                              <KeyIcon size={11} />
                            </button>
                            <button
                              type="button"
                              className="btn-icon"
                              style={{ padding: '2px 6px' }}
                              onClick={() => revealed[pwKey] && copyVaultValue(revealed[pwKey])}
                              disabled={!revealed[pwKey]}
                              title={t('Copy value')}
                            >
                              {copiedValue && revealed[pwKey] === copiedValue ? (
                                <CheckIcon size={11} style={{ color: 'var(--ok)' }} />
                              ) : (
                                <CopyIcon size={11} />
                              )}
                            </button>
                          </>
                        ) : null}
                        {e.has_totp ? (
                          <code
                            style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}
                            title={revealed[totpKey] || t('TOTP secret stored')}
                          >
                            {revealed[totpKey] ? `TOTP: ${revealed[totpKey]}` : 'TOTP: ******'}
                          </code>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => editVaultEntry(e)}
                          disabled={busy}
                        >
                          {t('Edit')}
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-danger"
                          onClick={() => void deleteVaultEntry(e.id)}
                          disabled={busy}
                        >
                          <TrashIcon size={11} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
