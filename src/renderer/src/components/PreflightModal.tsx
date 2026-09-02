import React, { useState } from 'react';
import { PreflightStatus, PreflightVerdict, getRemediation } from '../preflight';
import { Modal } from './Modal';
import { RefreshIcon, ShieldCheckIcon } from '../icons';

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

  const issuesCount = verdict ? verdict.checks.filter(c => c.status === 'fail' || c.status === 'warn').length : 0;

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

  if (!isOpen) return null;

  return (
    <Modal
      onClose={onClose}
      title={`Preflight Inspection: ${profileName || profileId}`}
      width={680}
    >
      <div className="preflight-modal-content">
        <div className="preflight-header-row">
          <div className="preflight-summary-status">
            <span className="preflight-muted-label">Overall Result:</span>
            {loading ? (
              <PreflightBadge status="loading" />
            ) : error ? (
              <span className="preflight-error-tag">Error</span>
            ) : verdict ? (
              <PreflightBadge status={verdict.overall} verdict={verdict} />
            ) : (
              <span className="preflight-muted-text">Pending</span>
            )}
          </div>
          {verdict && !loading && (
            <div className="preflight-meta">
              <span>Checked: <strong>{new Date(verdict.timestamp).toLocaleTimeString()}</strong></span>
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
            <p>Running preflight diagnostics (proxy latency, geolocation, timezone, TLS handshake, fingerprint coherence)...</p>
          </div>
        )}

        {verdict && !loading && (
          <div className="preflight-checks-list">
            <h4 className="preflight-section-title">Diagnostic Checks ({verdict.checks.length})</h4>
            <div className="preflight-checks-table">
              {verdict.checks.map((check) => {
                const remediation = check.reason ? getRemediation(check.reason) : null;
                const isExpanded = expandedCheck === check.name;
                const hasDetails = Boolean(remediation || check.message);

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
                          {check.message && (
                            <span className="preflight-check-summary">{check.message}</span>
                          )}
                        </div>
                      </div>

                      <div className="preflight-check-right">
                        <span className="preflight-check-latency">{check.durationMs}ms</span>
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
                        {check.reason && (
                          <div className="preflight-detail-row">
                            <span className="preflight-detail-label">Reason Code:</span>
                            <code className="preflight-code">{check.reason}</code>
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
            Close
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            {onRecheck && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => void onRecheck(profileId)}
                disabled={loading}
              >
                <RefreshIcon size={13} />
                <span>Re-run Checks</span>
              </button>
            )}
            {onStartProfile && (
              <button
                type="button"
                className={`btn ${verdict?.overall === 'fail' ? 'btn-danger' : 'btn-primary'}`}
                onClick={() => {
                  onClose();
                  void onStartProfile(profileId);
                }}
              >
                {verdict?.overall === 'fail' ? 'Launch Anyway' : 'Launch Profile'}
              </button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
