import { useCallback, useEffect, useState } from 'react';
import { getApiKey, getApiOrigin, checkHealth, getMcpStatus, startMcp, stopMcp, buildMcpBundleIn, type McpStatus } from '../api';
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
  // The backend not answering is different from an MCP failure, and it is the cause of the
  // "Failed to fetch" the operator actually sees: the request never reaches anything.
  const [backendDown, setBackendDown] = useState(false);
  const [bundleBusy, setBundleBusy] = useState(false);
  const [bundleResult, setBundleResult] = useState<{
    dir?: string;
    zip?: string;
    bytes?: number;
    toolCount?: number;
    scope?: string;
  } | null>(null);
  // Seeded from the value already applied at startup, so the control shows the state that is
  // actually in effect rather than a default that may disagree with the page.
  const [theme, setThemeState] = useState<Theme>(() => currentTheme());

  const origin = getApiOrigin();
  const apiKey = getApiKey();

  const refresh = useCallback(() => {
    checkHealth()
      .then((res) => {
        const ok = res.code === 0 && res.data?.status === 'ok';
        setApiOk(ok);
        // Clear a stale reachability warning once the backend answers again.
        if (ok) setBackendDown(false);
      })
      .catch(() => {
        setApiOk(false);
        // The health probe failing means the service is not there at all. Recorded as
        // state (not an error banner) so the panel keeps polling and recovers on its own
        // when the backend comes back, instead of showing a permanent failure.
        setBackendDown(true);
      });
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
        else {
          // A non-zero code carries the server's own reason; showing it beats a generic
          // "request failed".
          setError(res.msg || t('The MCP server did not start.'));
          refresh();
        }
      })
      .catch((err: unknown) => {
        // A bare `fetch` failure surfaces as "Failed to fetch", which tells the operator
        // nothing actionable — and the overwhelmingly common cause is that the local
        // backend is not running, so the request never reached anything. Say that instead.
        const raw = err instanceof Error ? err.message : String(err);
        const unreachable = /failed to fetch|networkerror|load failed/i.test(raw);
        setError(
          unreachable
            ? t('Cannot reach the local service. Is the backend running?')
            : raw
        );
      })
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

  /**
   * Produce a ready-to-use MCP server and show the config to hand to an agent.
   *
   * The user picks a folder; the app writes a self-contained server (dependencies vendored,
   * no install step) plus a zip. The returned config is what the agent needs, and it is
   * copied to the clipboard so the whole flow is "click, choose folder, paste".
   */
  const downloadBundle = async () => {
    setBundleResult(null);
    setError(null);
    // Prefer the shell's native folder picker; fall back to asking for a path when running
    // as a plain web client that has no such bridge.
    let dir = '';
    const picked = await window.antidetect?.data?.prepareDir?.();
    if (picked?.ok && picked.dir) {
      dir = picked.dir;
    } else {
      const typed = window.prompt(t('Folder to write the MCP server into:'));
      if (!typed) return;
      dir = typed;
    }
    setBundleBusy(true);
    try {
      const res = await buildMcpBundleIn(dir);
      if (res.code !== 0 || !res.data?.ok) {
        setError(res.data?.error ?? res.msg ?? t('Could not build the MCP server.'));
        return;
      }
      setBundleResult(res.data);
      if (res.data.config) {
        void navigator.clipboard.writeText(JSON.stringify(res.data.config, null, 2)).catch(() => undefined);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Could not build the MCP server.'));
    } finally {
      setBundleBusy(false);
    }
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
        {/* The key belongs with the address it authenticates — and folding it in here
            removes a whole row from the footer, which was tall enough (267px of a 640px
            window) to push the SYSTEM nav group under it. */}
        <span className="automation-api-key" title={apiKey ? t('API key is set') : t('No API key detected')}>
          {maskedKey}
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

      {/* Three short controls on one wrapping row instead of two fixed rows. */}
      <div className="automation-actions-row" style={{ flexWrap: 'wrap' }}>
        <button
          type="button"
          className="automation-action-btn"
          onClick={toggleMcp}
          disabled={busy || backendDown}
          title={mcp?.running ? t('Stop the MCP server') : t('Start the MCP server')}
        >
          {t('MCP')}: {mcpLabel}
        </button>
        <button
          type="button"
          className="automation-action-btn"
          data-testid="mcp-download"
          onClick={() => void downloadBundle()}
          disabled={bundleBusy || backendDown}
          title={t('Write a ready-to-use MCP server into a folder, for your agent to run')}
        >
          {bundleBusy ? t('Building…') : t('Download MCP')}
        </button>
        <button
          type="button"
          className="automation-action-btn"
          onClick={() => void copy('mcp', mcpClientConfig())}
          title={t('Copy the MCP client configuration')}
        >
          {copied === 'mcp' ? t('Copied') : t('MCP config')}
        </button>
        <a
          className="automation-action-btn"
          href="https://github.com/wdnameless/antidetect-browser/tree/main/docs"
          target="_blank"
          rel="noreferrer noopener"
        >
          {t('Documentation')}
        </a>
      </div>

      {bundleResult && (
        <div
          className="automation-api-status"
          role="status"
          style={{ color: 'var(--text-secondary)' }}
          title={`${t('MCP server written to')} ${bundleResult.dir}${bundleResult.toolCount ? ` — ${bundleResult.toolCount} ${t('tools')}` : ''}. ${t('Config copied. Point your agent at it.')}`}
        >
          {t('MCP server written to')} {bundleResult.dir}
          {bundleResult.toolCount ? ` — ${bundleResult.toolCount} ${t('tools')}` : ''}
          {'. '}
          {t('Config copied. Point your agent at it.')}
        </div>
      )}

      {backendDown && (
        <div className="automation-api-status" style={{ color: 'var(--warn)' }} role="status">
          {t('Cannot reach the local service. Is the backend running?')}
        </div>
      )}

      {error && (
        <div className="automation-api-status" style={{ color: 'var(--danger)' }} role="alert" title={error}>
          {error}
        </div>
      )}

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
