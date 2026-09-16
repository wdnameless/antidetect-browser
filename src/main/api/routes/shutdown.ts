// Graceful shutdown over the authenticated HTTP API.
//
// The desktop shell has to stop this backend when it exits. It could simply kill the
// process tree, but that skips everything `shutdown()` does: stopping the browser
// profiles, flushing and closing the database, and releasing the instance lock. On
// Windows the shell cannot send SIGTERM (which is what `src/main/index.ts` listens for),
// so without this route every shell exit would leave orphaned Chromium profiles, a
// possibly unflushed SQLite file, and a stale `service.lock` that the next launch
// misreads as a crash. Electron avoided that by doing the same work in `before-quit`,
// in-process.
import { Router, Request, Response } from 'express';
import { shutdown } from '../../index';

export const shutdownRouter = Router();

// POST /api/v1/shutdown
shutdownRouter.post('/', (_req: Request, res: Response) => {
  res.json({ code: 0, msg: 'success', data: { ok: true } });
  // Answer first, then exit: `shutdown()` terminates the process, so calling it before
  // the response is flushed would hand the caller a dead socket and an ambiguous result.
  setImmediate(() => {
    void shutdown('shell-exit');
  });
});
