import { useCallback, useEffect, useState } from 'react';
import { api, type ProxyItem } from '../api';
import { ProxiesIcon, PlusIcon, TrashIcon, RefreshIcon, CheckIcon } from '../icons';
import { useI18n } from '../i18n';

export function Proxies() {
  const { t } = useI18n();
  const [proxies, setProxies] = useState<ProxyItem[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [type, setType] = useState('http');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('');
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [checkResult, setCheckResult] = useState<Record<string, { ok: boolean; ip?: string; latencyMs?: number; error?: string }>>({});

  const load = useCallback(async () => {
    try {
      const res = await api.proxyList();
      if (res.code === 0) setProxies(res.data.list);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    setBusy(true);
    setError('');
    try {
      const body: Record<string, unknown> = {
        type,
        host: host.trim(),
        port: Number(port) || 0,
      };
      if (user.trim()) body.username = user.trim();
      if (pass.trim()) body.password = pass.trim();
      if (type === 'ssh' && privateKey.trim()) body.privateKey = privateKey.trim();

      const res = await api.proxyCreate(body);
      if (res.code === 0) {
        setShowModal(false);
        setHost('');
        setPort('');
        setUser('');
        setPass('');
        setPrivateKey('');
        await load();
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
    if (!confirm('Are you sure you want to delete this proxy?')) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.proxyDelete(id);
      if (res.code === 0) await load();
      else setError(res.msg);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const check = async (id: string) => {
    setBusy(true);
    setError('');
    try {
      const res = await api.proxyCheck(id);
      if (res.code === 0) {
        setCheckResult((prev) => ({ ...prev, [id]: res.data }));
        await load();
      } else {
        setError(res.msg);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // ---- Bulk list import (v0.2.26) ----
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [importProto, setImportProto] = useState<'http' | 'https' | 'socks5'>('socks5');
  const [importBusy, setImportBusy] = useState(false);
  const [importSummary, setImportSummary] = useState<string>('');

  const previewCount = importText
    ? importText
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#')).length
    : 0;

  const runImport = async (): Promise<void> => {
    if (!importText.trim()) return;
    setImportBusy(true);
    setError('');
    setImportSummary('');
    try {
      const res = await api.proxyImportList(importText, importProto);
      if (res.code === 0) {
        setImportSummary(
          t('Imported') + `: ${res.data.created}, ` + t('duplicates') + `: ${res.data.duplicates}, ` + t('invalid lines') + `: ${res.data.invalid}`
        );
        setImportText('');
        await load();
        // Auto-detect geo: check each new proxy (sequential, gentle on ip-api).
        if (importProto && res.data.proxy_ids.length > 0) {
          const ids: string[] = res.data.proxy_ids;
          setImportSummary((s) => s + ` — ${t('checking geo…')} (0/${ids.length})`);
          for (let i = 0; i < ids.length; i++) {
            try {
              await api.proxyCheck(ids[i]);
            } catch {
              // keep going — one failed check must not stop the batch
            }
            if (i % 5 === 0 || i === ids.length - 1) {
              setImportSummary((s) => s.replace(/\(0\/\d+\)$|\(\d+\/\d+\)$/, `(${i + 1}/${ids.length})`));
              await load();
            }
          }
          setImportSummary((s) => s.replace(/— .*$/, '') + ` — ${t('geo detected')}`);
          await load();
        }
        setTimeout(() => {
          setShowImport(false);
          setImportSummary('');
        }, 1500);
      } else {
        setError(res.msg);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setImportBusy(false);
    }
  };

  return (
    <div>
      <div className="page-header-actions">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <ProxiesIcon size={20} style={{ color: 'var(--text-secondary)' }} />
          <h2 style={{ fontSize: 16, fontWeight: 700 }}>{t('Proxy Manager')}</h2>
          <span className="hint" style={{ margin: 0 }}>({t('proxies configured')}: {proxies.length})</span>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={() => setShowImport(true)}>
            {t('Import List')}
          </button>
          <button className="btn primary" onClick={() => setShowModal(true)}>
            <PlusIcon size={15} />
            <span>{t('Add Proxy')}</span>
          </button>
        </div>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      {/* Import List Modal */}
      {showImport ? (
        <div className="modal-overlay" onClick={() => !importBusy && setShowImport(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{t('Import Proxy List')}</h3>
              <button className="btn-icon" onClick={() => setShowImport(false)}>✕</button>
            </div>
            <div className="modal-body">
              <p className="hint" style={{ margin: 0 }}>
                {t('One proxy per line. Supported formats:')} <code>ip:port</code>, <code>ip:port:user:pass</code>, <code>user:pass@ip:port</code>, <code>socks5://user:pass@ip:port</code>.
              </p>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '10px 0' }}>
                <label style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{t('Protocol for lines without prefix')}:</label>
                <select
                  className="select-input"
                  style={{ width: 140 }}
                  value={importProto}
                  onChange={(e) => setImportProto(e.target.value as 'http' | 'https' | 'socks5')}
                >
                  <option value="socks5">SOCKS5</option>
                  <option value="http">HTTP</option>
                  <option value="https">HTTPS</option>
                </select>
                <label style={{ fontSize: 12.5, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input
                    type="file"
                    accept=".txt,.csv,text/plain"
                    style={{ display: 'none' }}
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (f) setImportText(await f.text());
                      e.target.value = '';
                    }}
                  />
                  <span className="btn btn-sm" onClick={(e) => (e.currentTarget.previousElementSibling as HTMLInputElement)?.click()}>
                    {t('Upload .txt file')}
                  </span>
                </label>
              </div>
              <textarea
                placeholder={'145.223.59.161:6195:zpmigfas:xcn562htzyka\n195.40.122.162:6846:zpmigfas:xcn562htzyka\nsocks5://user:pass@1.2.3.4:1080'}
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                rows={10}
                style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: 12 }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
                  {t('Lines detected')}: <strong>{previewCount}</strong> — {t('geo will be detected automatically after import')}
                </span>
                {importSummary ? <span style={{ fontSize: 12.5, color: 'var(--text)' }}>{importSummary}</span> : null}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowImport(false)} disabled={importBusy}>
                {t('Cancel')}
              </button>
              <button className="btn primary" onClick={() => void runImport()} disabled={importBusy || !importText.trim()}>
                {importBusy ? t('Importing…') : `${t('Import')} ${previewCount > 0 ? `(${previewCount})` : ''}`}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Add Proxy Modal */}
      {showModal ? (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Add Proxy Server</h3>
              <button className="btn-icon" onClick={() => setShowModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Protocol</label>
                <select value={type} onChange={(e) => setType(e.target.value)}>
                  <option value="http">HTTP</option>
                  <option value="https">HTTPS</option>
                  <option value="socks5">SOCKS5</option>
                  <option value="ssh">SSH Tunnel</option>
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label>Host / IP</label>
                  <input placeholder="192.168.1.1 or proxy.example.com" value={host} onChange={(e) => setHost(e.target.value)} autoFocus />
                </div>
                <div className="form-group">
                  <label>Port</label>
                  <input placeholder="8080" value={port} onChange={(e) => setPort(e.target.value)} />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label>Username (optional)</label>
                  <input placeholder="Username" value={user} onChange={(e) => setUser(e.target.value)} />
                </div>
                <div className="form-group">
                  <label>Password (optional)</label>
                  <input type="password" placeholder="Password" value={pass} onChange={(e) => setPass(e.target.value)} />
                </div>
              </div>

              {type === 'ssh' ? (
                <div className="form-group">
                  <label>SSH Private Key (OpenSSH PEM format)</label>
                  <textarea
                    rows={4}
                    placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;..."
                    value={privateKey}
                    onChange={(e) => setPrivateKey(e.target.value)}
                    style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
                  />
                </div>
              ) : null}
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn primary" onClick={() => void create()} disabled={busy || !host.trim() || !port.trim()}>
                Save Proxy
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: '12%' }}>{t('Type')}</th>
              <th style={{ width: '30%' }}>{t('Host : Port')}</th>
              <th style={{ width: '22%' }}>{t('Username')}</th>
              <th style={{ width: '20%' }}>{t('Location / IP')}</th>
              <th style={{ width: '16%', textAlign: 'right' }}>{t('Actions')}</th>
            </tr>
          </thead>
          <tbody>
            {proxies.length === 0 ? (
              <tr>
                <td colSpan={5} className="empty-cell">
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '24px 0' }}>
                    <ProxiesIcon size={32} style={{ opacity: 0.3 }} />
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)' }}>
                      {t('No proxies configured yet')}
                    </div>
                    <p style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 440, margin: 0 }}>
                      {t('Proxies give each profile its own IP address — essential for running many accounts safely.')}
                      Click <strong>+ Add Proxy</strong> to configure one.
                    </p>
                  </div>
                </td>
              </tr>
            ) : (
              proxies.map((p) => {
                const res = checkResult[p.proxy_id];
                return (
                  <tr key={p.proxy_id}>
                    <td>
                      <span className="proxy-type-badge">{p.type.toUpperCase()}</span>
                    </td>
                    <td>
                      <code style={{ fontSize: 13, color: 'var(--text)' }}>{p.host}:{p.port}</code>
                    </td>
                    <td>
                      <span style={{ color: p.username ? 'var(--text-secondary)' : 'var(--text-muted)', fontSize: 13 }}>
                        {p.username || '—'}
                      </span>
                    </td>
                    <td>
                      {res ? (
                        <span style={{ fontSize: 12, color: res.ok ? 'var(--ok)' : 'var(--danger)' }}>
                          {res.ok ? `✓ ${res.ip} (${res.latencyMs}ms)` : `✕ ${res.error || 'Failed'}`}
                        </span>
                      ) : p.country ? (
                        <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
                          {p.country} ({p.timezone || 'UTC'})
                        </span>
                      ) : (
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('Not tested')}</span>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                        <button
                          className="btn-icon"
                          onClick={() => void check(p.proxy_id)}
                          disabled={busy}
                          title={t('Test Connection')}
                        >
                          <RefreshIcon size={14} />
                        </button>
                        <button
                          className="btn-icon"
                          style={{ color: 'var(--danger)' }}
                          onClick={() => void remove(p.proxy_id)}
                          disabled={busy}
                          title={t('Delete Proxy')}
                        >
                          <TrashIcon size={14} />
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

      {/* Proxy Type Guide */}
      <div
        className="panel"
        style={{
          marginTop: 20,
          padding: '14px 16px',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 16,
        }}
      >
        <div>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>HTTP / HTTPS</div>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 0' }}>
            {t('Best for most tasks (browsing, social networks). Easy to set up, widely supported.')}
          </p>
        </div>
        <div>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>SOCKS5</div>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 0' }}>
            {t('Handles all traffic types (TCP/UDP). Recommended for banking, crypto and heavy anti-detection.')}
          </p>
        </div>
        <div>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>SSH Tunnel</div>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 0' }}>
            {t('Routes traffic through a Linux server you own — free and stable if you have one.')}
          </p>
        </div>
      </div>
    </div>
  );
}
