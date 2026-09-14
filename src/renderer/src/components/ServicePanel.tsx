import React, { useState, useEffect } from 'react';
import { getApiOrigin, checkHealth, getApiKey } from '../api';

export function ServicePanel() {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [health, setHealth] = useState<'unknown' | 'ok' | 'degraded'>('unknown');

  const origin = getApiOrigin();
  const apiKey = getApiKey();

  useEffect(() => {
    const check = async () => {
      try {
        // `checkHealth` returns the ApiEnvelope; read it the way every other caller does.
        const res = await checkHealth();
        if (res.code === 0 && res.data?.status === 'ok') {
          setHealth('ok');
        } else {
          setHealth('degraded');
        }
      } catch {
        setHealth('degraded');
      }
    };

    check();
    const interval = setInterval(check, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen((prev) => !prev);
  };

  // The real command, with the real key — this is what the Copy button puts on the clipboard.
  const curlExample = `curl -H "x-api-key: ${apiKey || '<YOUR_API_KEY>'}" ${origin}/api/v1/profiles`;

  // What is DISPLAYED. A full API key on screen ends up in screenshots, bug reports and
  // screen shares, so the panel masks it while the copy button still yields the working
  // command. Showing it adds nothing: the operator already has it, and anyone shoulder-
  // surfing does not need it.
  const maskedKey = apiKey ? `${apiKey.slice(0, 4)}\u2026${apiKey.slice(-4)}` : '<YOUR_API_KEY>';
  const curlDisplay = `curl -H "x-api-key: ${maskedKey}" ${origin}/api/v1/profiles`;

  const handleCopyCurl = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(curlExample);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('[ServicePanel] copy failed:', err);
    }
  };

  return (
    <div className="service-panel-root" style={{ width: '100%' }}>
      <button
        type="button"
        onClick={handleToggle}
        className="footer-panel-header"
        aria-expanded={open}
        title="Automation API Status & Quick Examples"
      >
        <span
          className="footer-panel-dot"
          style={{
            backgroundColor:
              health === 'ok'
                ? 'var(--ok)'
                : health === 'degraded'
                  ? 'var(--danger)'
                  : 'var(--text-muted)',
          }}
        />
        <span className="footer-panel-title">API</span>
        <span className="footer-panel-badge">LOCAL</span>
        <span className="footer-panel-chevron">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="footer-panel-body">
          <div className="footer-panel-row">
            <span className="footer-panel-label">ORIGIN</span>
            <span
              className="footer-panel-code"
              title={origin}
              style={{
                userSelect: 'all',
                color: 'var(--text)',
              }}
            >
              {origin}
            </span>
          </div>

          <div className="footer-panel-row">
            <span className="footer-panel-label">AUTH</span>
            <span className="footer-panel-value">
              {apiKey ? 'API KEY SET' : 'NO KEY DETECTED'}
            </span>
          </div>

          <div className="footer-panel-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 'var(--space-1)' }}>
            <span className="footer-panel-label">CURL EXAMPLE</span>
            <div
              className="footer-panel-code"
              style={{
                width: '100%',
                wordBreak: 'break-all',
                whiteSpace: 'pre-wrap',
                maxHeight: '80px',
                overflowY: 'auto',
                userSelect: 'all',
              }}
            >
              {curlDisplay}
            </div>
          </div>

          <div className="footer-panel-actions">
            <button
              type="button"
              onClick={handleCopyCurl}
              className="footer-panel-btn secondary"
              style={{ width: '100%' }}
              title="Copy curl command example"
            >
              {copied ? 'Copied curl!' : 'Copy curl example'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
