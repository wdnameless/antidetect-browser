import React, { useEffect, useRef } from 'react';
import {
  FleetRunState,
  FleetProfileState,
  FleetProfileStatus,
  fleetProgress,
  SseLogEntry,
  extractScreenshotRef,
} from '../flowLiveRun';
import { useI18n } from '../i18n';

export interface FleetPanelProps {
  state: FleetRunState | null;
  profileNames: Record<string, string>;
  selectedTaskUuid: string | null;
  onSelectProfile: (taskUuid: string) => void;
  onStop: () => void;
  running: boolean;
}

const STATUS_COLORS: Record<FleetProfileStatus, { bg: string; fg: string; border: string }> = {
  queued: { bg: 'rgba(161, 161, 170, 0.15)', fg: '#a1a1aa', border: 'rgba(161, 161, 170, 0.25)' },
  working: { bg: 'rgba(59, 130, 246, 0.2)', fg: '#60a5fa', border: 'rgba(59, 130, 246, 0.3)' },
  finished: { bg: 'rgba(34, 197, 94, 0.2)', fg: '#4ade80', border: 'rgba(34, 197, 94, 0.3)' },
  error: { bg: 'rgba(239, 68, 68, 0.2)', fg: '#f87171', border: 'rgba(239, 68, 68, 0.3)' },
  stopped: { bg: 'rgba(255, 255, 255, 0.08)', fg: '#a1a1aa', border: 'rgba(255, 255, 255, 0.1)' },
};

/**
 * Renders one profile's log lines with timestamps and screenshot previews —
 * the same rendering used by the single-profile Live Run panel. Sharing this
 * component keeps both surfaces on one implementation.
 */
export function LogLineList({ logs, emptyLabel }: { logs: SseLogEntry[]; emptyLabel?: string }) {
  if (logs.length === 0) {
    if (!emptyLabel) return null;
    return (
      <div style={{ color: '#52525b', fontStyle: 'italic' }}>{emptyLabel}</div>
    );
  }
  return (
    <>
      {logs.map((log, idx) => {
        const screenshot = extractScreenshotRef(log.line);
        return (
          <div
            key={idx}
            data-testid="log-line"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              padding: '2px 0',
              borderBottom: '1px solid rgba(255,255,255,0.02)',
            }}
          >
            <div style={{ display: 'flex', gap: 8 }}>
              {log.created_at && (
                <span style={{ color: '#52525b', flexShrink: 0 }}>
                  {new Date(log.created_at).toLocaleTimeString()}
                </span>
              )}
              <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{log.line}</span>
            </div>
            {screenshot && (
              <div
                data-testid="screenshot-preview"
                style={{
                  margin: '4px 0 4px 20px',
                  padding: 6,
                  borderRadius: 4,
                  background: '#18181b',
                  border: '1px solid rgba(255,255,255,0.1)',
                  maxWidth: 400,
                }}
              >
                {screenshot.startsWith('data:image/') ? (
                  <img
                    src={screenshot}
                    alt="screenshot preview"
                    style={{ width: '100%', maxHeight: 180, objectFit: 'contain', borderRadius: 2 }}
                  />
                ) : (
                  <div style={{ fontSize: 10, color: '#38bdf8' }}>
                    🖼️ Screenshot: {screenshot}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

export function FleetPanel({
  state,
  profileNames,
  selectedTaskUuid,
  onSelectProfile,
  onStop,
  running,
}: FleetPanelProps) {
  const { t } = useI18n();
  const profiles: FleetProfileState[] = state?.profiles ?? [];
  const selected = profiles.find(p => p.taskUuid === selectedTaskUuid) ?? null;
  const logRef = useRef<HTMLDivElement>(null);

  // Auto-scroll the selected profile's log to the bottom as new lines arrive.
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [selected?.logs]);

  const anyBusy = profiles.some(p => p.status === 'queued' || p.status === 'working');

  return (
    <div
      data-testid="fleet-panel"
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      {/* Fleet header */}
      <div
        style={{
          padding: '6px 16px',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'rgba(255,255,255,0.02)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#fafafa' }}>{t('Fleet Progress')}</span>
          <span style={{ fontSize: 10, color: '#71717a' }}>
            {profiles.length} profile{profiles.length === 1 ? '' : 's'}
          </span>
        </div>
        <button
          data-testid="btn-stop-fleet-run"
          onClick={onStop}
          disabled={!running || !anyBusy}
          style={{
            background: running && anyBusy ? 'rgba(239, 68, 68, 0.15)' : 'rgba(255,255,255,0.05)',
            border: running && anyBusy ? '1px solid rgba(239, 68, 68, 0.35)' : '1px solid rgba(255,255,255,0.08)',
            color: running && anyBusy ? '#fca5a5' : '#71717a',
            fontSize: 11,
            padding: '3px 10px',
            borderRadius: 4,
            cursor: running && anyBusy ? 'pointer' : 'not-allowed',
          }}
        >
          ■ {t('Stop Run')}
        </button>
      </div>

      {/* Body: profile rows | selected profile log */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* Profile list */}
        <div
          data-testid="fleet-profile-list"
          style={{
            width: 280,
            flexShrink: 0,
            borderRight: '1px solid rgba(255,255,255,0.08)',
            overflowY: 'auto',
            padding: '6px',
          }}
        >
          {profiles.length === 0 && (
            <div style={{ color: '#52525b', fontStyle: 'italic', fontSize: 11, padding: 8 }}>
              {t('Select profile...')}
            </div>
          )}
          {profiles.map(p => {
            const progress = fleetProgress(p);
            const colors = STATUS_COLORS[p.status];
            const isSelected = p.taskUuid === selectedTaskUuid;
            const isQueued = p.status === 'queued';
            const pct = Math.round(progress.fraction * 100);
            return (
              <div
                key={p.taskUuid}
                data-testid="fleet-row"
                data-profile-id={p.profileId}
                data-status={p.status}
                onClick={() => onSelectProfile(p.taskUuid)}
                style={{
                  padding: '6px 8px',
                  borderRadius: 6,
                  cursor: 'pointer',
                  marginBottom: 4,
                  background: isSelected ? 'rgba(59, 130, 246, 0.12)' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${isSelected ? 'rgba(59, 130, 246, 0.35)' : 'rgba(255,255,255,0.06)'}`,
                  // Queued rows are deliberately muted so they read as
                  // "not started yet" rather than actively working.
                  opacity: isQueued && !isSelected ? 0.62 : 1,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: '#e4e4e7',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {profileNames[p.profileId] || p.profileId}
                  </span>
                  <span
                    data-testid="fleet-status-chip"
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      padding: '1px 6px',
                      borderRadius: 10,
                      flexShrink: 0,
                      background: colors.bg,
                      color: colors.fg,
                      border: `1px solid ${colors.border}`,
                    }}
                  >
                    {t(p.status)}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                  <span
                    style={{
                      fontSize: 10,
                      color: '#71717a',
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {p.currentNodeId ? `node: ${p.currentNodeId}` : 'node: —'}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5 }}>
                  <div
                    data-testid="fleet-progress-bar"
                    style={{
                      flex: 1,
                      height: 4,
                      borderRadius: 2,
                      background: 'rgba(255,255,255,0.08)',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        width: `${pct}%`,
                        height: '100%',
                        borderRadius: 2,
                        background:
                          p.status === 'error'
                            ? '#ef4444'
                            : p.status === 'finished'
                            ? '#4ade80'
                            : p.status === 'stopped'
                            ? '#a1a1aa'
                            : '#60a5fa',
                      }}
                    />
                  </div>
                  <span style={{ fontSize: 9, color: '#71717a', flexShrink: 0 }}>
                    {progress.completed}/{progress.total}
                  </span>
                </div>
                {p.error && (
                  <div style={{ color: '#ef4444', fontSize: 10, marginTop: 4, wordBreak: 'break-all' }}>
                    {p.error}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Selected profile log */}
        <div
          ref={logRef}
          data-testid="fleet-log-view"
          style={{
            flex: 1,
            minWidth: 0,
            overflowY: 'auto',
            padding: '8px 16px',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            fontSize: 11,
            lineHeight: 1.5,
            color: '#d4d4d8',
          }}
        >
          {selected ? (
            <LogLineList
              logs={selected.logs}
              emptyLabel={
                selected.status === 'queued' && !selected.error
                  ? 'Waiting for log stream...'
                  : 'No logs yet.'
              }
            />
          ) : (
            <div style={{ color: '#52525b', fontStyle: 'italic' }}>
              {t('Select profile...')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
