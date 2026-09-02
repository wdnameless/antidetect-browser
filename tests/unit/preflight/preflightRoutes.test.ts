import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { Express } from 'express';
import preflightRoutes from '../../../src/main/api/routes/preflight';
import * as pm from '../../../src/main/profiles/profileManager';
import * as preflightService from '../../../src/main/preflight/preflightService';
import { clearLastVerdicts, storeVerdict } from '../../../src/main/preflight/store';

vi.mock('../../../src/main/profiles/profileManager', () => ({
  getProfile: vi.fn(),
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
});
