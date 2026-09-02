import { Router, Request, Response } from 'express';
import {
  CookieRobotConfig,
  runCookieRobot,
  invokeCookieRobotTask,
  abortCookieRobotRun,
  getReport,
  listReports,
  parseUrlList,
  isDomainBlocked,
  scheduleCookieRobotTaskGroup,
} from '../../scripts/modules/cookieRobot';

const router = Router();

/**
 * POST /api/cookie-robot/run
 * Start a cookie robot warm-up run.
 */
router.post(['/api/cookie-robot/run', '/api/cookie-robot/start'], async (req: Request, res: Response) => {
  const body = req.body as Partial<CookieRobotConfig>;
  if (!body || !body.profileId || !body.urls) {
    return res.status(400).json({
      code: -1,
      msg: 'profileId and urls are required',
      data: {},
    });
  }

  const config: CookieRobotConfig = {
    profileId: String(body.profileId),
    urls: body.urls,
    maxPages: body.maxPages !== undefined ? Number(body.maxPages) : undefined,
    dwellMsMin: body.dwellMsMin !== undefined ? Number(body.dwellMsMin) : undefined,
    dwellMsMax: body.dwellMsMax !== undefined ? Number(body.dwellMsMax) : undefined,
    sessionCapMs: body.sessionCapMs !== undefined ? Number(body.sessionCapMs) : undefined,
    perDomainRateLimitMs: body.perDomainRateLimitMs !== undefined ? Number(body.perDomainRateLimitMs) : undefined,
    blocklist: Array.isArray(body.blocklist) ? body.blocklist.map(String) : undefined,
    headless: body.headless !== undefined ? Boolean(body.headless) : undefined,
    clickInternalLinks: body.clickInternalLinks !== undefined ? Boolean(body.clickInternalLinks) : undefined,
    internalLinkClickProbability: body.internalLinkClickProbability !== undefined ? Number(body.internalLinkClickProbability) : undefined,
  };

  const asyncMode = req.query.async === 'true' || req.body.async === true || req.path.endsWith('/start');

  if (asyncMode) {
    const handle = invokeCookieRobotTask(config);
    return res.json({
      code: 0,
      msg: 'Cookie robot run started in background',
      data: {
        runId: handle.runId,
        taskUuid: handle.taskUuid,
        profileId: config.profileId,
      },
    });
  }

  try {
    const report = await runCookieRobot(config);
    return res.json({
      code: 0,
      msg: 'Cookie robot run finished',
      data: {
        ...report,
        runId: report.id,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({
      code: -1,
      msg: `Cookie robot run failed: ${msg}`,
      data: {},
    });
  }
});

/**
 * POST /api/cookie-robot/abort/:runId
 * Abort a running robot immediately.
 */
router.post(['/api/cookie-robot/abort/:runId', '/api/cookie-robot/stop/:runId'], (req: Request, res: Response) => {
  const runId = String(req.params.runId || '');
  const success = abortCookieRobotRun(runId);
  return res.json({
    code: success ? 0 : -1,
    msg: success ? 'Abort signal sent' : 'Run not found or already completed',
    data: { runId, aborted: success },
  });
});

/**
 * POST /api/cookie-robot/stop and /api/cookie-robot/abort
 * Accepts body with runId or profileId
 */
router.post(['/api/cookie-robot/stop', '/api/cookie-robot/abort'], (req: Request, res: Response) => {
  const runId = req.body?.runId ? String(req.body.runId) : '';
  const profileId = req.body?.profileId ? String(req.body.profileId) : '';
  const idToAbort = runId || profileId;
  const success = abortCookieRobotRun(idToAbort);
  return res.json({
    code: 0,
    msg: success ? 'Abort signal sent' : 'Run not found or already completed',
    data: { runId: idToAbort, stopped: success, aborted: success },
  });
});

/**
 * GET /api/cookie-robot/reports/:id
 * Retrieve a specific run report.
 */
router.get('/api/cookie-robot/reports/:id', (req: Request, res: Response) => {
  const id = String(req.params.id || '');
  const report = getReport(id);
  if (!report) {
    return res.status(404).json({
      code: -1,
      msg: 'Report not found',
      data: {},
    });
  }
  return res.json({
    code: 0,
    msg: 'ok',
    data: report,
  });
});

/**
 * GET /api/cookie-robot/reports
 * Retrieve all reports, optionally filtered by profileId.
 */
router.get('/api/cookie-robot/reports', (req: Request, res: Response) => {
  const profileId = req.query.profileId ? String(req.query.profileId) : undefined;
  const reports = listReports(profileId);
  return res.json({
    code: 0,
    msg: 'ok',
    data: reports,
  });
});

/**
 * POST /api/cookie-robot/schedule
 * Schedule cookie robot runs for a profile set via task-groups.
 */
router.post('/api/cookie-robot/schedule', (req: Request, res: Response) => {
  const body = req.body as {
    name?: string;
    profileIds?: string[];
    config?: Partial<CookieRobotConfig>;
    activeSessionCap?: number;
    perTaskTimeoutMs?: number;
    repeatCount?: number;
    randomizeProfileOrder?: boolean;
    timeWindowCron?: string | null;
  };

  if (!body || !Array.isArray(body.profileIds) || body.profileIds.length === 0) {
    return res.status(400).json({
      code: -1,
      msg: 'profileIds array is required',
      data: {},
    });
  }

  const robotConfig: CookieRobotConfig = {
    profileId: '', // Will be assigned per task
    urls: body.config?.urls || [],
    maxPages: body.config?.maxPages,
    dwellMsMin: body.config?.dwellMsMin,
    dwellMsMax: body.config?.dwellMsMax,
    sessionCapMs: body.config?.sessionCapMs,
    perDomainRateLimitMs: body.config?.perDomainRateLimitMs,
    blocklist: body.config?.blocklist,
    headless: body.config?.headless,
    clickInternalLinks: body.config?.clickInternalLinks,
    internalLinkClickProbability: body.config?.internalLinkClickProbability,
  };

  try {
    const taskGroup = scheduleCookieRobotTaskGroup({
      name: body.name || 'Cookie Robot Warmup',
      profileIds: body.profileIds,
      robotConfig,
      activeSessionCap: body.activeSessionCap,
      perTaskTimeoutMs: body.perTaskTimeoutMs,
      repeatCount: body.repeatCount,
      randomizeProfileOrder: body.randomizeProfileOrder,
      timeWindowCron: body.timeWindowCron,
    });

    return res.json({
      code: 0,
      msg: 'Scheduled cookie robot task group',
      data: { taskGroup },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({
      code: -1,
      msg: `Failed scheduling task group: ${msg}`,
      data: {},
    });
  }
});

export default router;
