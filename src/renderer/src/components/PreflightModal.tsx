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
  isBlockedLaunch?: boolean;
  onRecheck?: (profileId: string) => Promise<void> | void;
  onStartProfile?: (profileId: string) => Promise<void> | void;
  onStartWithoutProxy?: (profileId: string) => Promise<void> | void;
}

export function PreflightModal({
  isOpen,
  onClose,
  profileId,
  profileName,
  verdict,
  loading,
  error,
  isBlockedLaunch,
  onRecheck,
  onStartProfile,
  onStartWithoutProxy,
}: PreflightModalProps) {
  const [expandedCheck, setExpandedCheck] = useState<string | null>(null);
  const [profileDetails, setProfileDetails] = useState<ProfileDetails | null>(null);
  const [isFixing, setIsFixing] = useState(false);
  const [fixOutcomes, setFixOutcomes] = useState<PreflightFixOutcome[] | null>(null);

  const { t: translate, lang } = useI18n();
  const t = (key: string, ru?: string) => (lang === 'ru' && ru ? ru : translate(key));

  const renderBlockingBadge = (isBlocking: boolean) => (
    <span
      className={`preflight-tag ${isBlocking ? 'fail' : 'warn'}`}
      style={{ fontSize: 9.5, padding: '1px 5px' }}
    >
      {isBlocking ? t('BLOCKING', 'БЛОКИРУЕТ') : t('WARNING', 'ПРЕДУПРЕЖДЕНИЕ')}
    </span>
  );
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

        {/* Blocked launch explicit explanation & options (Requirement C) */}
        {(isBlockedLaunch || verdict?.overall === 'fail') && !loading && checks.some((c) => c.status === 'fail') && (
          <div
            style={{
              background: 'var(--surface-2)',
              border: '1px solid var(--danger)',
              borderLeft: '4px solid var(--danger)',
              borderRadius: 'var(--radius-md)',
              padding: '12px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 16 }}>🛡️</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--danger)' }}>
                  {t('Launch Blocked by Preflight Guard', 'Запуск заблокирован защитой Preflight Guard')}
                </span>
              </div>
              <span className="preflight-tag fail" style={{ fontSize: 10, padding: '1px 6px' }}>
                {t('BLOCKING', 'БЛОКИРУЕТ')}
              </span>
            </div>

            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              {t(
                'The preflight launch guard stopped this profile because one or more diagnostic checks failed:',
                'Защита перед запуском остановила профиль из-за провала диагностических проверок:'
              )}
            </div>

            {/* List of blocking checks */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {checks
                .filter((c) => c.status === 'fail')
                .map((c) => (
                  <div
                    key={c.name}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 2,
                      padding: '6px 10px',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--control-bg)',
                      borderLeft: '2px solid var(--danger)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontWeight: 600, fontSize: 12, color: 'var(--text)' }}>{c.name}</span>
                      {c.reasonCode && <code className="preflight-code" style={{ fontSize: 11 }}>{c.reasonCode}</code>}
                    </div>
                    {c.detail && (
                      <span style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>{c.detail}</span>
                    )}
                  </div>
                ))}
            </div>

            {/* Warning that real IP will be used */}
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                padding: '8px 10px',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--warn-bg)',
                color: 'var(--warn)',
                fontSize: 11.5,
              }}
            >
              <span>⚠️</span>
              <span>
                {t(
                  'Warning: Launching without proxy will route traffic through your real IP address. This exposes your identity and defeats the purpose of an antidetect browser.',
                  'Внимание: запуск без прокси направит трафик через ваш реальный IP-адрес. Это раскрывает вашу личность в сети и противоречит цели использования антидетект-браузера.'
                )}
              </span>
            </div>

            {/* Options */}
            <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
              {onRecheck && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => void onRecheck(profileId)}
                  disabled={loading || isFixing}
                >
                  <RefreshIcon size={12} />
                  <span>{t('Re-run Checks', 'Проверить снова')}</span>
                </button>
              )}
              {(onStartWithoutProxy || onStartProfile) && (
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  onClick={() => {
                    onClose();
                    void (onStartWithoutProxy ? onStartWithoutProxy(profileId) : onStartProfile!(profileId));
                  }}
                  disabled={loading || isFixing}
                  title={t(
                    'Bypass preflight guard and launch directly using real IP',
                    'Обойти защиту и запустить напрямую с реальным IP'
                  )}
                >
                  {t('Launch without proxy', 'Запустить без прокси')}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Fix execution outcomes banner (Requirement B) */}
        {fixOutcomes && fixOutcomes.length > 0 && !loading && (
          <div
            style={{
              background: 'var(--surface-2)',
              borderRadius: 'var(--radius-md)',
              padding: '12px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              borderLeft: checks.some((c) => c.status === 'fail')
                ? '3px solid var(--danger)'
                : '3px solid var(--ok)',
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

            {/* Honest post-fix summary banner */}
            {(() => {
              const appliedCount = fixOutcomes.filter((o) => o.status === 'applied').length;
              const remainingBlocking = checks.filter((c) => c.status === 'fail');
              if (remainingBlocking.length > 0) {
                return (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 8,
                      padding: '8px 10px',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--danger-bg)',
                      color: 'var(--danger)',
                      fontSize: 12,
                      fontWeight: 500,
                    }}
                  >
                    <span style={{ fontWeight: 700 }}>⚠️</span>
                    <div>
                      <span>
                        {lang === 'ru'
                          ? `Применено: ${appliedCount}. Остаётся блокирующим: ${remainingBlocking.map((c) => `${c.name} — ${c.detail || c.reasonCode || 'требуются ручные действия'}`).join('; ')}`
                          : `Applied: ${appliedCount}. Still blocking: ${remainingBlocking.map((c) => `${c.name} — ${c.detail || c.reasonCode || 'manual action required'}`).join('; ')}`}
                      </span>
                    </div>
                  </div>
                );
              }
              return (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 10px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--ok-bg)',
                    color: 'var(--ok)',
                    fontSize: 12,
                    fontWeight: 500,
                  }}
                >
                  <span>✓</span>
                  <div>
                    <span>
                      {lang === 'ru'
                        ? `Применено: ${appliedCount}. Все блокирующие проблемы устранены.`
                        : `Applied: ${appliedCount}. All blocking issues resolved.`}
                    </span>
                  </div>
                </div>
              );
            })()}
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
                {plan.blockingCount > 0 && (
                  <span
                    className="preflight-tag fail"
                    style={{ fontSize: 10, padding: '1px 6px' }}
                  >
                    {plan.blockingCount} {t('blocking', 'блокирует запуск')}
                  </span>
                )}
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

            {/* Notice if auto-fix will not solve blocking items (Requirement A) */}
            {plan.fixableCount > 0 && plan.blockingUnfixableCount > 0 && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 10px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--warn-bg)',
                  color: 'var(--warn)',
                  fontSize: 11.5,
                }}
              >
                <span>⚠️</span>
                <span>
                  {lang === 'ru'
                    ? `Авто-исправление не разблокирует запуск: ${plan.blockingUnfixableCount} блокирующая проверка требует ручных действий.`
                    : `Auto-fix will not unblock launch: ${plan.blockingUnfixableCount} blocking check(s) require manual action.`}
                </span>
              </div>
            )}
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
                      {renderBlockingBadge(item.isBlocking)}
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
                        borderLeft: item.isBlocking ? '2px solid var(--danger)' : '2px solid var(--border)',
                      }}
                    >
                      {renderBlockingBadge(item.isBlocking)}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1 }}>
                        <span style={{ fontWeight: 600, color: item.isBlocking ? 'var(--danger)' : 'var(--text-secondary)' }}>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {verdict?.overall === 'fail' && (
              <span
                style={{
                  fontSize: 11,
                  color: 'var(--warn)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                {t('⚠️ Real IP will be exposed', '⚠️ Будет использован реальный IP')}
              </span>
            )}
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
                title={
                  verdict?.overall === 'fail'
                    ? t(
                        'Warning: Launching without proxy will route traffic through your real IP address. This exposes your identity and defeats the purpose of an antidetect browser.',
                        'Внимание: запуск без прокси направит трафик через ваш реальный IP-адрес. Это раскрывает вашу личность в сети и противоречит цели использования антидетект-браузера.'
                      )
                    : undefined
                }
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
