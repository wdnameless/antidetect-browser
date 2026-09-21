import { useCallback, useEffect, useState } from 'react';
import { api, type ProfileListItem, type DiagnosticsReport } from '../api';
import { checksOf, type PreflightVerdict } from '../preflight';
import { useI18n } from '../i18n';
import { ProxiesIcon, RefreshIcon } from '../icons';

interface CardSpec {
  key: string;
  title: string;
  status: 'ok' | 'warn' | null;
  lines: string[];
}

function statusColor(status: 'ok' | 'warn' | null): string {
  if (status === 'ok') return 'var(--ok)';
  if (status === 'warn') return 'var(--warn)';
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

/**
 * Coherence score 0-100 from the last preflight verdict: share of checks that
 * did not fail, with warns penalized at 40%.
 */
function coherenceScore(verdict: PreflightVerdict): number {
  // An array view is required: `verdict.checks` is an object keyed by check name. Reading it as an
  // array here was the same defect that blanked the preflight modal.
  const checks = checksOf(verdict);
  if (checks.length === 0) return 100;
  const failed = checks.filter((c) => c.status === 'fail').length;
  const warned = checks.filter((c) => c.status === 'warn').length;
  const score = 100 - (failed / checks.length) * 100 - (warned / checks.length) * 40;
  return Math.max(0, Math.round(score));
}

/** Extracts human-readable coherence issues from the coherence check message. */
function coherenceIssues(verdict: PreflightVerdict): string[] {
  const check = checksOf(verdict).find((c) => c.name === 'coherence');
  // The backend's human-readable text is `detail`; `message` does not exist on the wire.
  const message = check?.detail;
  if (!message) return [];
  const match = message.match(/Coherence issues \(\d+\): (.*)$/s);
  if (match && match[1]) {
    return match[1].split('; ').filter(Boolean);
  }
  return [];
}

export function Diagnostics() {
  const { t } = useI18n();
  const [profiles, setProfiles] = useState<ProfileListItem[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [report, setReport] = useState<DiagnosticsReport | null>(null);
  const [preflight, setPreflight] = useState<PreflightVerdict | null>(null);
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
      const pf = await api.preflightLast(selectedId).catch(() => null);
      setPreflight(pf && pf.code === 0 ? pf.data : null);
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
        <div className="endpoint-banner" style={{ borderColor: 'var(--warn)' }}>
          <span style={{ color: 'var(--warn)', fontSize: 13 }}>
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

      {preflight ? (
        <div className="card" style={{ marginBottom: 14, padding: '14px 16px', background: 'var(--panel)', borderRadius: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span
              style={{
                width: 9, height: 9, borderRadius: '50%',
                background: preflight.overall === 'pass' ? statusColor('ok') : preflight.overall === 'warn' ? statusColor('warn') : 'var(--danger)',
                display: 'inline-block',
              }}
            />
            <strong style={{ fontSize: 13.5 }}>{t('Fingerprint Coherence')}</strong>
            <span style={{ fontSize: 11, marginLeft: 'auto', color: 'var(--text-secondary)' }}>
              {t('Score')}: {coherenceScore(preflight)}
            </span>
          </div>
          {coherenceIssues(preflight).length > 0 ? (
            coherenceIssues(preflight).map((issue, i) => (
              <div key={i} style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
                {issue}
              </div>
            ))
          ) : (
            <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
              {t('All fingerprint subsystems are coherent with the claimed hardware identity.')}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}