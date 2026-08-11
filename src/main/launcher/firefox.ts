// Managed Firefox (Camoufox) launcher via Playwright's Juggler protocol.
// Unlike Chromium (CDP ws endpoint), Camoufox does not expose a connectable
// ws endpoint via CLI flags — the service holds the playwright.firefox instance
// and exposes control through API methods (newPage/navigate/evaluate/title/stop).
import { firefox, type Browser, type Page } from 'playwright';
import { getCamoufoxPath } from '../config';

export interface FirefoxStartOptions {
  profileId: string;
  userDataDir: string;
  proxyServer?: string;
  proxyAuth?: { username: string; password: string };
  timezone?: string;
  lang?: string;
}

export interface FirefoxPageResult {
  ok: boolean;
  error?: string;
  title?: string;
  url?: string;
  result?: unknown;
}

interface RunningFirefox {
  browser: Browser;
  page: Page | null;
}

const running = new Map<string, RunningFirefox>();

export function isRunning(profileId: string): boolean {
  return running.has(profileId);
}

export function getRunningPage(profileId: string): Page | null {
  return running.get(profileId)?.page ?? null;
}

function toError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Launch a Camoufox (Firefox) instance for a profile and open a page.
 * Returns ok:true on success; ok:false with error otherwise.
 */
export async function startFirefox(opts: FirefoxStartOptions): Promise<FirefoxPageResult> {
  const existing = running.get(opts.profileId);
  if (existing) {
    return { ok: true, title: existing.page ? await existing.page.title().catch(() => '') : undefined };
  }

  const executable = getCamoufoxPath();
  if (!executable) {
    return { ok: false, error: 'Camoufox not found (run: download camoufox into data/chromium/camoufox/extracted)' };
  }

  try {
    const browser = await firefox.launch({
      executablePath: executable,
      headless: false,
      firefoxUserPrefs: {
        'browser.startup.page': 0,
        'browser.shell.checkDefaultBrowser': false,
        'browser.aboutConfig.showWarning': false,
      },
    });

    const context = await browser.newContext({
      userAgent: undefined,
      locale: opts.lang ?? 'en-US',
      timezoneId: opts.timezone ?? undefined,
      proxy: opts.proxyServer
        ? {
            server: opts.proxyServer,
            username: opts.proxyAuth?.username,
            password: opts.proxyAuth?.password,
          }
        : undefined,
    });

    const page = await context.newPage();
    running.set(opts.profileId, { browser, page });

    return { ok: true, url: page.url() };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

/** Navigate the profile's page to a URL. */
export async function navigate(profileId: string, url: string): Promise<FirefoxPageResult> {
  const rec = running.get(profileId);
  if (!rec || !rec.page) return { ok: false, error: 'profile not running' };
  try {
    await rec.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    return { ok: true, url: rec.page.url(), title: await rec.page.title().catch(() => '') };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

/** Evaluate a JavaScript expression in the profile's page. */
export async function evaluate(profileId: string, expression: string): Promise<FirefoxPageResult> {
  const rec = running.get(profileId);
  if (!rec || !rec.page) return { ok: false, error: 'profile not running' };
  try {
    const result = await rec.page.evaluate(expression);
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

/** Read the profile's page title. */
export async function getTitle(profileId: string): Promise<FirefoxPageResult> {
  const rec = running.get(profileId);
  if (!rec || !rec.page) return { ok: false, error: 'profile not running' };
  try {
    return { ok: true, title: await rec.page.title() };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

/** Stop the profile's Firefox instance. */
export async function stopFirefox(profileId: string): Promise<FirefoxPageResult> {
  const rec = running.get(profileId);
  if (!rec) return { ok: true };
  try {
    await rec.browser.close();
  } catch (err) {
    return { ok: false, error: toError(err) };
  } finally {
    running.delete(profileId);
  }
  return { ok: true };
}

/** Stop all running Firefox instances (graceful shutdown). */
export async function stopAllFirefox(): Promise<void> {
  for (const id of Array.from(running.keys())) {
    await stopFirefox(id);
  }
}
