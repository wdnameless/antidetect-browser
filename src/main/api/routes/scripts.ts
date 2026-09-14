// Scripts API (Sprint 4.1): CRUD, async run, run history.
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import * as engine from '../../scripts/scriptEngine';

const router = Router();

router.get('/api/v1/scripts', (_req: Request, res: Response) => {
  res.json({ code: 0, msg: 'success', data: { list: engine.listScripts() } });
});

router.get('/api/v1/scripts/:id', (req: Request, res: Response) => {
  const s = engine.getScript(String(req.params.id));
  if (!s) {
    res.status(404).json({ code: 'NOT_FOUND', msg: 'script not found', data: {} });
    return;
  }
  res.json({ code: 0, msg: 'success', data: s });
});

router.post('/api/v1/scripts', (req: Request, res: Response) => {
  const parsed = z
    .object({ name: z.string().min(1).max(200), code: z.string().min(1).max(1_000_000) })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: 'INVALID_INPUT', msg: 'name and code are required', data: {} });
    return;
  }
  const created = engine.createScript(parsed.data.name, parsed.data.code);
  res.json({ code: 0, msg: 'success', data: created });
});

router.post('/api/v1/scripts/:id/update', (req: Request, res: Response) => {
  const parsed = z
    .object({ name: z.string().min(1).max(200).optional(), code: z.string().min(1).max(1_000_000).optional() })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: 'INVALID_INPUT', msg: 'invalid body', data: {} });
    return;
  }
  const ok = engine.updateScript(String(req.params.id), { name: parsed.data.name, code: parsed.data.code });
  res.json(ok ? { code: 0, msg: 'success', data: {} } : { code: -1, msg: 'update failed', data: {} });
});

router.post('/api/v1/scripts/:id/delete', (req: Request, res: Response) => {
  const ok = engine.deleteScript(String(req.params.id));
  res.json(
    ok ? { code: 0, msg: 'success', data: {} } : { code: -1, msg: 'script not found', data: {} }
  );
});

router.post('/api/v1/scripts/:id/run', (req: Request, res: Response) => {
  const parsed = z
    .object({ profile_ids: z.array(z.string()).max(500).default([]) })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: 'INVALID_INPUT', msg: 'profile_ids must be an array', data: {} });
    return;
  }
  try {
    const handle = engine.runScript(String(req.params.id), parsed.data.profile_ids);
    res.json({ code: 0, msg: 'success', data: handle });
  } catch (err) {
    res.status(404).json({ code: 'NOT_FOUND', msg: (err as Error).message, data: {} });
  }
});

router.get('/api/v1/scripts/:id/runs', (req: Request, res: Response) => {
  try {
    res.json({ code: 0, msg: 'success', data: { list: engine.listRuns(String(req.params.id)) } });
  } catch (err) {
    res.json({ code: -1, msg: (err as Error).message, data: {} });
  }
});

router.post('/api/v1/scripts/:id/invoke', async (req: Request, res: Response) => {
  const scriptId = String(req.params.id);
  const script = engine.getScript(scriptId);
  if (!script) {
    res.status(404).json({ code: 'NOT_FOUND', msg: `script not found: ${scriptId}`, data: {} });
    return;
  }

  const body = (req.body ?? {}) as { args?: unknown; profile_id?: unknown };
  const args =
    body.args && typeof body.args === 'object' && !Array.isArray(body.args)
      ? (body.args as Record<string, unknown>)
      : {};
  // `profileId` is required by the sandbox: it is what app.profileId reports to the
  // script. `keyValues` is not an option — the engine preloads keys itself.
  const profileId =
    typeof body.profile_id === 'string' && body.profile_id
      ? body.profile_id
      : typeof args.profile_id === 'string'
        ? (args.profile_id as string)
        : '';
  if (!profileId) {
    res.status(400).json({
      code: 'PROFILE_ID_REQUIRED',
      msg: 'profile_id is required (the sandbox exposes it as app.profileId)',
      data: {},
    });
    return;
  }

  let handle: engine.TaskInvocationHandle;
  try {
    handle = engine.invokeScriptTask({ scriptId, profileId });
  } catch (err) {
    res.status(500).json({ code: 'INVOKE_FAILED', msg: (err as Error).message, data: {} });
    return;
  }

  let settled = false;
  handle.logStream.on('done', ({ result, logs }: { result?: unknown; logs: string[] }) => {
    if (settled) return;
    settled = true;
    res.json({ code: 0, msg: 'success', data: { result, logs } });
  });

  handle.logStream.on('error', ({ error, logs }: { error: string; logs: string[] }) => {
    if (settled) return;
    settled = true;
    res.status(500).json({ code: 'TASK_ERROR', msg: error, data: { logs } });
  });
});

export default router;