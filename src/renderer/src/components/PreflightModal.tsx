import React, { useEffect, useMemo, useState } from 'react';
import { api, type ProfileDetails } from '../api';
import {
  PreflightStatus,
  PreflightVerdict,
  checksOf,
  getRemediation,
  computePreflightFixPlan,
  applyPreflightFixes,
  type PreflightFixOutcome,
} from '../preflight';
import { Modal } from './Modal';
import { RefreshIcon, ShieldCheckIcon } from '../icons';
import { useI18n } from '../i18n';

export interface PreflightBadgeProps {
  status?: PreflightStatus | 'loading' | 'error' | null;
  verdict?: PreflightVerdict | null;
  durationMs?: number;
  onClick?: () => void;
  onRun?: () => void;
  title?: string;
}

export function PreflightBadge({ status, verdict, onClick, onRun, title }: PreflightBadgeProps) {
  if (!status) {
    return (
      <button
        type="button"
        className="preflight-badge-btn idle"
        onClick={onRun || onClick}
        title={title || 'No preflight run yet. Click to check.'}
      >
        <ShieldCheckIcon size={12} />
        <span className="preflight-label">Check</span>
      </button>
    );
  }

  const isClickable = Boolean(onClick || onRun);

  let label = 'PASS';
  let className = 'preflight-badge pass';
  let icon = '✓';

  if (status === 'loading') {
    label = 'CHECKING...';
    className = 'preflight-badge loading';
    icon = '◌';
  } else if (status === 'warn') {
    label = 'WARN';
    className = 'preflight-badge warn';
    icon = '⚠';
  } else if (status === 'fail') {
    label = 'FAIL';
    className = 'preflight-badge fail';
    icon = '✕';
  } else if (status === 'error') {
    label = 'ERR';
    className = 'preflight-badge error';
    icon = '!';
  }

  // Use `checksOf(verdict)` to ensure issues are counted even when checkList is absent or empty.
  const issuesCount = verdict
    ? checksOf(verdict).filter((c) => c.status === 'fail' || c.status === 'warn').length
    : 0;

  return (
    <button
      type="button"
      className={className}
      onClick={onClick || onRun}
      disabled={!isClickable || status === 'loading'}
      title={title || (verdict ? `Preflight: ${verdict.overall.toUpperCase()} (${issuesCount} issues)` : `Preflight status: ${label}`)}
      style={{
        cursor: isClickable && status !== 'loading' ? 'pointer' : 'default',
      }}
    >
      <span className="preflight-icon" aria-hidden="true">{icon}</span>
      <span className="preflight-label">{label}</span>
      {issuesCount > 0 && status !== 'loading' && (
        <span className="preflight-badge-count">{issuesCount}</span>
      )}
    </button>
  );
}

export interface PreflightModalProps {
  isOpen: boolean;
  onClose: () => void;
  profileId: string;
  profileName?: string;
  verdict: PreflightVerdict | null;
  loading: boolean;
  error?: string | null;
  onRecheck?: (profileId: string) => Promise<void> | void;
  onStartProfile?: (profileId: string) => Promise<void> | void;
}

export function PreflightModal({
  isOpen,
  onClose,
  profileId,
  profileName,
  verdict,
  loading,
  error,
  onRecheck,
  onStartProfile,
}: PreflightModalProps) {
  const [expandedCheck, setExpandedCheck] = useState<string | null>(null);
  const [profileDetails, setProfileDetails] = useState<ProfileDetails | null>(null);
  const [isFixing, setIsFixing] = useState(false);
  const [fixOutcomes, setFixOutcomes] = useState<PreflightFixOutcome[] | null>(null);

  const { t: translate, lang } = useI18n();
  const t = (key: string, ru?: string) => (lang === 'ru' && ru ? ru : translate(key));

  useEffect(() => {
    setFixOutcomes(null);
  }, [profileId]);

  useEffect(() => {
    if (!isOpen || !profileId) return;
    let active = true;
    api.profileDetail(profileId)
      .then((res) => {
        if (active && res.code === 0 && res.data) {
          setProfileDetails(res.data);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [isOpen, profileId]);

  const plan = useMemo(
    () => computePreflightFixPlan(verdict, profileDetails),
    [verdict, profileDetails]
  );

  const handleApplyFixes = async () => {
    if (plan.fixableCount === 0 || isFixing) return;
    setIsFixing(true);
    try {
      const outcomes = await applyPreflightFixes(profileId, plan);
      setFixOutcomes(outcomes);
      // Refresh profile details in background
      api.profileDetail(profileId)
        .then((res) => {
          if (res.code === 0 && res.data) setProfileDetails(res.data);
        })
        .catch(() => {});
      // Automatically re-run preflight and update verdict
      if (onRecheck) {
        await onRecheck(profileId);
      }
    } finally {
      setIsFixing(false);
    }
  };

  if (!isOpen) return null;

  // The array view of the checks. `checks` on the wire is an object keyed by check name, so any
  // `.map`/`.filter`/`.length` over it throws; `checkList` is the array the backend also sends.
  const checks = verdict ? checksOf(verdict) : [];

  return (
    <Modal
      onClose={onClose}
      title={`${t('Preflight Inspection', 'Диагностика перед запуском')}: ${profileName || profileId}`}
      width={680}
    >
      <div className="preflight-modal-content">
        <div className="preflight-header-row">
          <div className="preflight-summary-status">
            <span className="preflight-muted-label">{t('Overall Result:', 'Общий результат:')}</span>
            {loading ? (
              <PreflightBadge status="loading" />
            ) : error ? (
              <span className="preflight-error-tag">{t('Error', 'Ошибка')}</span>
            ) : verdict ? (
              <PreflightBadge status={verdict.overall} verdict={verdict} />
            ) : (
              <span className="preflight-muted-text">{t('Pending', 'Ожидание')}</span>
            )}
          </div>
          {verdict && !loading && (
            <div className="preflight-meta">
              <span>{t('Checked:', 'Проверено:')} <strong>{new Date(verdict.timestamp).toLocaleTimeString()}</strong></span>
            </div>
          )}
        </div>

        {error && (
          <div className="preflight-alert error">
            <span className="preflight-alert-icon">!</span>
            <div className="preflight-alert-msg">{error}</div>
          </div>
        )}

        {loading && (
          <div className="preflight-loading-box">
            <div className="preflight-spinner" />
            <p>{t('Running preflight diagnostics (proxy latency, geolocation, timezone, TLS handshake, fingerprint coherence)...', 'Выполняется диагностика (задержка прокси, геолокация, часовой пояс, рукопожатие TLS, согласованность отпечатка)...')}</p>
          </div>
        )}

        {/* Fix execution outcomes banner */}
        {fixOutcomes && fixOutcomes.length > 0 && !loading && (
          <div
            style={{
              background: 'var(--surface-2)',
              borderRadius: 'var(--radius-md)',
              padding: '12px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              borderLeft: '3px solid var(--accent)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
                {t('Fix Execution Results', 'Результаты применения исправлений')}
              </span>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setFixOutcomes(null)}
                style={{ fontSize: 10, padding: '2px 6px', height: 'auto' }}
              >
                {t('Dismiss', 'Скрыть')}
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {fixOutcomes.map((out, idx) => (
                <div
                  key={idx}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 8,
                    fontSize: 12,
                    padding: '5px 8px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--control-bg)',
                  }}
                >
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      padding: '1px 5px',
                      borderRadius: 'var(--radius-sm)',
                      textTransform: 'uppercase',
                      background:
                        out.status === 'applied'
                          ? 'var(--ok-bg)'
                          : out.status === 'failed'
                            ? 'var(--danger-bg)'
                            : 'var(--control-bg-hover)',
                      color:
                        out.status === 'applied'
                          ? 'var(--ok)'
                          : out.status === 'failed'
                            ? 'var(--danger)'
                            : 'var(--text-muted)',
                    }}
                  >
                    {out.status === 'applied'
                      ? t('Applied', 'Применено')
                      : out.status === 'failed'
                        ? t('Failed', 'Ошибка')
                        : t('Manual', 'Вручную')}
                  </span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
                    <span style={{ fontWeight: 600, color: 'var(--text)' }}>
                      {lang === 'ru' && out.labelRu ? out.labelRu : out.label}
                    </span>
                    <span style={{ color: 'var(--text-secondary)', fontSize: 11.5 }}>
                      {lang === 'ru' && out.detailRu ? out.detailRu : out.detail}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Planned fixes concise inline block */}
        {verdict && !loading && plan.items.length > 0 && (
          <div
            style={{
              background: 'var(--surface-2)',
              borderRadius: 'var(--radius-md)',
              padding: '12px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              borderLeft: plan.fixableCount > 0 ? '3px solid var(--accent)' : '3px solid var(--border)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
                  {t('Remediation & Fix Plan', 'План исправления проблем')}
                </span>
                {plan.fixableCount > 0 && (
                  <span
                    style={{
                      fontSize: 10.5,
                      fontWeight: 700,
                      padding: '1px 6px',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--control-bg-active)',
                      color: 'var(--text)',
                    }}
                  >
                    {plan.fixableCount} {t('fixable', 'исправимо')}
                  </span>
                )}
              </div>
              {plan.fixableCount > 0 && (
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {t('One-click auto-apply and re-check', 'Применение и перепроверка в один клик')}
                </span>
              )}
            </div>

            {/* Fixable items */}
            {plan.fixableCount > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {plan.items
                  .filter((item) => Boolean(item.autoFix))
                  .map((item) => (
                    <div
                      key={item.checkName}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        fontSize: 12,
                        padding: '4px 8px',
                        borderRadius: 'var(--radius-sm)',
                        background: 'var(--control-bg)',
                      }}
                    >
                      <span style={{ color: 'var(--ok)', fontWeight: 700, fontSize: 11 }}>⚡</span>
                      <span style={{ fontWeight: 600, color: 'var(--text)' }}>
                        {lang === 'ru' && item.autoFix!.labelRu ? item.autoFix!.labelRu : item.autoFix!.label}:
                      </span>
                      <span style={{ color: 'var(--text-secondary)' }}>→</span>
                      <code
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 11,
                          padding: '1px 5px',
                          borderRadius: 'var(--radius-sm)',
                          background: 'var(--control-bg-hover)',
                          color: 'var(--text)',
                        }}
                      >
                        {item.autoFix!.displayValue}
                      </code>
                    </div>
                  ))}
              </div>
            )}

            {/* Unfixable items with clear, honest explanation */}
            {plan.unfixableCount > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: plan.fixableCount > 0 ? 4 : 0 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>
                  {t(
                    'No automatic fix available (manual attention required):',
                    'Авто-исправление недоступно (требуются ручные действия):'
                  )}
                </span>
                {plan.items
                  .filter((item) => !item.autoFix)
                  .map((item) => (
                    <div
                      key={item.checkName}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 8,
                        fontSize: 11.5,
                        padding: '4px 8px',
                        borderRadius: 'var(--radius-sm)',
                        background: 'var(--control-bg)',
                      }}
                    >
                      <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>ℹ</span>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1 }}>
                        <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>
                          {item.checkName}
                        </span>
                        <span style={{ color: 'var(--text-muted)' }}>
                          {lang === 'ru' && item.manualReasonRu ? item.manualReasonRu : item.manualReason}
                        </span>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}

        {verdict && !loading && (
          <div className="preflight-checks-list">
            <h4 className="preflight-section-title">
              {t('Diagnostic Checks', 'Диагностические проверки')} ({checks.length})
            </h4>
            <div className="preflight-checks-table">
              {checks.map((check) => {
                const remediation = check.reasonCode ? getRemediation(check.reasonCode) : null;
                const isExpanded = expandedCheck === check.name;
                const hasDetails = Boolean(remediation || check.detail);

                return (
                  <div
                    key={check.name}
                    className={`preflight-check-item ${check.status} ${isExpanded ? 'expanded' : ''}`}
                  >
                    <div
                      className="preflight-check-main"
                      onClick={() => hasDetails && setExpandedCheck(isExpanded ? null : check.name)}
                      style={{ cursor: hasDetails ? 'pointer' : 'default' }}
                    >
                      <div className="preflight-check-left">
                        <span className={`preflight-status-dot ${check.status}`} />
                        <div className="preflight-check-info">
                          <span className="preflight-check-name">{check.name}</span>
                          {check.detail && (
                            <span className="preflight-check-summary">{check.detail}</span>
                          )}
                        </div>
                      </div>

                      <div className="preflight-check-right">
                        {typeof check.durationMs === 'number' && (
                          <span className="preflight-check-latency">{check.durationMs}ms</span>
                        )}
                        <span className={`preflight-tag ${check.status}`}>
                          {check.status.toUpperCase()}
                        </span>
                        {hasDetails && (
                          <span className="preflight-chevron">{isExpanded ? '▲' : '▼'}</span>
                        )}
                      </div>
                    </div>

                    {isExpanded && hasDetails && (
                      <div className="preflight-check-details">
                        {check.reasonCode && (
                          <div className="preflight-detail-row">
                            <span className="preflight-detail-label">Reason Code:</span>
                            <code className="preflight-code">{check.reasonCode}</code>
                          </div>
                        )}

                        {remediation && (
                          <div className="preflight-remediation-box">
                            <div className="preflight-remediation-title">
                              <span>💡 Suggested Remediation:</span>
                            </div>
                            <div className="preflight-remediation-desc">{remediation.summary}</div>
                            {remediation.hint && (
                              <div className="preflight-settings-hint">
                                Hint: {remediation.hint}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="preflight-footer-actions">
          <button
            type="button"
            className="btn"
            onClick={onClose}
          >
            {t('Close', 'Закрыть')}
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            {plan.fixableCount > 0 && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void handleApplyFixes()}
                disabled={loading || isFixing}
                title={t(
                  'Apply all fixable settings and re-run preflight checks',
                  'Применить все исправимые настройки и перепроверить'
                )}
              >
                <ShieldCheckIcon size={13} />
                <span>
                  {isFixing
                    ? t('Fixing...', 'Исправление...')
                    : `${t('Fix', 'Исправить')} (${plan.fixableCount})`}
                </span>
              </button>
            )}
            {onRecheck && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => void onRecheck(profileId)}
                disabled={loading || isFixing}
              >
                <RefreshIcon size={13} />
                <span>{t('Re-run Checks', 'Перепроверить')}</span>
              </button>
            )}
            {onStartProfile && (
              <button
                type="button"
                className={`btn ${verdict?.overall === 'fail' ? 'btn-danger' : plan.fixableCount > 0 ? 'btn-secondary' : 'btn-primary'}`}
                onClick={() => {
                  onClose();
                  void onStartProfile(profileId);
                }}
                disabled={loading || isFixing}
              >
                {verdict?.overall === 'fail'
                  ? t('Launch Anyway', 'Запустить всё равно')
                  : t('Launch Profile', 'Запустить профиль')}
              </button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
