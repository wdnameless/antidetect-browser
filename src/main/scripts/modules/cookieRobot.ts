import { randomUUID } from 'crypto';
import puppeteer, { Page } from 'puppeteer-core';
import type { Browser } from 'puppeteer-core';
import { getDb } from '../../db';
import { TaskGroup, createTaskGroup } from '../taskGroups';
import { selectFarmSites, FARM_SITES } from './cookieFarm/sites';
export { selectFarmSites, FARM_SITES };
import { acceptCookieConsent } from './cookieFarm/consent';
import type { ConsentOutcome } from './cookieFarm/consent';

export interface CookieRobotConfig {
  profileId: string;
  urls?: string[] | string;
  maxPages?: number;
  dwellMsMin?: number;
  dwellMsMax?: number;
  sessionCapMs?: number;
  perDomainRateLimitMs?: number;
  blocklist?: string[];
  headless?: boolean;
  clickInternalLinks?: boolean;
  internalLinkClickProbability?: number;
  acceptConsent?: boolean;
  useBuiltInSites?: boolean;
  seed?: number;
  stopOnChallenge?: boolean;
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
  consents?: Array<{ domain: string; clicked: boolean; label?: string }>;
  managedProfile?: boolean;
}

export interface CookieRobotHandle {
  runId: string;
  abort: () => void;
  done: Promise<CookieRobotReport>;
}

export interface CookieRobotProgress {
  active: boolean;
  runId: string;
  profileId: string;
  status: 'running' | 'completed' | 'aborted' | 'error';
  pagesVisited: number;
  maxPages: number;
  cookiesSet: number;
  domainsTouched: string[];
  currentDomain: string | null;
  consentsAccepted: number;
  startedAt: number;
  elapsedMs: number;
}

type ActiveRunProgress = Omit<CookieRobotProgress, 'elapsedMs'>;

interface ActiveRunEntry {
  runId: string;
  profileId: string;
  abortRequested: boolean;
  abort: () => void;
  progress: ActiveRunProgress;
}

// Active kill switches and live progress keyed by runId and profileId
const activeRuns = new Map<string, ActiveRunEntry>();

function positiveOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

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

export function getCookieRobotProgress(runIdOrProfileId: string): CookieRobotProgress | null {
  if (!runIdOrProfileId) return null;
  let entry = activeRuns.get(runIdOrProfileId);
  if (!entry) {
    for (const run of activeRuns.values()) {
      if (run.runId === runIdOrProfileId || run.profileId === runIdOrProfileId) {
        entry = run;
        break;
      }
    }
  }
  if (!entry || !entry.progress) {
    return null;
  }
  const p = entry.progress;
  return {
    active: p.active,
    runId: p.runId,
    profileId: p.profileId,
    status: p.status,
    pagesVisited: p.pagesVisited,
    maxPages: p.maxPages,
    cookiesSet: p.cookiesSet,
    domainsTouched: Array.from(p.domainsTouched),
    currentDomain: p.currentDomain,
    consentsAccepted: p.consentsAccepted,
    startedAt: p.startedAt,
    elapsedMs: Math.max(0, Date.now() - p.startedAt),
  };
}

/**
 * Parses URL list from string (text lines or JSON array) or array.
 * Tolerates malformed lines, whitespace, comments, and invalid URLs.
 */
export function parseUrlList(input?: string | string[] | null): string[] {
  if (!input) return [];
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

function hashProfileId(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Resolve a page from the profile's own browser.
 *
 * Starts the profile (headless, the default from the caller) when it is not running. The returned
 * `close()` disconnects the CDP client, closes the tab this call opened, and stops the profile —
 * but only the parts this call is responsible for: a profile the operator already had open is left
 * running, and a tab that existed before this run is left open.
 *
 * `ownsProfile` in the result tells the caller whether the run started the profile, so the report
 * cannot claim lifecycle ownership it did not have.
 */
export function createProfilePageSupplier(
  profileId: string,
  opts: { headless: boolean }
): () => Promise<{ page: Page; close: () => Promise<void>; ownsProfile: boolean }> {
  return async () => {
    // Dynamic imports keep this module importable in unit tests without pulling the launcher in
    const { resolveLaunchConfig } = await import('../../profiles/profileManager');
    const { startProfile, stopProfile, isRunning, getRunningWs } = await import('../../launcher/chromium');

    let startedHere = false;
    let ws: string | undefined;

    if (!isRunning(profileId)) {
      const launchConfig = resolveLaunchConfig(profileId);
      const startResult = await startProfile({ ...launchConfig, headless: opts.headless });
      startedHere = true;
      ws = startResult.ws.puppeteer;
    } else {
      ws = getRunningWs(profileId);
    }

    if (!ws) {
      // Nothing was started yet in the running profile case, so there is nothing to undo.
      throw new Error(`Failed to obtain WebSocket endpoint for profile ${profileId}`);
    }

    // A failure from here on happens AFTER the profile was started, so it must not escape without
    // stopping it: the caller never receives a `close()` to call, and the profile would be left
    // running headless — invisible to the operator, holding its user-data dir and proxy session.
    let browser: Browser | undefined;
    try {
      browser = await puppeteer.connect({ browserWSEndpoint: ws, defaultViewport: null });
      // NEVER reuse an existing page. A profile the operator has open has their own tabs in it,
      // and the crawl navigates and closes whatever page it gets: reusing `pages[0]` would drive
      // their visible tab across twenty sites. A dedicated tab is opened instead and closed after.
      const page = await browser.newPage();

      const close = async () => {
        try {
          await page.close();
        } catch {
          // The page may already be gone; the profile teardown below still matters.
        }
        try {
          await browser?.disconnect();
        } catch {
          // ignore disconnect errors
        }
        if (startedHere) {
          await stopProfile(profileId);
        }
      };

      return { page, close, ownsProfile: startedHere };
    } catch (err) {
      try {
        await browser?.disconnect();
      } catch {
        // ignore disconnect errors
      }
      if (startedHere) {
        await stopProfile(profileId).catch(() => undefined);
      }
      throw err;
    }
  };
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
  let aborted = Boolean(runIdOverride && activeRuns.get(runIdOverride)?.abortRequested);
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

  const maxPages = Math.max(1, positiveOr(config.maxPages, 20));
  const dwellMsMin = positiveOr(config.dwellMsMin, 1000);
  const dwellMsMax = Math.max(dwellMsMin, positiveOr(config.dwellMsMax, 4000));
  const sessionCapMs = Math.max(1, positiveOr(config.sessionCapMs, 300000)); // 5 min default cap
  const perDomainRateLimitMs = positiveOr(config.perDomainRateLimitMs, 2000);
  const blocklist = config.blocklist ?? [];
  const clickInternalLinks = config.clickInternalLinks ?? true;
  const internalLinkClickProbability = config.internalLinkClickProbability ?? 0.3;

  const progress: ActiveRunProgress = {
    active: true,
    runId,
    profileId: config.profileId,
    status: aborted ? 'aborted' : 'running',
    pagesVisited: 0,
    maxPages,
    cookiesSet: 0,
    domainsTouched: [],
    currentDomain: null,
    consentsAccepted: 0,
    startedAt,
  };

  const abort = () => {
    aborted = true;
    report.status = 'aborted';
    progress.status = 'aborted';
  };

  const runEntry: ActiveRunEntry = { runId, profileId: config.profileId, abortRequested: aborted, abort, progress };
  activeRuns.set(runId, runEntry);
  activeRuns.set(config.profileId, runEntry);

  let urlList: string[] = [];
  if (config.urls !== undefined && config.urls !== null) {
    urlList = parseUrlList(config.urls);
  }
  // An EMPTY list is treated as "no list supplied", not as "visit nothing". The scheduler builds
  // its per-profile config with `urls: body.config?.urls || []`, so an operator who omitted `urls`
  // to use the built-in sites produced an empty array — which used to bypass `selectFarmSites`,
  // launch a browser and visit zero pages while reporting a clean completion.
  if (urlList.length === 0 && config.useBuiltInSites !== false) {
    const seed = config.seed ?? hashProfileId(config.profileId);
    urlList = selectFarmSites(seed, maxPages).map((site) => site.url);
  }

  const domainLastTouch = new Map<string, number>();
  const touchedDomains = new Set<string>();
  const consentedDomains = new Set<string>();

  let pageInstance: Page | null = null;
  let closeBrowserOrPage: (() => Promise<void>) | null = null;

  try {
    if (customPageSupplier) {
      const supplied = await customPageSupplier();
      pageInstance = supplied.page;
      closeBrowserOrPage = supplied.close;
    } else {
      const supplier = createProfilePageSupplier(config.profileId, { headless: config.headless ?? true });
      const supplied = await supplier();
      pageInstance = supplied.page;
      closeBrowserOrPage = supplied.close;
      // Ownership is whatever the supplier actually did. An already-open profile is neither
      // started nor stopped by this run, so claiming `managedProfile` would be a lie the operator
      // would act on (e.g. expecting it to be closed afterwards).
      report.managedProfile = supplied.ownsProfile;
    }

    let consentsAcceptedCount = 0;
    const syncNavProgress = async (domain: string) => {
      try {
        const cookies = await pageInstance?.cookies();
        if (cookies) {
          report.cookiesSet = cookies.length;
        }
      } catch {
        // ignore cookie retrieval errors
      }
      progress.pagesVisited = report.pagesVisited;
      progress.cookiesSet = report.cookiesSet;
      progress.domainsTouched = Array.from(touchedDomains);
      progress.currentDomain = domain;
    };


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

        // Challenge detection (M4: minimal inline check)
        const pageTitle = (typeof pageInstance.title === 'function' ? await pageInstance.title().catch(() => '') : '') || '';
        const currentUrl = (typeof pageInstance.url === 'function' ? pageInstance.url() : targetUrl) || targetUrl;
        const checkStr = `${pageTitle} ${currentUrl}`.toLowerCase();
        const challengeKeywords = [
          'just a moment',
          'attention required',
          'cloudflare',
          'captcha',
          'are you human',
          '/sorry/',
        ];
        const isChallenge = challengeKeywords.some((kw) => checkStr.includes(kw));
        if (isChallenge) {
          report.errors.push(`Challenge detected on ${targetUrl}: title="${pageTitle}" url="${currentUrl}"`);
          if (config.stopOnChallenge === true) {
            break;
          }
          continue;
        }

        report.pagesVisited++;
        domainLastTouch.set(hostname, Date.now());
        touchedDomains.add(hostname);

        await syncNavProgress(hostname);

        // Cookie consent handling.
        // The runner reaches this straight after `domcontentloaded`, and a CMP injects its banner
        // after that — measured: scanning once here returns {clicked:false} on sites that do show
        // a banner, while scanning again a few seconds later clicks it. The wait is bounded and
        // exits as soon as a control is found — and exits early on abort, so a kill switch does
        // not wait out five seconds per page before the loop notices.
        if (config.acceptConsent !== false && !consentedDomains.has(hostname)) {
          let outcome: ConsentOutcome = { clicked: false };
          try {
            outcome = await acceptCookieConsent(pageInstance, {
              waitMs: 5000,
              shouldStop: () => aborted,
            });
          } catch {
            // ignore consent errors
          }
          if (!report.consents) {
            report.consents = [];
          }
          report.consents.push({
            domain: hostname,
            clicked: outcome.clicked,
            label: outcome.label,
          });
          consentedDomains.add(hostname);
          if (outcome.clicked) {
            consentsAcceptedCount++;
            try {
              const cookies = await pageInstance.cookies();
              report.cookiesSet = cookies.length;
              progress.cookiesSet = report.cookiesSet;
            } catch {
              // ignore cookie retrieval errors
            }
          }
          progress.consentsAccepted = consentsAcceptedCount;
        }

        // Stop before spending the dwell on a run the operator has already killed.
        if (aborted) break;

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
              const internalHost = new URL(internalLink).hostname;
              touchedDomains.add(internalHost);
              await syncNavProgress(internalHost);
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
          progress.cookiesSet = report.cookiesSet;
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
      progress.status = 'error';
    }
    report.errors.push(`Robot execution error: ${msg}`);
  } finally {
    // The report must be persisted BEFORE `active` flips to false. The UI polls progress and, the
    // moment it sees `active: false`, fetches the report for that run — if the row is not written
    // yet the fetch finds nothing and the modal falls back to a bare "completed" banner with no
    // metrics, which reads as a failure to the operator. Ordering this the other way was a race the
    // poll lost every time on a short run.
    report.finishedAt = Date.now();
    report.durationMs = report.finishedAt - startedAt;
    report.domainsTouched = Array.from(touchedDomains);
    if (aborted) {
      report.status = 'aborted';
    }
    saveReport(report);

    progress.active = false;
    progress.currentDomain = null;
    if (aborted) {
      progress.status = 'aborted';
    } else if (report.status === 'error') {
      progress.status = 'error';
    } else {
      progress.status = 'completed';
    }

    // BOTH keys must go: the entry is registered under the runId and the profileId, and deleting
    // only the runId left the finished run reachable by profile id — `abortCookieRobotRun` kept
    // reporting success for a run that had already completed.
    activeRuns.delete(runId);
    activeRuns.delete(config.profileId);
    if (closeBrowserOrPage) {
      await closeBrowserOrPage().catch(() => undefined);
    }
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

  const initialMaxPages = Math.max(1, positiveOr(config.maxPages, 20));
  const progress: ActiveRunProgress = {
    active: true,
    runId: taskUuid,
    profileId: config.profileId,
    status: 'running',
    pagesVisited: 0,
    maxPages: initialMaxPages,
    cookiesSet: 0,
    domainsTouched: [],
    currentDomain: null,
    consentsAccepted: 0,
    startedAt: Date.now(),
  };

  const abortController: ActiveRunEntry = {
    runId: taskUuid,
    profileId: config.profileId,
    abortRequested: false,
    abort: () => {
      cancelled = true;
      abortController.abortRequested = true;
      progress.status = 'aborted';
      const current = activeRuns.get(taskUuid);
      if (current && current !== abortController) {
        current.abort();
      }
    },
    progress,
  };
  activeRuns.set(taskUuid, abortController);
  activeRuns.set(config.profileId, abortController);

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
      progress.active = false;
      progress.status = 'aborted';
      activeRuns.delete(config.profileId);
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
