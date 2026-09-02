import { randomUUID } from 'crypto';
import puppeteer, { Page, Browser } from 'puppeteer-core';
import { getDb } from '../../db';
import { TaskGroup, createTaskGroup } from '../taskGroups';

export interface CookieRobotConfig {
  profileId: string;
  urls: string[] | string;
  maxPages?: number;
  dwellMsMin?: number;
  dwellMsMax?: number;
  sessionCapMs?: number;
  perDomainRateLimitMs?: number;
  blocklist?: string[];
  headless?: boolean;
  clickInternalLinks?: boolean;
  internalLinkClickProbability?: number;
}

export interface CookieRobotReport {
  id: string;
  profileId: string;
  status: 'completed' | 'aborted' | 'error';
  pagesVisited: number;
  cookiesSet: number;
  domainsTouched: string[];
  durationMs: number;
  errors: string[];
  startedAt: number;
  finishedAt: number;
  dwells?: number[];
}

export interface CookieRobotHandle {
  runId: string;
  abort: () => void;
  done: Promise<CookieRobotReport>;
}

// Active kill switches keyed by runId and profileId
const activeRuns = new Map<string, { runId: string; profileId: string; abortRequested: boolean; abort: () => void }>();
// In-memory or fallback reports store (plus SQLite if available)
const reportsStore = new Map<string, CookieRobotReport>();

export function initCookieRobotDb(): void {
  try {
    const db = getDb();
    db.exec(`
      CREATE TABLE IF NOT EXISTS cookie_robot_reports (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        status TEXT NOT NULL,
        pages_visited INTEGER NOT NULL,
        cookies_set INTEGER NOT NULL,
        domains_touched TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        errors TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        finished_at INTEGER NOT NULL,
        report_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_cookie_robot_reports_profile ON cookie_robot_reports(profile_id);
    `);
  } catch {
    // If DB is not ready or mock environment, reportsStore will serve as store
  }
}

export function saveReport(report: CookieRobotReport): void {
  reportsStore.set(report.id, report);
  try {
    const db = getDb();
    initCookieRobotDb();
    db.prepare(`
      INSERT OR REPLACE INTO cookie_robot_reports (
        id, profile_id, status, pages_visited, cookies_set, domains_touched,
        duration_ms, errors, started_at, finished_at, report_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      report.id,
      report.profileId,
      report.status,
      report.pagesVisited,
      report.cookiesSet,
      JSON.stringify(report.domainsTouched),
      report.durationMs,
      JSON.stringify(report.errors),
      report.startedAt,
      report.finishedAt,
      JSON.stringify(report)
    );
  } catch {
    // DB write fallback silently
  }
}

export function getReport(id: string): CookieRobotReport | null {
  const mem = reportsStore.get(id);
  if (mem) return mem;
  try {
    const db = getDb();
    initCookieRobotDb();
    const row = db.prepare('SELECT report_json FROM cookie_robot_reports WHERE id = ?').get(id) as { report_json: string } | undefined;
    if (row && row.report_json) {
      const parsed = JSON.parse(row.report_json) as CookieRobotReport;
      reportsStore.set(id, parsed);
      return parsed;
    }
  } catch {
    // DB read fallback
  }
  return null;
}
export const getReportById = getReport;

export function listReports(profileId?: string): CookieRobotReport[] {
  try {
    const db = getDb();
    initCookieRobotDb();
    const rows = profileId
      ? (db.prepare('SELECT report_json FROM cookie_robot_reports WHERE profile_id = ? ORDER BY started_at DESC').all(profileId) as Array<{ report_json: string }>)
      : (db.prepare('SELECT report_json FROM cookie_robot_reports ORDER BY started_at DESC').all() as Array<{ report_json: string }>);
    if (rows && rows.length > 0) {
      return rows.map(r => JSON.parse(r.report_json) as CookieRobotReport);
    }
  } catch {
    // Fallback to in-memory
  }
  const all = Array.from(reportsStore.values());
  if (profileId) {
    return all.filter(r => r.profileId === profileId).sort((a, b) => b.startedAt - a.startedAt);
  }
  return all.sort((a, b) => b.startedAt - a.startedAt);
}

export function abortCookieRobotRun(runIdOrProfileId: string): boolean {
  let found = false;
  for (const [key, run] of activeRuns.entries()) {
    if (run.runId === runIdOrProfileId || run.profileId === runIdOrProfileId || key === runIdOrProfileId) {
      run.abort();
      found = true;
    }
  }
  return found;
}
export const abortCookieRobot = abortCookieRobotRun;

/**
 * Parses URL list from string (text lines or JSON array) or array.
 * Tolerates malformed lines, whitespace, comments, and invalid URLs.
 */
export function parseUrlList(input: string | string[]): string[] {
  if (Array.isArray(input)) {
    return sanitizeUrls(input);
  }
  // handle string
  if (typeof input !== 'string') return [];
  const trimmed = input.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return sanitizeUrls(parsed);
      }
      if (parsed && Array.isArray(parsed.urls)) {
        return sanitizeUrls(parsed.urls);
      }
    } catch {
      // ignore and treat as lines
    }
  }
  const lines = trimmed.split(/[\r\n]+/);
  return sanitizeUrls(lines);
}
export const parseUrls = parseUrlList;
function sanitizeUrls(rawItems: string[]): string[] {
  const results: string[] = [];
  for (const raw of rawItems) {
    const clean = raw.trim();
    if (!clean || clean.startsWith('#') || clean.startsWith('//')) {
      continue;
    }
    try {
      // Must be a valid URL with http or https protocol
      const u = new URL(clean);
      if (u.protocol === 'http:' || u.protocol === 'https:') {
        results.push(u.toString());
      }
    } catch {
      // Malformed URL ignored
    }
  }
  return results;
}

/**
 * Checks whether a hostname matches any glob in the blocklist.
 * Supports patterns like:
 * - "example.com"
 * - "*.example.com"
 * - "*ads*"
 * - "*.tracker.*"
 */
export function isDomainBlocked(hostname: string, blocklist: string[]): boolean {
  if (!blocklist || !Array.isArray(blocklist) || blocklist.length === 0) return false;
  const lowerHost = hostname.toLowerCase();
  for (const pattern of blocklist) {
    const trimmed = pattern.trim().toLowerCase();
    if (!trimmed) continue;
    if (trimmed === lowerHost) return true;
    if (trimmed.startsWith('*.')) {
      const root = trimmed.slice(2);
      if (lowerHost === root || lowerHost.endsWith('.' + root)) return true;
    } else if (trimmed.endsWith('.*')) {
      const prefix = trimmed.slice(0, -2);
      if (lowerHost === prefix || lowerHost.startsWith(prefix + '.')) return true;
    } else if (trimmed.startsWith('*.') && trimmed.endsWith('.*')) {
      const middle = trimmed.slice(2, -2);
      if (lowerHost.includes(middle)) return true;
    }
  }
  return false;
}
export const matchesBlocklist = isDomainBlocked;
/**
 * Generates cubic bezier curve points between (x1, y1) and (x2, y2).
 */
export function getBezierPoint(
  t: number,
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number }
): { x: number; y: number } {
  const inv = 1 - t;
  const x =
    inv * inv * inv * p0.x +
    3 * inv * inv * t * p1.x +
    3 * inv * t * t * p2.x +
    t * t * t * p3.x;
  const y =
    inv * inv * inv * p0.y +
    3 * inv * inv * t * p1.y +
    3 * inv * t * t * p2.y +
    t * t * t * p3.y;
  return { x: Math.round(x), y: Math.round(y) };
}

export function generateBezierPath(
  startOrX1: number | { x: number; y: number },
  endOrY1: number | { x: number; y: number },
  x2OrSteps?: number,
  y2?: number,
  stepsCount = 15
): Array<{ x: number; y: number }> {
  let x1: number, y1: number, x2: number, targetY2: number, steps: number;
  if (typeof startOrX1 === 'object' && typeof endOrY1 === 'object') {
    x1 = startOrX1.x;
    y1 = startOrX1.y;
    x2 = endOrY1.x;
    targetY2 = endOrY1.y;
    steps = typeof x2OrSteps === 'number' ? x2OrSteps : 15;
  } else {
    x1 = startOrX1 as number;
    y1 = endOrY1 as number;
    x2 = x2OrSteps as number;
    targetY2 = y2 as number;
    steps = stepsCount;
  }
  const dx = x2 - x1;
  const dy = targetY2 - y1;
  const cx1 = x1 + dx * 0.25 + (Math.random() - 0.5) * 20;
  const cy1 = y1 + dy * 0.25 + (Math.random() - 0.5) * 20;
  const cx2 = x1 + dx * 0.75 + (Math.random() - 0.5) * 20;
  const cy2 = y1 + dy * 0.75 + (Math.random() - 0.5) * 20;

  const path: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    path.push(getBezierPoint(t, { x: x1, y: y1 }, { x: cx1, y: cy1 }, { x: cx2, y: cy2 }, { x: x2, y: targetY2 }));
  }
  return path;
}
/**
 * Human-like scroll simulation on a Puppeteer Page.
 */
export async function simulateHumanScroll(page: Page, totalScrolls = 3): Promise<void> {
  for (let i = 0; i < totalScrolls; i++) {
    const scrollDelta = Math.floor(150 + Math.random() * 300);
    const direction = Math.random() > 0.15 ? 1 : -1; // mostly down, occasionally up
    const amount = scrollDelta * direction;

    await page.evaluate(`
      (function(y) {
        window.scrollBy({ top: y, behavior: 'smooth' });
      })(${amount})
    `).catch(() => undefined);

    await sleep(200 + Math.floor(Math.random() * 300));
  }
}

/**
 * Human-like mouse movement on a Puppeteer Page using bezier curves.
 */
export async function simulateHumanMouseMove(page: Page): Promise<void> {
  try {
    const viewport = page.viewport() || { width: 1280, height: 800 };
    const startX = Math.floor(Math.random() * viewport.width);
    const startY = Math.floor(Math.random() * viewport.height);
    const endX = Math.floor(Math.random() * viewport.width);
    const endY = Math.floor(Math.random() * viewport.height);

    const points = generateBezierPath(startX, startY, endX, endY, 10);
    for (const pt of points) {
      await page.mouse.move(pt.x, pt.y);
      await sleep(15 + Math.floor(Math.random() * 25));
    }
  } catch {
    // If mouse simulation fails or page navigating, ignore
  }
}

/**
 * Safety check: detects if an element looks like an auth/login/password/submit form or button.
 * NEVER interact with elements matching these heuristics.
 */
export async function findSafeInternalLink(page: Page, currentOrigin: string): Promise<string | null> {
  try {
    const safeLink = await page.evaluate(`
      (function(origin) {
        var AUTH_KEYWORDS = [
          'login', 'signin', 'sign-in', 'sign_in', 'auth', 'password',
          'register', 'signup', 'sign-up', 'sign_up', 'logout', 'checkout',
          'account', 'submit', 'oauth', 'token'
        ];

        var isAuth = function(text, href, el) {
          var checkStr = ((text || '') + ' ' + (href || '') + ' ' + (el.className || '') + ' ' + (el.id || '')).toLowerCase();
          return AUTH_KEYWORDS.some(function(kw) { return checkStr.indexOf(kw) !== -1; });
        };

        var anchors = Array.prototype.slice.call(document.querySelectorAll('a[href]'));
        for (var i = 0; i < anchors.length; i++) {
          var a = anchors[i];
          if (a.closest('form')) continue;

          var href = a.getAttribute('href');
          if (!href) continue;

          try {
            var url = new URL(href, window.location.href);
            if (url.origin !== origin) continue;
            if (url.pathname === window.location.pathname && url.search === window.location.search) continue;
            if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;

            if (isAuth(a.textContent || '', url.href, a)) {
              continue;
            }

            return url.href;
          } catch (e) {
            continue;
          }
        }
        return null;
      })(${JSON.stringify(currentOrigin)})
    `) as string | null;

    return safeLink;
  } catch {
    return null;
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Core robot execution loop given a page/browser session or CDP endpoint.
 */
export async function runCookieRobot(
  config: CookieRobotConfig,
  customPageSupplier?: () => Promise<{ page: Page; close: () => Promise<void> }>,
  runIdOverride?: string
): Promise<CookieRobotReport> {
  const runId = runIdOverride || randomUUID();
  let aborted = false;
  const startedAt = Date.now();
  const report: CookieRobotReport = {
    id: runId,
    profileId: config.profileId,
    status: 'completed',
    pagesVisited: 0,
    cookiesSet: 0,
    domainsTouched: [],
    durationMs: 0,
    errors: [],
    startedAt,
    finishedAt: 0,
    dwells: [],
  };

  const abort = () => {
    aborted = true;
    report.status = 'aborted';
  };

  const runEntry = { runId, profileId: config.profileId, abortRequested: false, abort };
  activeRuns.set(runId, runEntry);
  activeRuns.set(config.profileId, runEntry);
  // Policy configurations & defaults
  const maxPages = config.maxPages ?? 20;
  const dwellMsMin = Math.max(0, config.dwellMsMin ?? 1000);
  const dwellMsMax = Math.max(dwellMsMin, config.dwellMsMax ?? 4000);
  const sessionCapMs = config.sessionCapMs ?? 300000; // 5 min default cap
  const perDomainRateLimitMs = config.perDomainRateLimitMs ?? 2000;
  const blocklist = config.blocklist ?? [];
  const clickInternalLinks = config.clickInternalLinks ?? true;
  const internalLinkClickProbability = config.internalLinkClickProbability ?? 0.3;

  const urlList = parseUrlList(config.urls);
  const domainLastTouch = new Map<string, number>();
  const touchedDomains = new Set<string>();

  let pageInstance: Page | null = null;
  let closeBrowserOrPage: (() => Promise<void>) | null = null;

  try {
    if (customPageSupplier) {
      const supplied = await customPageSupplier();
      pageInstance = supplied.page;
      closeBrowserOrPage = supplied.close;
    } else {
      // Connect to profile or launch lightweight browser
      // If we don't have a launcher in headless test mode, caller supplies customPageSupplier.
      throw new Error('Browser supplier or launcher connection required');
    }

    for (let i = 0; i < urlList.length && report.pagesVisited < maxPages; i++) {
      // Check kill switch before starting next page load
      if (aborted) {
        break;
      }

      // Check session duration cap
      if (Date.now() - startedAt >= sessionCapMs) {
        report.errors.push(`Session cap of ${sessionCapMs}ms reached`);
        break;
      }

      const targetUrl = urlList[i];
      let urlObj: URL;
      try {
        urlObj = new URL(targetUrl);
      } catch {
        continue;
      }

      const hostname = urlObj.hostname;

      // Blocklist check
      if (isDomainBlocked(hostname, blocklist)) {
        continue;
      }

      // Per-domain rate limit check
      const lastTouch = domainLastTouch.get(hostname) || 0;
      const elapsedSinceDomain = Date.now() - lastTouch;
      if (elapsedSinceDomain < perDomainRateLimitMs) {
        const waitTime = perDomainRateLimitMs - elapsedSinceDomain;
        if (Date.now() - startedAt + waitTime >= sessionCapMs) {
          break;
        }
        await sleep(waitTime);
      }

      // Re-check abort
      if (aborted) break;

      // Navigate to page
      try {
        await pageInstance.goto(targetUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 20000,
        });

        report.pagesVisited++;
        domainLastTouch.set(hostname, Date.now());
        touchedDomains.add(hostname);

        // Simulate human browsing (scroll + mouse movement)
        await simulateHumanMouseMove(pageInstance);
        await simulateHumanScroll(pageInstance, 2);

        // Dwell pacing
        const dwellTime = Math.floor(dwellMsMin + Math.random() * (dwellMsMax - dwellMsMin));
        report.dwells?.push(dwellTime);

        // Check if we should click an internal link
        if (
          clickInternalLinks &&
          report.pagesVisited < maxPages &&
          Math.random() < internalLinkClickProbability &&
          !aborted
        ) {
          const internalLink = await findSafeInternalLink(pageInstance, urlObj.origin);
          if (internalLink && !isDomainBlocked(new URL(internalLink).hostname, blocklist)) {
            // Half dwell before clicking
            const halfDwell = Math.floor(dwellTime / 2);
            await sleep(Math.min(halfDwell, Math.max(0, sessionCapMs - (Date.now() - startedAt))));

            if (!aborted) {
              await pageInstance.goto(internalLink, {
                waitUntil: 'domcontentloaded',
                timeout: 15000,
              }).catch(() => undefined);

              report.pagesVisited++;
              await simulateHumanMouseMove(pageInstance);
              await simulateHumanScroll(pageInstance, 1);
            }
          } else {
            await sleep(Math.min(dwellTime, Math.max(0, sessionCapMs - (Date.now() - startedAt))));
          }
        } else {
          // Normal dwell
          await sleep(Math.min(dwellTime, Math.max(0, sessionCapMs - (Date.now() - startedAt))));
        }

        // Count cookies accumulated
        try {
          const cookies = await pageInstance.cookies();
          report.cookiesSet = cookies.length;
        } catch {
          // Ignore cookie retrieval errors
        }

      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        report.errors.push(`Failed navigating to ${targetUrl}: ${msg}`);
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!aborted) {
      report.status = 'error';
    }
    report.errors.push(`Robot execution error: ${msg}`);
  } finally {
    activeRuns.delete(runId);
    if (closeBrowserOrPage) {
      await closeBrowserOrPage().catch(() => undefined);
    }
    report.finishedAt = Date.now();
    report.durationMs = report.finishedAt - startedAt;
    report.domainsTouched = Array.from(touchedDomains);
    if (aborted) {
      report.status = 'aborted';
    }
    saveReport(report);
  }

  return report;
}

/**
 * Creates a runnable task-groups invocation handle so robots can be scheduled per profile set.
 * Matches TaskInvocationHandle shape from src/main/scripts/scriptEngine.ts:
 * {
 *   taskUuid: string;
 *   cancel: () => void;
 *   done: Promise<void>;
 * }
 */
export function invokeCookieRobotTask(
  config: CookieRobotConfig,
  customPageSupplier?: () => Promise<{ page: Page; close: () => Promise<void> }>
): {
  taskUuid: string;
  runId: string;
  cancel: () => void;
  done: Promise<CookieRobotReport>;
} {
  const taskUuid = randomUUID();
  let cancelled = false;

  const abortController = {
    runId: taskUuid,
    profileId: config.profileId,
    abortRequested: false,
    abort: () => {
      cancelled = true;
      if (activeRuns.has(taskUuid)) {
        activeRuns.get(taskUuid)?.abort();
      }
    },
  };
  activeRuns.set(taskUuid, abortController);

  const donePromise = (async () => {
    if (cancelled) {
      const now = Date.now();
      const report: CookieRobotReport = {
        id: taskUuid,
        profileId: config.profileId,
        status: 'aborted',
        pagesVisited: 0,
        cookiesSet: 0,
        domainsTouched: [],
        durationMs: 0,
        errors: ['Cancelled before start'],
        startedAt: now,
        finishedAt: now,
      };
      saveReport(report);
      activeRuns.delete(taskUuid);
      return report;
    }

    return runCookieRobot(config, customPageSupplier, taskUuid);
  })();

  return {
    taskUuid,
    runId: taskUuid,
    cancel: () => {
      abortController.abort();
    },
    done: donePromise,
  };
}

export interface ScheduleCookieRobotParams {
  name: string;
  profileIds: string[];
  robotConfig: CookieRobotConfig;
  activeSessionCap?: number;
  perTaskTimeoutMs?: number;
  repeatCount?: number;
  randomizeProfileOrder?: boolean;
  timeWindowCron?: string | null;
}

/**
 * Schedules a batch of cookie robot tasks across a profile set using taskGroups.
 */
export function scheduleCookieRobotTaskGroup(params: ScheduleCookieRobotParams): TaskGroup {
  const scriptId = 'cookie-robot-warmup';
  return createTaskGroup({
    name: params.name,
    script_id: scriptId,
    profile_ids: params.profileIds,
    active_session_cap: params.activeSessionCap ?? 1,
    per_task_timeout_ms: params.perTaskTimeoutMs ?? (params.robotConfig.sessionCapMs ? params.robotConfig.sessionCapMs + 30000 : 300000),
    repeat_count: params.repeatCount ?? 0,
    randomize_profile_order: params.randomizeProfileOrder ?? false,
    time_window_cron: params.timeWindowCron,
  });
}
