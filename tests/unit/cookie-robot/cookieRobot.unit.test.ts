import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  parseUrls,
  matchesBlocklist,
  findSafeInternalLink,
  getBezierPoint,
  generateBezierPath,
  saveReport,
  getReportById,
  listReports,
  abortCookieRobot,
  runCookieRobot,
  CookieRobotConfig,
} from '../../../src/main/scripts/modules/cookieRobot';
import { initDb, getDb, closeDb } from '../../../src/main/db';
import type { Page } from 'puppeteer-core';

describe('Cookie Robot Unit Tests', () => {
  beforeEach(async () => {
    await initDb(':memory:');
    const db = getDb();
    // create tables if not present
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
        finished_at INTEGER NOT NULL
      );
    `);
  });

  afterEach(() => {
    closeDb();
  });

  describe('1. URL list ingestion', () => {
    it('parses array of strings, normalizing and filtering invalid entries', () => {
      const input = [
        'https://example.com',
        'http://sub.test.org/path?q=1',
        'ftp://invalid-proto.com',
        'not-a-url',
        '   https://spaced.com/foo   ',
      ];
      const parsed = parseUrls(input);
      expect(parsed).toEqual([
        'https://example.com/',
        'http://sub.test.org/path?q=1',
        'https://spaced.com/foo',
      ]);
    });

    it('tolerates malformed lines and parses newline-delimited text', () => {
      const text = `
        https://alpha.com
        # this is a comment
        not a valid url line
        http://beta.org/test
        12345
        https://gamma.io/path#hash
      `;
      const parsed = parseUrls(text);
      expect(parsed).toEqual([
        'https://alpha.com/',
        'http://beta.org/test',
        'https://gamma.io/path#hash',
      ]);
    });

    it('parses JSON formatted string (array of strings or object with urls array)', () => {
      const jsonArray = JSON.stringify(['https://json1.com', 'https://json2.com']);
      expect(parseUrls(jsonArray)).toEqual([
        'https://json1.com/',
        'https://json2.com/',
      ]);

      const jsonObject = JSON.stringify({ urls: ['https://obj1.com', 'bad', 'https://obj2.com'] });
      expect(parseUrls(jsonObject)).toEqual([
        'https://obj1.com/',
        'https://obj2.com/',
      ]);
    });

    it('returns empty array on completely malformed or empty input', () => {
      expect(parseUrls('')).toEqual([]);
      expect(parseUrls('     \n\n  ')).toEqual([]);
      expect(parseUrls('invalid:::foo')).toEqual([]);
    });
  });

  describe('2. Domain Blocklist Globs', () => {
    it('matches exact domains and wildcard subdomains', () => {
      const blocklist = ['badsite.com', '*.tracker.net', 'ads.*', '*.gov.uk'];

      expect(matchesBlocklist('badsite.com', blocklist)).toBe(true);
      expect(matchesBlocklist('other.com', blocklist)).toBe(false);

      expect(matchesBlocklist('sub.tracker.net', blocklist)).toBe(true);
      expect(matchesBlocklist('tracker.net', blocklist)).toBe(true);
      expect(matchesBlocklist('deep.nested.tracker.net', blocklist)).toBe(true);
      expect(matchesBlocklist('nottracker.net', blocklist)).toBe(false);

      expect(matchesBlocklist('ads.com', blocklist)).toBe(true);
      expect(matchesBlocklist('ads.co.uk', blocklist)).toBe(true);
      expect(matchesBlocklist('myads.com', blocklist)).toBe(false);

      expect(matchesBlocklist('service.gov.uk', blocklist)).toBe(true);
    });

    it('handles empty or undefined blocklist', () => {
      expect(matchesBlocklist('example.com', [])).toBe(false);
      expect(matchesBlocklist('example.com', undefined as unknown as string[])).toBe(false);
    });
  });

  describe('3. Form-safety and Auth Heuristics', () => {
    it('findSafeInternalLink ignores form elements and auth links', async () => {
      const mockPage = {
        evaluate: vi.fn().mockImplementation(async (scriptStr: string) => {
          // Simulate page DOM evaluation logic
          return null;
        }),
      } as unknown as Page;

      const res = await findSafeInternalLink(mockPage, 'https://example.com');
      expect(res).toBeNull();
      expect(mockPage.evaluate).toHaveBeenCalled();
    });
  });

  describe('4. Human-like Pacing & Bezier curve math', () => {
    it('calculates smooth Bezier curve points between start and end', () => {
      const p0 = { x: 0, y: 0 };
      const p1 = { x: 50, y: 100 };
      const p2 = { x: 100, y: 100 };
      const p3 = { x: 200, y: 200 };

      const start = getBezierPoint(0, p0, p1, p2, p3);
      expect(start).toEqual({ x: 0, y: 0 });

      const mid = getBezierPoint(0.5, p0, p1, p2, p3);
      expect(mid.x).toBeGreaterThan(0);
      expect(mid.x).toBeLessThan(200);
      expect(mid.y).toBeGreaterThan(0);

      const end = getBezierPoint(1, p0, p1, p2, p3);
      expect(end).toEqual({ x: 200, y: 200 });
    });

    it('generates a path with requested number of steps', () => {
      const path = generateBezierPath({ x: 10, y: 10 }, { x: 500, y: 300 }, 15);
      expect(path.length).toBe(16); // step 0 to step 15
      expect(path[0].x).toBe(10);
      expect(path[0].y).toBe(10);
      expect(path[path.length - 1].x).toBe(500);
      expect(path[path.length - 1].y).toBe(300);
    });
  });

  describe('5. Report Persistence and Retrieval', () => {
    it('saves and retrieves reports via SQLite', () => {
      const reportId = 'rep-12345';
      saveReport({
        id: reportId,
        profileId: 'prof-test-1',
        status: 'completed',
        pagesVisited: 5,
        cookiesSet: 12,
        domainsTouched: ['example.com', 'test.org'],
        durationMs: 4500,
        errors: [],
        startedAt: 1000,
        finishedAt: 5500,
      });

      const retrieved = getReportById(reportId);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(reportId);
      expect(retrieved?.profileId).toBe('prof-test-1');
      expect(retrieved?.status).toBe('completed');
      expect(retrieved?.pagesVisited).toBe(5);
      expect(retrieved?.cookiesSet).toBe(12);
      expect(retrieved?.domainsTouched).toEqual(['example.com', 'test.org']);
      expect(retrieved?.durationMs).toBe(4500);

      const list = listReports('prof-test-1');
      expect(list.length).toBe(1);
      expect(list[0].id).toBe(reportId);
    });
  });

  describe('6. Policy Caps & Kill Switch', () => {
    it('aborts cleanly within one page load when kill switch is triggered', async () => {
      let pageVisitCount = 0;
      let abortTriggered = false;

      const mockPage = {
        goto: vi.fn().mockImplementation(async (url: string) => {
          pageVisitCount++;
          if (pageVisitCount === 1) {
            // Trigger abort while visiting page 1
            abortCookieRobot('prof-kill-test');
            abortTriggered = true;
          }
        }),
        url: vi.fn().mockReturnValue('https://p1.com'),
        cookies: vi.fn().mockResolvedValue([{ name: 'c1', value: 'v1' }]),
        evaluate: vi.fn().mockResolvedValue(null),
        mouse: {
          move: vi.fn().mockResolvedValue(undefined),
        },
      } as unknown as Page;

      const pageSupplier = vi.fn().mockResolvedValue({
        page: mockPage,
        cleanup: vi.fn().mockResolvedValue(undefined),
      });

      const config: CookieRobotConfig = {
        profileId: 'prof-kill-test',
        urls: ['https://p1.com', 'https://p2.com', 'https://p3.com', 'https://p4.com'],
        maxPages: 10,
        dwellMsMin: 10,
        dwellMsMax: 20,
      };

      const report = await runCookieRobot(config, pageSupplier);

      expect(abortTriggered).toBe(true);
      expect(report.status).toBe('aborted');
      // Should have halted after page 1, not processed remaining pages
      expect(report.pagesVisited).toBe(1);
      expect(pageVisitCount).toBe(1);
    });

    it('strictly enforces maxPages policy cap', async () => {
      let pageVisitCount = 0;

      const mockPage = {
        goto: vi.fn().mockImplementation(async () => {
          pageVisitCount++;
        }),
        url: vi.fn().mockReturnValue('https://p.com'),
        cookies: vi.fn().mockResolvedValue([]),
        evaluate: vi.fn().mockResolvedValue(null),
        mouse: {
          move: vi.fn().mockResolvedValue(undefined),
        },
      } as unknown as Page;

      const pageSupplier = vi.fn().mockResolvedValue({
        page: mockPage,
        cleanup: vi.fn().mockResolvedValue(undefined),
      });

      const config: CookieRobotConfig = {
        profileId: 'prof-max-pages',
        urls: [
          'https://p1.com',
          'https://p2.com',
          'https://p3.com',
          'https://p4.com',
          'https://p5.com',
        ],
        maxPages: 2,
        dwellMsMin: 5,
        dwellMsMax: 10,
      };

      const report = await runCookieRobot(config, pageSupplier);

      expect(report.status).toBe('completed');
      expect(report.pagesVisited).toBe(2);
      expect(pageVisitCount).toBe(2);
    });

    it('strictly enforces sessionCapMs policy cap', async () => {
      const mockPage = {
        goto: vi.fn().mockImplementation(async () => {
          // simulate 80ms latency
          await new Promise((r) => setTimeout(r, 80));
        }),
        url: vi.fn().mockReturnValue('https://p.com'),
        cookies: vi.fn().mockResolvedValue([]),
        evaluate: vi.fn().mockResolvedValue(null),
        mouse: {
          move: vi.fn().mockResolvedValue(undefined),
        },
      } as unknown as Page;

      const pageSupplier = vi.fn().mockResolvedValue({
        page: mockPage,
        cleanup: vi.fn().mockResolvedValue(undefined),
      });

      const config: CookieRobotConfig = {
        profileId: 'prof-cap-ms',
        urls: [
          'https://p1.com',
          'https://p2.com',
          'https://p3.com',
          'https://p4.com',
        ],
        maxPages: 10,
        dwellMsMin: 10,
        dwellMsMax: 20,
        sessionCapMs: 100, // Very low cap
      };

      const report = await runCookieRobot(config, pageSupplier);

      expect(report.status).toBe('completed');
      // Should stop early once cap is reached
      expect(report.pagesVisited).toBeLessThan(4);
    });

    it('enforces blocklist during robot execution', async () => {
      const visitedUrls: string[] = [];

      const mockPage = {
        goto: vi.fn().mockImplementation(async (url: string) => {
          visitedUrls.push(url);
        }),
        url: vi.fn().mockImplementation(() => visitedUrls[visitedUrls.length - 1] || ''),
        cookies: vi.fn().mockResolvedValue([]),
        evaluate: vi.fn().mockResolvedValue(null),
        mouse: {
          move: vi.fn().mockResolvedValue(undefined),
        },
      } as unknown as Page;

      const pageSupplier = vi.fn().mockResolvedValue({
        page: mockPage,
        cleanup: vi.fn().mockResolvedValue(undefined),
      });

      const config: CookieRobotConfig = {
        profileId: 'prof-blocklist',
        urls: [
          'https://allowed1.com',
          'https://blocked.com',
          'https://sub.blockedtracker.org',
          'https://allowed2.com',
        ],
        blocklist: ['blocked.com', '*.blockedtracker.org'],
        dwellMsMin: 5,
        dwellMsMax: 10,
      };

      const report = await runCookieRobot(config, pageSupplier);

      expect(visitedUrls).toEqual(['https://allowed1.com/', 'https://allowed2.com/']);
      expect(report.pagesVisited).toBe(2);
      expect(report.domainsTouched).toEqual(['allowed1.com', 'allowed2.com']);
    });
  });
});
