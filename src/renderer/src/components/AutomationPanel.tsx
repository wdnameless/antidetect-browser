import { useCallback, useEffect, useState } from 'react';
import { getApiKey, getApiOrigin, checkHealth, getMcpStatus, startMcp, stopMcp, type McpStatus } from '../api';
import { useI18n } from '../i18n';
import { currentTheme, setTheme, type Theme } from '../theme';

/**
 * Sidebar footer: the Automation API block from the reference design.
 *
 * One card, two rows of real state, two actions — instead of two independent collapsible
 * panels whose headers stacked into a list of unrelated `API ▼` / `MCP OFF ▼` lines.
 *
 * Everything here is a REAL operation on the running service:
 *  - the status dot and the API badge come from `GET /status`;
 *  - the MCP badge comes from `GET /api/v1/mcp/status`;
 *  - the address row copies the actual origin the API is reachable at;
 *  - "Enable MCP" starts/stops the MCP server through the real endpoints.
 * Nothing is decorative: there is no theme toggle because this product has one theme
 * (no light token set exists), and a switch that changed nothing would be a lie.
 */
export function AutomationPanel() {
  const { t } = useI18n();
  const [apiOk, setApiOk] = useState(false);
  const [mcp, setMcp] = useState<McpStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<'origin' | 'mcp' | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Seeded from the value already applied at startup, so the control shows the state that is
  // actually in effect rather than a default that may disagree with the page.
  const [theme, setThemeState] = useState<Theme>(() => currentTheme());

  const origin = getApiOrigin();
  const apiKey = getApiKey();

  const refresh = useCallback(() => {
    checkHealth()
      .then((res) => setApiOk(res.code === 0 && res.data?.status === 'ok'))
      .catch(() => setApiOk(false));
    getMcpStatus()
      .then((res) => {
        if (res.code === 0) setMcp(res.data);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, 10000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const copy = async (what: 'origin' | 'mcp', text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      window.setTimeout(() => setCopied(null), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Copy failed');
    }
  };

  const toggleMcp = () => {
    setBusy(true);
    setError(null);
    const call = mcp?.running ? stopMcp() : startMcp();
    call
      .then((res) => {
        if (res.code === 0 && res.data?.status) setMcp(res.data.status);
        else refresh();
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'MCP request failed'))
      .finally(() => setBusy(false));
  };

  // Masked on screen, real command on the clipboard: a full key on display ends up in
  // screenshots and screen shares, and the operator already has it.
  const maskedKey = apiKey ? `${apiKey.slice(0, 4)}\u2026${apiKey.slice(-4)}` : '<YOUR_API_KEY>';

  /** What a client needs to talk to the MCP server, in the transport that is actually live. */
  const mcpClientConfig = (): string => {
    if (mcp?.running && mcp.httpUrl) {
      // Running: the server exposes POST /mcp. There is no /sse route, so a config
      // pointing at one would 404 on connect.
      return JSON.stringify({ mcpServers: { nulltrace: { type: 'http', url: mcp.httpUrl } } }, null, 2);
    }
    // Stopped: stdio entry. The path nests one level deeper than the obvious guess
    // (`mcp/dist/mcp/src/index.js`), because the MCP source imports from `src/main/motion`.
    return JSON.stringify(
      { mcpServers: { nulltrace: { command: 'node', args: ['mcp/dist/mcp/src/index.js'] } } },
      null,
      2,
    );
  };

  const mcpLabel = mcp?.running
    ? mcp.toolCount !== undefined
      ? t('{n} tools').replace('{n}', String(mcp.toolCount))
      : t('On')
    : t('Off');

  return (
    <section className="automation-api-panel" aria-label={t('Automation API')}>
      <div className="automation-api-header">
        <span className="automation-api-title">{t('Automation API')}</span>
        <span className="automation-api-status">
          <span className={`status-dot ${apiOk ? 'online' : 'offline'}`} aria-hidden="true" />
          {apiOk ? t('On') : t('Off')}
        </span>
      </div>

      <div className="automation-api-address-row">
        <span className="automation-api-address" title={origin}>
          {origin.replace(/^https?:\/\//, '')}
        </span>
        <button
          type="button"
          className="automation-copy-btn"
          onClick={() => void copy('origin', origin)}
          title={t('Copy API address')}
          aria-label={t('Copy API address')}
        >
          {copied === 'origin' ? t('Copied') : t('Copy')}
        </button>
      </div>

      <div className="automation-actions-row">
        <button
          type="button"
          className="automation-action-btn"
          onClick={toggleMcp}
          disabled={busy}
          title={mcp?.running ? t('Stop the MCP server') : t('Start the MCP server')}
        >
          {t('MCP')}: {mcpLabel}
        </button>
        <button
          type="button"
          className="automation-action-btn"
          onClick={() => void copy('mcp', mcpClientConfig())}
          title={t('Copy the MCP client configuration')}
        >
          {copied === 'mcp' ? t('Copied') : t('MCP config')}
        </button>
      </div>

      {error && (
        <div className="automation-api-status" style={{ color: 'var(--danger)' }} role="alert">
          {error}
        </div>
      )}

      <div className="automation-actions-row">
        <a
          className="automation-action-btn"
          href="https://github.com/wdnameless/antidetect-browser/tree/main/docs"
          target="_blank"
          rel="noreferrer noopener"
        >
          {t('Documentation')}
        </a>
        <span className="automation-api-address" title={apiKey ? t('API key is set') : t('No API key detected')}>
          {maskedKey}
        </span>
      </div>

      {/* Theme: a real two-state control, and the only place the choice is made. It reflects
          the state that is actually in effect (including an OS preference when the operator
          has not chosen), and each side is a button so either can be selected directly
          rather than only toggled. */}
      <div className="theme-switch" role="group" aria-label={t('Theme')}>
        {(['light', 'dark'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            className={`theme-switch-option${theme === mode ? ' active' : ''}`}
            aria-pressed={theme === mode}
            onClick={() => {
              setTheme(mode);
              setThemeState(mode);
            }}
            title={mode === 'light' ? t('Switch to the light theme') : t('Switch to the dark theme')}
          >
            {mode === 'light' ? t('Light') : t('Dark')}
          </button>
        ))}
      </div>
    </section>
  );
}
