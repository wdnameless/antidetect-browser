import { Router, Request, Response } from 'express';
import { z } from 'zod';
import {
  createTaskGroup,
  getTaskGroup,
  listTaskGroups,
  getGroupTasks,
  getTaskLogs,
  getTaskByUuid,
} from '../../scripts/taskGroups';
import { getTaskQueueCoordinator } from '../../scripts/taskQueue';

const router = Router();

const createTaskGroupSchema = z.object({
  name: z.string().min(1).max(200),
  script_id: z.string().min(1),
  profile_ids: z.array(z.string().min(1)).min(1),
  active_session_cap: z.number().int().min(1).optional(),
  per_task_timeout_ms: z.number().int().min(1000).optional(),
  repeat_count: z.number().int().min(0).optional(),
  randomize_profile_order: z.boolean().optional(),
  time_window_cron: z.string().max(64).nullable().optional(),
});

// POST /api/task-groups - Create a new task group
router.post('/api/task-groups', (req: Request, res: Response) => {
  const parsed = createTaskGroupSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: 'INVALID_INPUT', msg: 'invalid task group parameters', data: {} });
    return;
  }

  try {
    const group = createTaskGroup({
      name: parsed.data.name,
      script_id: parsed.data.script_id,
      profile_ids: parsed.data.profile_ids,
      active_session_cap: parsed.data.active_session_cap,
      per_task_timeout_ms: parsed.data.per_task_timeout_ms,
      repeat_count: parsed.data.repeat_count,
      randomize_profile_order: parsed.data.randomize_profile_order,
      time_window_cron: parsed.data.time_window_cron,
    });
    res.json({ code: 0, msg: 'success', data: group });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ code: -1, msg, data: {} });
  }
});

// GET /api/task-groups - List task groups
router.get('/api/task-groups', (_req: Request, res: Response) => {
  try {
    const list = listTaskGroups();
    res.json({ code: 0, msg: 'success', data: { list } });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ code: -1, msg, data: {} });
  }
});

// GET /api/task-groups/:id - Get task group by ID
router.get('/api/task-groups/:id', (req: Request, res: Response) => {
  try {
    const group = getTaskGroup(String(req.params.id));
    if (!group) {
      res.status(404).json({ code: 'NOT_FOUND', msg: 'task group not found', data: {} });
      return;
    }
    res.json({ code: 0, msg: 'success', data: group });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ code: -1, msg, data: {} });
  }
});

// POST /api/task-groups/:id/start - Start or resume a task group
router.post('/api/task-groups/:id/start', async (req: Request, res: Response) => {
  const groupId = String(req.params.id);
  const group = getTaskGroup(groupId);
  if (!group) {
    res.status(404).json({ code: 'NOT_FOUND', msg: 'task group not found', data: {} });
    return;
  }

  try {
    const coordinator = getTaskQueueCoordinator();
    await coordinator.startGroup(groupId);
    res.json({ code: 0, msg: 'success', data: { status: 'working' } });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ code: -1, msg, data: {} });
  }
});

// POST /api/task-groups/:id/stop - Gracefully stop a task group
router.post('/api/task-groups/:id/stop', async (req: Request, res: Response) => {
  const groupId = String(req.params.id);
  const group = getTaskGroup(groupId);
  if (!group) {
    res.status(404).json({ code: 'NOT_FOUND', msg: 'task group not found', data: {} });
    return;
  }

  try {
    const coordinator = getTaskQueueCoordinator();
    await coordinator.stopGroup(groupId);
    res.json({ code: 0, msg: 'success', data: { status: 'stop' } });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ code: -1, msg, data: {} });
  }
});

// GET /api/task-groups/:id/tasks - List tasks for a task group
router.get('/api/task-groups/:id/tasks', (req: Request, res: Response) => {
  const groupId = String(req.params.id);
  const group = getTaskGroup(groupId);
  if (!group) {
    res.status(404).json({ code: 'NOT_FOUND', msg: 'task group not found', data: {} });
    return;
  }

  try {
    const tasks = getGroupTasks(groupId);
    res.json({ code: 0, msg: 'success', data: { list: tasks } });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ code: -1, msg, data: {} });
  }
});

// GET /api/tasks/:uuid/logs - Stream or get logs for a task
router.get('/api/tasks/:uuid/logs', (req: Request, res: Response) => {
  const uuid = String(req.params.uuid);
  const task = getTaskByUuid(uuid);
  if (!task) {
    res.status(404).json({ code: 'NOT_FOUND', msg: 'task not found', data: {} });
    return;
  }

  const isStream = req.query.stream !== 'false' || req.headers.accept?.includes('text/event-stream');

  if (!isStream) {
    const logs = getTaskLogs(uuid);
    res.json({ code: 0, msg: 'success', data: { list: logs } });
    return;
  }

  // SSE streaming
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  // Replay existing logs
  const existingLogs = getTaskLogs(uuid);
  for (const l of existingLogs) {
    res.write(`data: ${JSON.stringify(l)}\n\n`);
  }

  // If task is already terminal, close stream
  if (['finished', 'error', 'stop'].includes(task.status)) {
    res.write(`data: ${JSON.stringify({ event: 'end', status: task.status })}\n\n`);
    res.end();
    return;
  }

  const coordinator = getTaskQueueCoordinator();
  const subscription = coordinator.subscribeLogs(uuid);

  const logHandler = (line: string) => {
    res.write(`data: ${JSON.stringify({ line, created_at: Date.now() })}\n\n`);
  };

  const doneHandler = () => {
    res.write(`data: ${JSON.stringify({ event: 'end', status: 'finished' })}\n\n`);
    res.end();
  };

  const errorHandler = (err: unknown) => {
    res.write(`data: ${JSON.stringify({ event: 'end', status: 'error', error: err })}\n\n`);
    res.end();
  };

  subscription.emitter.on('log', logHandler);
  subscription.emitter.once('done', doneHandler);
  subscription.emitter.once('error', errorHandler);

  req.on('close', () => {
    subscription.unsubscribe();
  });
});

export default router;
