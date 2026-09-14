import React, { useState, useEffect, useCallback } from 'react';
import { useI18n } from '../i18n';
import { api, type EmailAccount, type EmailMessageSummary, type EmailMessageDetail } from '../api';

export function Email(): JSX.Element {
  const { t } = useI18n();

  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [messages, setMessages] = useState<EmailMessageSummary[]>([]);
  const [isCached, setIsCached] = useState<boolean>(false);
  const [selectedMessage, setSelectedMessage] = useState<EmailMessageDetail | null>(null);
  const [extractedCodes, setExtractedCodes] = useState<string[]>([]);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [loadingInbox, setLoadingInbox] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // New account form
  const [showAddModal, setShowAddModal] = useState(false);
  const [formEmail, setFormEmail] = useState('');
  const [formHost, setFormHost] = useState('');
  const [formPort, setFormPort] = useState('993');
  const [formUsername, setFormUsername] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formLabel, setFormLabel] = useState('');

  const loadAccounts = useCallback(async () => {
    setLoadingAccounts(true);
    setError(null);
    try {
      const res = await api.emailAccountsList();
      if (res.code === 0 && Array.isArray(res.data)) {
        setAccounts(res.data);
        if (res.data.length > 0 && !selectedAccountId) {
          setSelectedAccountId(res.data[0].id);
        }
      } else {
        setError(res.msg || 'Failed to load email accounts');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingAccounts(false);
    }
  }, [selectedAccountId]);

  const loadInbox = useCallback(async (accountId: string) => {
    setLoadingInbox(true);
    setError(null);
    setSelectedMessage(null);
    setExtractedCodes([]);
    try {
      const res = await api.emailInboxList(accountId);
      if (res.code === 0 && res.data) {
        setMessages(res.data.messages || []);
        setIsCached(Boolean(res.data.cached));
      } else {
        setError(res.msg || 'Failed to fetch inbox');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingInbox(false);
    }
  }, []);

  const loadMessage = useCallback(async (accountId: string, uid: string) => {
    setLoadingMessage(true);
    setError(null);
    try {
      const res = await api.emailMessageGet(accountId, uid);
      if (res.code === 0 && res.data) {
        setSelectedMessage(res.data);
        // Extract codes from body and subject
        const extractRes = await api.emailExtractCodes(`${res.data.subject}\n\n${res.data.body}`);
        if (extractRes.code === 0 && extractRes.data) {
          setExtractedCodes(extractRes.data.codes || []);
        }
      } else {
        setError(res.msg || 'Failed to fetch message');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingMessage(false);
    }
  }, []);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  useEffect(() => {
    if (selectedAccountId) {
      void loadInbox(selectedAccountId);
    }
  }, [selectedAccountId, loadInbox]);

  const handleAddAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const res = await api.emailAccountCreate({
        email: formEmail,
        host: formHost,
        port: parseInt(formPort, 10) || 993,
        username: formUsername || formEmail,
        password: formPassword,
        label: formLabel || undefined,
      });
      if (res.code === 0 && res.data) {
        setShowAddModal(false);
        setFormEmail('');
        setFormHost('');
        setFormPort('993');
        setFormUsername('');
        setFormPassword('');
        setFormLabel('');
        await loadAccounts();
        setSelectedAccountId(res.data.id);
      } else {
        setError(res.msg || 'Failed to create email account');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDeleteAccount = async (accountId: string) => {
    if (!window.confirm('Are you sure you want to delete this email account?')) return;
    try {
      await api.emailAccountDelete(accountId);
      if (selectedAccountId === accountId) {
        setSelectedAccountId(null);
        setMessages([]);
        setSelectedMessage(null);
      }
      await loadAccounts();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleCopyCode = (code: string) => {
    void navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId);

  return (
    <div className="email-page" style={{ padding: '24px', display: 'flex', flexDirection: 'column', height: '100%', gap: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 600 }}>{t('email.title') || 'Email Manager'}</h1>
          <p style={{ margin: '4px 0 0', color: 'var(--text-secondary, #888)', fontSize: '14px' }}>
            {t('email.subtitle') || 'Read-only IMAP inbox and verification code extraction'}
          </p>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => setShowAddModal(true)}
          style={{
            padding: '8px 16px',
            backgroundColor: 'var(--accent, #3b82f6)',
            color: '#fff',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontWeight: 500,
          }}
        >
          + {t('email.addAccount') || 'Add Account'}
        </button>
      </div>

      {error && (
        <div style={{ padding: '12px 16px', backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid #ef4444', borderRadius: '6px', color: '#ef4444', fontSize: '14px' }}>
          {error}
        </div>
      )}

      {/* Main 3-column Layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '260px 340px 1fr', gap: '16px', flex: 1, minHeight: 0 }}>
        {/* Column 1: Accounts */}
        <div style={{ backgroundColor: 'var(--bg-secondary, #1e1e24)', borderRadius: '8px', border: '1px solid var(--border, #333)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border, #333)', fontWeight: 600, fontSize: '14px' }}>
            {t('email.accounts') || 'Accounts'} ({accounts.length})
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
            {loadingAccounts && accounts.length === 0 && (
              <div style={{ padding: '16px', color: '#888', textAlign: 'center' }}>{t('email.loading') || 'Loading...'}</div>
            )}
            {accounts.length === 0 && !loadingAccounts && (
              <div style={{ padding: '16px', color: '#888', textAlign: 'center', fontSize: '13px' }}>
                {t('email.noAccounts') || 'No accounts configured'}
              </div>
            )}
            {accounts.map((acc) => {
              const active = acc.id === selectedAccountId;
              return (
                <div
                  key={acc.id}
                  onClick={() => setSelectedAccountId(acc.id)}
                  style={{
                    padding: '10px 12px',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    backgroundColor: active ? 'var(--bg-active, rgba(59, 130, 246, 0.15))' : 'transparent',
                    border: active ? '1px solid var(--accent, #3b82f6)' : '1px solid transparent',
                    marginBottom: '6px',
                    position: 'relative',
                  }}
                >
                  <div style={{ fontWeight: 500, fontSize: '14px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {acc.label || acc.email}
                  </div>
                  <div style={{ fontSize: '12px', color: '#888', marginTop: '2px' }}>
                    {acc.email}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px' }}>
                    <span style={{ fontSize: '11px', color: '#666' }}>{acc.host}:{acc.port}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleDeleteAccount(acc.id);
                      }}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#ef4444',
                        cursor: 'pointer',
                        fontSize: '11px',
                        padding: '2px 4px',
                      }}
                    >
                      {t('email.delete') || 'Delete'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Column 2: Inbox Messages */}
        <div style={{ backgroundColor: 'var(--bg-secondary, #1e1e24)', borderRadius: '8px', border: '1px solid var(--border, #333)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border, #333)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 600, fontSize: '14px' }}>
              {t('email.inbox') || 'Inbox'} {isCached && <span style={{ fontSize: '11px', padding: '2px 6px', backgroundColor: '#eab308', color: '#000', borderRadius: '4px', marginLeft: '6px' }}>{t('email.cached') || 'Cached'}</span>}
            </span>
            {selectedAccountId && (
              <button
                onClick={() => void loadInbox(selectedAccountId)}
                disabled={loadingInbox}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--accent, #3b82f6)',
                  cursor: 'pointer',
                  fontSize: '13px',
                }}
              >
                {loadingInbox ? '...' : (t('email.refresh') || 'Refresh')}
              </button>
            )}
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
            {!selectedAccountId && (
              <div style={{ padding: '16px', color: '#888', textAlign: 'center', fontSize: '13px' }}>
                {t('email.selectAccountPrompt') || 'Select an account to view inbox'}
              </div>
            )}
            {selectedAccountId && loadingInbox && messages.length === 0 && (
              <div style={{ padding: '16px', color: '#888', textAlign: 'center' }}>{t('email.loadingInbox') || 'Loading inbox...'}</div>
            )}
            {selectedAccountId && messages.length === 0 && !loadingInbox && (
              <div style={{ padding: '16px', color: '#888', textAlign: 'center', fontSize: '13px' }}>
                {t('email.noMessages') || 'Inbox is empty'}
              </div>
            )}
            {messages.map((msg) => {
              const active = selectedMessage?.uid === msg.uid;
              return (
                <div
                  key={msg.uid}
                  onClick={() => selectedAccountId && void loadMessage(selectedAccountId, msg.uid)}
                  style={{
                    padding: '10px 12px',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    backgroundColor: active ? 'var(--bg-active, rgba(59, 130, 246, 0.15))' : 'transparent',
                    border: active ? '1px solid var(--accent, #3b82f6)' : '1px solid transparent',
                    marginBottom: '6px',
                  }}
                >
                  <div style={{ fontSize: '12px', color: '#999', marginBottom: '2px', display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontWeight: 500, color: 'var(--text-primary, #ddd)' }}>{msg.from}</span>
                    <span>{msg.date.slice(0, 16)}</span>
                  </div>
                  <div style={{ fontWeight: 500, fontSize: '13px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {msg.subject || '(No Subject)'}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Column 3: Message View & Extracted Codes */}
        <div style={{ backgroundColor: 'var(--bg-secondary, #1e1e24)', borderRadius: '8px', border: '1px solid var(--border, #333)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border, #333)', fontWeight: 600, fontSize: '14px' }}>
            {t('email.messageView') || 'Message & Extracted Codes'}
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {loadingMessage && (
              <div style={{ color: '#888', textAlign: 'center', marginTop: '24px' }}>{t('email.readingMessage') || 'Reading message...'}</div>
            )}

            {!selectedMessage && !loadingMessage && (
              <div style={{ color: '#888', textAlign: 'center', marginTop: '24px', fontSize: '13px' }}>
                {t('email.selectMessagePrompt') || 'Select a message to view its body and verification codes'}
              </div>
            )}

            {selectedMessage && !loadingMessage && (
              <>
                {/* Extracted Codes Section */}
                <div style={{ backgroundColor: 'var(--bg-panel, #25252d)', borderRadius: '6px', padding: '12px', border: '1px solid var(--border, #3a3a44)' }}>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: '#aaa', textTransform: 'uppercase', marginBottom: '8px', letterSpacing: '0.5px' }}>
                    {t('email.extractedCodes') || 'Extracted Verification Codes / Links'}
                  </div>
                  {extractedCodes.length === 0 ? (
                    <div style={{ fontSize: '13px', color: '#777' }}>{t('email.noCodesFound') || 'No codes or links detected in this message.'}</div>
                  ) : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                      {extractedCodes.map((code) => {
                        const isLink = code.startsWith('http://') || code.startsWith('https://');
                        const isCopied = copiedCode === code;
                        return (
                          <div
                            key={code}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '6px',
                              padding: '6px 12px',
                              borderRadius: '6px',
                              backgroundColor: 'rgba(59, 130, 246, 0.1)',
                              border: '1px solid var(--accent, #3b82f6)',
                              fontSize: '13px',
                            }}
                          >
                            {isLink ? (
                              <a
                                href={code}
                                target="_blank"
                                rel="noreferrer"
                                style={{ color: 'var(--accent, #3b82f6)', textDecoration: 'none', maxWidth: '320px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                              >
                                {code}
                              </a>
                            ) : (
                              <span style={{ fontWeight: 700, fontFamily: 'monospace', letterSpacing: '1px', fontSize: '15px', color: '#fff' }}>
                                {code}
                              </span>
                            )}
                            <button
                              onClick={() => handleCopyCode(code)}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: isCopied ? '#22c55e' : 'var(--accent, #3b82f6)',
                                cursor: 'pointer',
                                padding: '2px 4px',
                                fontSize: '12px',
                                fontWeight: 500,
                              }}
                            >
                              {isCopied ? (t('email.copied') || 'Copied!') : (t('email.copy') || 'Copy')}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Message Header */}
                <div style={{ borderBottom: '1px solid var(--border, #333)', paddingBottom: '12px' }}>
                  <h2 style={{ fontSize: '18px', margin: '0 0 8px', fontWeight: 600 }}>{selectedMessage.subject || '(No Subject)'}</h2>
                  <div style={{ fontSize: '13px', color: '#aaa', display: 'flex', gap: '16px' }}>
                    <div><strong>From:</strong> {selectedMessage.from}</div>
                    <div><strong>Date:</strong> {selectedMessage.date}</div>
                  </div>
                </div>

                {/* Message Body */}
                <div
                  style={{
                    fontSize: '14px',
                    lineHeight: '1.6',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    fontFamily: 'inherit',
                  }}
                >
                  {selectedMessage.body}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Add Account Modal */}
      {showAddModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--bg-secondary, #1e1e24)',
              borderRadius: '8px',
              border: '1px solid var(--border, #444)',
              width: '420px',
              padding: '24px',
              boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
            }}
          >
            <h2 style={{ margin: '0 0 16px', fontSize: '18px', fontWeight: 600 }}>{t('email.addAccount') || 'Add Email Account'}</h2>
            <form onSubmit={handleAddAccount} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: '#aaa', marginBottom: '4px' }}>{t('email.label') || 'Label (Optional)'}</label>
                <input
                  type="text"
                  value={formLabel}
                  onChange={(e) => setFormLabel(e.target.value)}
                  placeholder="My Gmail / Outlook"
                  style={{ width: '100%', padding: '8px 10px', borderRadius: '4px', border: '1px solid #444', backgroundColor: '#111', color: '#fff' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: '#aaa', marginBottom: '4px' }}>{t('email.email') || 'Email'}</label>
                <input
                  type="email"
                  required
                  value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                  placeholder="user@example.com"
                  style={{ width: '100%', padding: '8px 10px', borderRadius: '4px', border: '1px solid #444', backgroundColor: '#111', color: '#fff' }}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px', gap: '8px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', color: '#aaa', marginBottom: '4px' }}>{t('email.host') || 'IMAP Host'}</label>
                  <input
                    type="text"
                    required
                    value={formHost}
                    onChange={(e) => setFormHost(e.target.value)}
                    placeholder="imap.example.com"
                    style={{ width: '100%', padding: '8px 10px', borderRadius: '4px', border: '1px solid #444', backgroundColor: '#111', color: '#fff' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', color: '#aaa', marginBottom: '4px' }}>{t('email.port') || 'Port'}</label>
                  <input
                    type="number"
                    required
                    value={formPort}
                    onChange={(e) => setFormPort(e.target.value)}
                    placeholder="993"
                    style={{ width: '100%', padding: '8px 10px', borderRadius: '4px', border: '1px solid #444', backgroundColor: '#111', color: '#fff' }}
                  />
                </div>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: '#aaa', marginBottom: '4px' }}>{t('email.username') || 'Username'}</label>
                <input
                  type="text"
                  value={formUsername}
                  onChange={(e) => setFormUsername(e.target.value)}
                  placeholder="Leave empty to use Email"
                  style={{ width: '100%', padding: '8px 10px', borderRadius: '4px', border: '1px solid #444', backgroundColor: '#111', color: '#fff' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: '#aaa', marginBottom: '4px' }}>{t('email.password') || 'Password / App Password'}</label>
                <input
                  type="password"
                  value={formPassword}
                  onChange={(e) => setFormPassword(e.target.value)}
                  placeholder="••••••••"
                  style={{ width: '100%', padding: '8px 10px', borderRadius: '4px', border: '1px solid #444', backgroundColor: '#111', color: '#fff' }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '12px' }}>
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid #555', background: 'none', color: '#ccc', cursor: 'pointer' }}
                >
                  {t('email.cancel') || 'Cancel'}
                </button>
                <button
                  type="submit"
                  style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', backgroundColor: 'var(--accent, #3b82f6)', color: '#fff', cursor: 'pointer', fontWeight: 500 }}
                >
                  {t('email.save') || 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Email;
