import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { Express, Request, Response } from 'express';
import preflightRoutes from '../../../src/main/api/routes/preflight';
import * as pm from '../../../src/main/profiles/profileManager';
import * as preflightService from '../../../src/main/preflight/preflightService';
import * as chromium from '../../../src/main/launcher/chromium';
import { clearLastVerdicts, storeVerdict } from '../../../src/main/preflight/store';
import type { Profile } from '../../../src/main/profiles/profileManager';
import type { LaunchConfig } from '../../../src/main/profiles/profileManager';
vi.mock('../../../src/main/profiles/profileManager', () => ({
  getProfile: vi.fn(),
  resolveLaunchConfig: vi.fn(),
  setStatus: vi.fn(),
}));

vi.mock('../../../src/main/launcher/chromium', () => ({
  startProfile: vi.fn(),
  getCdpEndpoint: vi.fn(),
}));

vi.mock('../../../src/main/launcher/firefox', () => ({
  startFirefox: vi.fn(),
}));

vi.mock('../../../src/main/preflight/preflightService', async () => {
  const actual = await vi.importActual<typeof preflightService>(
    '../../../src/main/preflight/preflightService'
  );
  return {
    ...actual,
    runPreflight: vi.fn(),
    blockOnFailLaunchGuard: vi.fn(),
  };
});

describe('Preflight Routes API Integration Tests', () => {
  let app: Express;

  beforeEach(() => {
    vi.clearAllMocks();
    clearLastVerdicts();
    app = express();
    app.use(express.json());
    app.use(preflightRoutes);
  });

  it('POST /api/profiles/:id/preflight returns 404 if profile not found', async () => {
    vi.mocked(pm.getProfile).mockReturnValueOnce(null);

    const req = {
      params: { id: 'missing-id' },
    };

    // Simulate express call
    const res: any = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    // Use supertest or manual router handle
    // Let's test endpoints through simple mock dispatch
    const routes = (preflightRoutes as any).stack;
    const postRoute = routes.find(
      (r: any) => r.route && r.route.path === '/api/profiles/:id/preflight' && r.route.methods.post
    );
    expect(postRoute).toBeDefined();

    await postRoute.route.stack[0].handle(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('POST /api/profiles/:id/preflight executes preflight and stores verdict', async () => {
    vi.mocked(pm.getProfile).mockReturnValueOnce({ id: 'p1' } as any);
    const mockVerdict = {
      profileId: 'p1',
      timestamp: 123456,
      overall: 'pass' as const,
      passed: true,
      checks: {} as any,
      checkList: [],
    };
    vi.mocked(preflightService.runPreflight).mockResolvedValueOnce(mockVerdict);

    const req = { params: { id: 'p1' } };
    const res: any = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
    };

    const routes = (preflightRoutes as any).stack;
    const postRoute = routes.find(
      (r: any) => r.route && r.route.path === '/api/profiles/:id/preflight' && r.route.methods.post
    );
    await postRoute.route.stack[0].handle(req, res);

    expect(res.json).toHaveBeenCalledWith({
      code: 0,
      msg: 'success',
      data: mockVerdict,
    });
  });

  it('GET /api/profiles/:id/preflight/last returns 404 when no verdict exists', async () => {
    const req = { params: { id: 'p-none' } };
    const res: any = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    const routes = (preflightRoutes as any).stack;
    const getRoute = routes.find(
      (r: any) => r.route && r.route.path === '/api/profiles/:id/preflight/last' && r.route.methods.get
    );
    getRoute.route.stack[0].handle(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('GET /api/profiles/:id/preflight/last returns stored verdict', async () => {
    const verdict = {
      profileId: 'p-saved',
      timestamp: 99999,
      overall: 'warn' as const,
      passed: true,
      checks: {} as any,
      checkList: [],
    };
    storeVerdict(verdict);

    const req = { params: { id: 'p-saved' } };
    const res: any = {
      json: vi.fn(),
    };

    const routes = (preflightRoutes as any).stack;
    const getRoute = routes.find(
      (r: any) => r.route && r.route.path === '/api/profiles/:id/preflight/last' && r.route.methods.get
    );
    getRoute.route.stack[0].handle(req, res);

    expect(res.json).toHaveBeenCalledWith({
      code: 0,
      msg: 'success',
      data: verdict,
    });
  });

  it('POST /api/profiles/:id/start-with-preflight blocks launch when overall verdict is fail', async () => {
    vi.mocked(preflightService.blockOnFailLaunchGuard).mockResolvedValueOnce({
      allowed: false,
      verdict: {
        profileId: 'p-fail',
        overall: 'fail',
        passed: false,
        timestamp: 123,
        checks: {} as any,
        checkList: [],
      },
    });

    const req = {
      params: { id: 'p-fail' },
      body: { blockOnFail: true },
      query: {},
    };
    const res: any = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    const routes = (preflightRoutes as any).stack;
    const startRoute = routes.find(
      (r: any) => r.route && r.route.path === '/api/profiles/:id/start-with-preflight' && r.route.methods.post
    );
    await startRoute.route.stack[0].handle(req, res);

    expect(res.status).toHaveBeenCalledWith(412);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: -1,
        msg: 'Launch blocked by preflight failure',
      })
    );
  });

  it('POST /api/profiles/:id/start-with-preflight with autoStart=false (default) does not spawn browser', async () => {
    const req = {
      params: { id: 'p-default' },
      body: {},
      query: {},
    } as unknown as Request;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response;

    const routes = (preflightRoutes as unknown as { stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: (req: Request, res: Response) => Promise<void> }> } }> }).stack;
    const startRoute = routes.find(
      (r) => r.route && r.route.path === '/api/profiles/:id/start-with-preflight' && r.route.methods.post
    );
    await startRoute?.route?.stack[0].handle(req, res);

    expect(chromium.startProfile).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 0,
        msg: 'Preflight launch guard passed',
        data: expect.objectContaining({
          profileId: 'p-default',
          allowed: true,
        }),
      })
    );
  });

  it('POST /api/profiles/:id/start-with-preflight with autoStart=true spawns launcher and returns merged payload on pass', async () => {
    vi.mocked(pm.getProfile).mockReturnValueOnce({
      user_id: 'p-pass',
      name: 'Test Profile',
    } as unknown as Profile);
    vi.mocked(pm.resolveLaunchConfig).mockReturnValueOnce({
      profileId: 'p-pass',
      browserType: 'chromium',
      headless: false,
    } as unknown as LaunchConfig);
    vi.mocked(chromium.startProfile).mockResolvedValueOnce({
      ws: {
        puppeteer: 'ws://127.0.0.1:9222/devtools/browser/abc-123',
        selenium: 'http://127.0.0.1:9222',
      },
      debug_port: '9222',
      webdriver: 'http://127.0.0.1:9222',
      pid: 12345,
    });
    vi.mocked(preflightService.blockOnFailLaunchGuard).mockResolvedValueOnce({
      allowed: true,
      verdict: {
        profileId: 'p-pass',
        overall: 'pass',
        passed: true,
        timestamp: 456,
        checks: {} as unknown as preflightService.PreflightVerdict['checks'],
        checkList: [],
      },
    });

    const req = {
      params: { id: 'p-pass' },
      body: { blockOnFail: true, autoStart: true },
      query: {},
      headers: {},
    } as unknown as Request;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response;

    const routes = (preflightRoutes as unknown as { stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: (req: Request, res: Response) => Promise<void> }> } }> }).stack;
    const startRoute = routes.find(
      (r) => r.route && r.route.path === '/api/profiles/:id/start-with-preflight' && r.route.methods.post
    );
    await startRoute?.route?.stack[0].handle(req, res);

    expect(chromium.startProfile).toHaveBeenCalledWith(
      expect.objectContaining({ profileId: 'p-pass' })
    );
    expect(pm.setStatus).toHaveBeenCalledWith('p-pass', 'running');
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 0,
        msg: 'success',
        data: expect.objectContaining({
          profileId: 'p-pass',
          allowed: true,
          wsEndpoint: 'ws://127.0.0.1:9222/devtools/browser/abc-123',
          debug_port: '9222',
          verdict: expect.objectContaining({
            profileId: 'p-pass',
            overall: 'pass',
          }),
        }),
      })
    );
  });

  it('POST /api/profiles/:id/start-with-preflight with autoStart=true returns 412 and does NOT spawn on preflight fail', async () => {
    vi.mocked(pm.getProfile).mockReturnValueOnce({
      user_id: 'p-fail-auto',
      name: 'Failing Profile',
    } as unknown as Profile);
    vi.mocked(preflightService.blockOnFailLaunchGuard).mockResolvedValueOnce({
      allowed: false,
      verdict: {
        profileId: 'p-fail-auto',
        overall: 'fail',
        passed: false,
        timestamp: 789,
        checks: {} as unknown as preflightService.PreflightVerdict['checks'],
        checkList: [],
      },
    });

    const req = {
      params: { id: 'p-fail-auto' },
      body: { blockOnFail: true, autoStart: true },
      query: {},
      headers: {},
    } as unknown as Request;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response;

    const routes = (preflightRoutes as unknown as { stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: (req: Request, res: Response) => Promise<void> }> } }> }).stack;
    const startRoute = routes.find(
      (r) => r.route && r.route.path === '/api/profiles/:id/start-with-preflight' && r.route.methods.post
    );
    await startRoute?.route?.stack[0].handle(req, res);

    expect(chromium.startProfile).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(412);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: -1,
        msg: 'Launch blocked by preflight failure',
        data: expect.objectContaining({
          profileId: 'p-fail-auto',
          overall: 'fail',
        }),
      })
    );
  });

  it('POST /api/profiles/:id/start-with-preflight with autoStart=true fails when overall verdict is fail even without blockOnFail flag', async () => {
    vi.mocked(pm.getProfile).mockReturnValueOnce({
      user_id: 'p-fail-noflag',
      name: 'Failing Profile',
    } as unknown as Profile);
    vi.mocked(preflightService.runPreflight).mockResolvedValueOnce({
      profileId: 'p-fail-noflag',
      overall: 'fail',
      passed: false,
      timestamp: 789,
      checks: {} as unknown as preflightService.PreflightVerdict['checks'],
      checkList: [],
    });

    const req = {
      params: { id: 'p-fail-noflag' },
      body: { autoStart: true },
      query: {},
      headers: {},
    } as unknown as Request;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response;

    const routes = (preflightRoutes as unknown as { stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: (req: Request, res: Response) => Promise<void> }> } }> }).stack;
    const startRoute = routes.find(
      (r) => r.route && r.route.path === '/api/profiles/:id/start-with-preflight' && r.route.methods.post
    );
    await startRoute?.route?.stack[0].handle(req, res);

    expect(chromium.startProfile).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(412);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: -1,
        msg: 'Launch blocked by preflight failure',
        data: expect.objectContaining({
          profileId: 'p-fail-noflag',
          overall: 'fail',
        }),
      })
    );
  });

  it('POST /api/profiles/:id/start-with-preflight with autoStart=true returns 404 if profile not found', async () => {
    vi.mocked(pm.getProfile).mockReturnValueOnce(null);

    const req = {
      params: { id: 'p-nonexistent' },
      body: { autoStart: true },
      query: {},
    } as unknown as Request;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response;

    const routes = (preflightRoutes as unknown as { stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: (req: Request, res: Response) => Promise<void> }> } }> }).stack;
    const startRoute = routes.find(
      (r) => r.route && r.route.path === '/api/profiles/:id/start-with-preflight' && r.route.methods.post
    );
    await startRoute?.route?.stack[0].handle(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: -1,
        msg: 'profile not found',
      })
    );
  });
});
