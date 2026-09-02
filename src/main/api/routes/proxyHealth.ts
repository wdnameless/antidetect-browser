import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { listProxies, getProxy } from '../../proxy/proxyManager';
import {
  checkProxiesBulk,
  checkSingleProxyHealth,
  getCachedHealth,
  getProfileProxyUsage,
  type ProxyHealthResult,
} from '../../proxy/proxyHealth';

const router = Router();

const checkAllSchema = z
  .object({
    proxyIds: z.array(z.string()).optional(),
    concurrency: z.number().int().positive().optional(),
    timeoutMs: z.number().int().positive().optional(),
    type: z.enum(['http', 'https', 'socks5', 'ssh']).optional(),
  })
  .optional();

/**
 * POST /api/proxies/check-all
 * Runs bounded-concurrency health check across proxies (optionally filtered)
 */
router.post('/api/proxies/check-all', async (req: Request, res: Response) => {
  const parsed = checkAllSchema.safeParse(req.body);
  if (!parsed.success) {
    res.json({ code: -1, msg: 'invalid body', data: { errors: parsed.error.flatten() } });
    return;
  }

  try {
    const filters = parsed.data || {};
    let proxies = listProxies();

    if (filters.type) {
      proxies = proxies.filter((p) => p.type === filters.type);
    }
    if (filters.proxyIds && filters.proxyIds.length > 0) {
      const idSet = new Set(filters.proxyIds);
      proxies = proxies.filter((p) => idSet.has(p.id));
    }

    const results = await checkProxiesBulk(proxies, {
      concurrency: filters.concurrency ?? 100,
      timeoutMs: filters.timeoutMs ?? 10000,
    });

    res.json({
      code: 0,
      msg: 'success',
      data: {
        total: results.length,
        healthy: results.filter((r) => r.status === 'healthy').length,
        unhealthy: results.filter((r) => r.status === 'unhealthy').length,
        dead: results.filter((r) => r.status === 'dead').length,
        results,
      },
    });
  } catch (err) {
    res.json({ code: -1, msg: (err as Error).message, data: {} });
  }
});

/**
 * GET /api/proxies/:id/health
 * Returns cached or fresh health check for a proxy
 */
router.get('/api/proxies/:id/health', async (req: Request, res: Response) => {
  const { id } = req.params;
  const proxy = getProxy(id);
  if (!proxy) {
    res.json({ code: -1, msg: 'proxy not found', data: {} });
    return;
  }

  try {
    const forceFresh = req.query.fresh === 'true' || req.query.fresh === '1';
    let health: ProxyHealthResult | undefined = forceFresh ? undefined : getCachedHealth(id);

    if (!health) {
      health = await checkSingleProxyHealth(proxy);
    }

    res.json({
      code: 0,
      msg: 'success',
      data: health,
    });
  } catch (err) {
    res.json({ code: -1, msg: (err as Error).message, data: {} });
  }
});

/**
 * GET /api/profiles/:id/proxy-usage
 * Returns proxy usage history and drift warning for a profile
 */
router.get('/api/profiles/:id/proxy-usage', (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const usage = getProfileProxyUsage(id);
    res.json({
      code: 0,
      msg: 'success',
      data: usage,
    });
  } catch (err) {
    res.json({ code: -1, msg: (err as Error).message, data: {} });
  }
});

export default router;
