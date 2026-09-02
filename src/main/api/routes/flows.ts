import { Router, Request, Response } from 'express';
import { z } from 'zod';
import {
  FlowDocumentSchema,
  validateFlow,
  listFlows,
  getFlow,
  saveFlow,
  deleteFlow,
  exportFlowJson,
  importFlowJson,
  runFlowViaTaskGroup,
} from '../../flows';

const router = Router();

const runFlowSchema = z.object({
  profile_ids: z.array(z.string()).min(1),
  concurrency: z.number().int().positive().optional(),
  trigger: z.enum(['manual', 'cron']).optional(),
  cron_schedule: z.string().optional(),
});

// GET /api/flows - List all flows
router.get('/api/flows', (_req: Request, res: Response) => {
  try {
    const list = listFlows();
    res.json({ code: 0, msg: 'success', data: { list } });
  } catch (err) {
    res.status(500).json({ code: -1, msg: (err as Error).message, data: {} });
  }
});

// POST /api/flows - Create or update flow
router.post('/api/flows', (req: Request, res: Response) => {
  const parsed = FlowDocumentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      code: -1,
      msg: 'Invalid flow document schema',
      data: { errors: parsed.error.flatten() },
    });
    return;
  }

  const validation = validateFlow(parsed.data);
  if (!validation.valid) {
    res.status(422).json({
      code: 'FLOW_VALIDATION_ERROR',
      msg: 'Flow validation failed',
      data: { errors: validation.errors },
    });
    return;
  }

  try {
    const result = saveFlow(parsed.data);
    res.json({ code: 0, msg: 'success', data: result });
  } catch (err) {
    res.status(500).json({ code: -1, msg: (err as Error).message, data: {} });
  }
});
// PUT /api/flows/:id - Update flow
router.put('/api/flows/:id', (req: Request, res: Response) => {
  const parsed = FlowDocumentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      code: -1,
      msg: 'Invalid flow document schema',
      data: { errors: parsed.error.flatten() },
    });
    return;
  }
  const validation = validateFlow(parsed.data);
  if (!validation.valid) {
    res.status(422).json({
      code: 'FLOW_VALIDATION_ERROR',
      msg: 'Flow validation failed',
      data: { errors: validation.errors },
    });
    return;
  }
  try {
    const saved = saveFlow({ ...parsed.data, id: req.params.id });
    res.json({ code: 0, msg: 'success', data: saved });
  } catch (err) {
    res.status(500).json({ code: -1, msg: (err as Error).message, data: {} });
  }
});

// GET /api/flows/:id - Get flow by id
router.get('/api/flows/:id', (req: Request, res: Response) => {
  try {
    const flow = getFlow(req.params.id);
    if (!flow) {
      res.status(404).json({ code: 'NOT_FOUND', msg: `Flow not found: ${req.params.id}`, data: {} });
      return;
    }
    res.json({ code: 0, msg: 'success', data: { flow } });
  } catch (err) {
    res.status(500).json({ code: -1, msg: (err as Error).message, data: {} });
  }
});

// DELETE /api/flows/:id - Delete flow by id
router.delete('/api/flows/:id', (req: Request, res: Response) => {
  try {
    const deleted = deleteFlow(req.params.id);
    if (!deleted) {
      res.status(404).json({ code: 'NOT_FOUND', msg: `Flow not found: ${req.params.id}`, data: {} });
      return;
    }
    res.json({ code: 0, msg: 'success', data: { id: req.params.id } });
  } catch (err) {
    res.status(500).json({ code: -1, msg: (err as Error).message, data: {} });
  }
});

// POST /api/flows/validate or POST /api/flows/:id/validate - Validate flow
router.post(['/api/flows/validate', '/api/flows/:id/validate'], (req: Request, res: Response) => {
  try {
    let flowToValidate = req.body && Object.keys(req.body).length > 0 ? req.body : null;
    if (!flowToValidate) {
      flowToValidate = getFlow(req.params.id);
      if (!flowToValidate) {
        res.status(404).json({ code: 'NOT_FOUND', msg: `Flow not found: ${req.params.id}`, data: {} });
        return;
      }
    }

    const parsed = FlowDocumentSchema.safeParse(flowToValidate);
    if (!parsed.success) {
      res.json({
        code: 'SCHEMA_INVALID',
        msg: 'Schema validation failed',
        data: { valid: false, errors: parsed.error.flatten() },
      });
      return;
    }

    const validation = validateFlow(parsed.data);
    res.json({
      code: 0,
      msg: validation.valid ? 'success' : 'validation failed',
      data: validation,
    });
  } catch (err) {
    res.status(500).json({ code: -1, msg: (err as Error).message, data: {} });
  }
});

// POST /api/flows/:id/run - Execute flow via task-group
router.post('/api/flows/:id/run', (req: Request, res: Response) => {
  const parsed = runFlowSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: -1, msg: 'Invalid request body', data: { errors: parsed.error.flatten() } });
    return;
  }

  try {
    const result = runFlowViaTaskGroup({
      flowId: req.params.id,
      profileIds: parsed.data.profile_ids,
      concurrency: parsed.data.concurrency,
      trigger: parsed.data.trigger,
      cronSchedule: parsed.data.cron_schedule,
    });
    res.json({ code: 0, msg: 'success', data: result });
  } catch (err) {
    const status = (err as Error).message.includes('not found') ? 404 : 500;
    res.status(status).json({ code: -1, msg: (err as Error).message, data: {} });
  }
});

// GET /api/flows/:id/export - Export flow as JSON
router.get('/api/flows/:id/export', (req: Request, res: Response) => {
  try {
    const jsonStr = exportFlowJson(req.params.id);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="flow-${req.params.id}.json"`);
    res.send(jsonStr);
  } catch (err) {
    const status = (err as Error).message.includes('not found') ? 404 : 500;
    res.status(status).json({ code: -1, msg: (err as Error).message, data: {} });
  }
});

// POST /api/flows/import - Import flow JSON
router.post('/api/flows/import', (req: Request, res: Response) => {
  try {
    const raw = req.body?.document ?? req.body?.flow ?? req.body;
    const imported = importFlowJson(raw);
    res.json({ code: 0, msg: 'success', data: { id: imported.id, flow: imported } });
  } catch (err) {
    res.status(400).json({ code: -1, msg: (err as Error).message, data: {} });
  }
});

export default router;
