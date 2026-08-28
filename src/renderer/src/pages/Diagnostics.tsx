import { useCallback, useEffect, useState } from 'react';
import { api, type ProfileListItem, type DiagnosticsReport } from '../api';
import { useI18n } from '../i18n';
import { ProxiesIcon, RefreshIcon } from '../icons';

interface CardSpec {
  key: string;
  title: string;
  status: 'ok' | 'warn' | null;
  lines: string[];
}

function statusColor(status: 'ok' | 'warn' | null): string {
  if (status === 'ok') return 'var(--ok, #22c55e)';
  if (status === 'warn') return '#eab308';
  return 'var(--text-muted)';
}

function buildCards(r: DiagnosticsReport): CardSpec[] {
  const ip = r.ip ?? '—';
  const geo = r.geo
    ? [r.geo.country, r.geo.city].filter(Boolean).join(', ') || '—'
    : '—';
  return [
    {
      key: 'ip',
      title: 'IP / Geo',
      status: r.ip ? 'ok' : null,
      lines: [ip, geo],
    },
    {
      key: 'tz',
      title: 'Timezone match',
      status: r.timezone_match,
      lines: [
        `Browser: ${r.timezone ?? '—'}`,
        `IP: ${r.ip_timezone ?? '—'}`,
      ],
    },
    {
      key: 'webrtc',
      title: 'WebRTC leak',
      status: r.webrtc,
      lines: [
        r.webrtc === 'warn'
          ? `Leaked: ${r.webrtc_addresses.join(', ')}`
          : r.webrtc === 'ok'
            ? 'No public address exposed'
            : 'Unknown (browser not reachable)',
      ],
    },
    {
      key: 'consistency',
      title: 'Consistency',
      status: r.consistency,
      lines: [r.consistency_detail ?? 'Unknown'],
    },
  ];
}

export function Diagnostics() {
  const { t } = useI18n();
  const [profiles, setProfiles] = useState<ProfileListItem[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [report, setReport] = useState<DiagnosticsReport | null>(null);
  const [notRunning, setNotRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadProfiles = useCallback(async () => {
    try {
      const res = await api.list({ page: 1, pageSize: 500 });
      if (res.code === 0) {
        setProfiles(res.data.list);
        setSelectedId((prev) => prev || res.data.list.find((p) => p.status === 'running')?.user_id || '');
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    void loadProfiles();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void loadProfiles();
    }, 5000);
    return () => clearInterval(timer);
  }, [loadProfiles]);

  const run = async () => {
    if (!selectedId) return;
    setBusy(true);
    setError('');
    setReport(null);
    setNotRunning(false);
    try {
      const res = await api.diagnosticsRun(selectedId);
      const code = res.code as unknown;
      if (code === 0) {
        setReport(res.data);
      } else if (String(code) === 'NOT_RUNNING') {
        setNotRunning(true);
      } else {
        setError(res.msg);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const running = profiles.filter((p) => p.status === 'running');

  return (
    <div>
      <div className="page-header-actions" style={{ marginBottom: 14 }}>
        <div className="header-filters">
          <select
            className="select-input"
            style={{ minWidth: 260 }}
            value={selectedId}
            onChange={(e) => { setSelectedId(e.target.value); setReport(null); setNotRunning(false); }}
          >
            <option value="">{t('Select a profile')}</option>
            {running.map((p) => (
              <option key={p.user_id} value={p.user_id}>
                {p.name || p.user_id} ({t('Running')})
              </option>
            ))}
          </select>
        </div>
        <div className="header-btn-group">
          <button className="btn primary" onClick={() => void run()} disabled={busy || !selectedId}>
            <RefreshIcon size={14} />
            <span>{busy ? t('Checking...') : t('Run check')}</span>
          </button>
        </div>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      {notRunning ? (
        <div className="endpoint-banner" style={{ borderColor: '#eab308' }}>
          <span style={{ color: '#eab308', fontSize: 13 }}>
            {t('Profile is not running — start it first to run diagnostics.')}
          </span>
        </div>
      ) : null}

      {!report && !notRunning && !busy ? (
        <div className="table-container" style={{ padding: '40px 16px', textAlign: 'center' }}>
          <ProxiesIcon size={32} style={{ opacity: 0.3 }} />
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)', marginTop: 8 }}>
            {t('Run diagnostics for a running profile to verify IP, timezone, WebRTC and consistency.')}
          </div>
        </div>
      ) : null}

      {report ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
          {buildCards(report).map((c) => (
            <div
              key={c.key}
              className="card"
              style={{
                border: `1px solid ${statusColor(c.status)}55`,
                borderRadius: 10,
                padding: '14px 16px',
                background: 'var(--panel)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <span
                  style={{
                    width: 9, height: 9, borderRadius: '50%',
                    background: statusColor(c.status),
                    display: 'inline-block',
                  }}
                />
                <strong style={{ fontSize: 13.5 }}>{t(c.title)}</strong>
                {c.status ? (
                  <span style={{ fontSize: 11, color: statusColor(c.status), marginLeft: 'auto', fontWeight: 700 }}>
                    {c.status === 'ok' ? t('OK') : t('Warning')}
                  </span>
                ) : null}
              </div>
              {c.lines.map((line, i) => (
                <div key={i} style={{ fontSize: 12.5, color: 'var(--text-secondary)', fontFamily: i === 0 && c.key === 'ip' ? 'var(--font-mono)' : undefined }}>
                  {line}
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}