// Data-directory management over the authenticated HTTP API.
//
// These endpoints are the Tauri shell's replacement for the `data:*` IPC handlers that
// used to live in `electron/main.ts`. That logic could not stay in the shell: relocating
// the data directory has to stop the launchers and re-open the database, and both of
// those live in the backend.
//
// Folder *selection* stays in the shell — a native folder chooser is not an HTTP concern.
// The shell opens the dialog and hands the chosen path here.
import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import {
  getDataDir,
  setDataDir,
  needsFirstRunDataChoice,
  defaultDataDir,
  setFirstRunDataChoice,
  isUsableDataDir,
  isPortableMode,
  dataDirCollidesWithSettings,
} from '../../config';
import { stopAll } from '../../launcher/chromium';
import { flushDb, closeDb, initDb } from '../../db';
import { seedDevices } from '../../devices/deviceManager';

export const dataDirRouter = Router();

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// GET /api/v1/data/dir — the directory currently in effect.
dataDirRouter.get('/dir', (_req: Request, res: Response) => {
  res.json({ code: 0, msg: 'success', data: { dir: getDataDir() } });
});

/**
 * GET /api/v1/data/first-run — does this launch need the operator to choose a folder?
 *
 * The UI asks once, on the first start, and this is the single source of truth for whether
 * that prompt is due: the rule lives in `config.ts` next to the resolution order it feeds, so
 * the backend and the UI cannot drift apart about when data is already located.
 */
dataDirRouter.get('/first-run', (_req: Request, res: Response) => {
  res.json({
    code: 0,
    msg: 'success',
    data: {
      needed: needsFirstRunDataChoice(),
      defaultDir: defaultDataDir(),
      currentDir: getDataDir(),
      portable: isPortableMode(),
    },
  });
});

/**
 * POST /api/v1/data/first-run { dir?, mode? } — record the choice.
 *
 * Applies on the NEXT start: `DATA_DIR` is resolved once at import time, and moving a live
 * database underneath a running service is not something to do silently. The response says
 * so, and the UI offers to restart.
 */
dataDirRouter.post('/first-run', (req: Request, res: Response) => {
  const dir = typeof req.body?.dir === 'string' ? req.body.dir.trim() : '';
  const mode = req.body?.mode === 'portable' || req.body?.mode === 'system' ? req.body.mode : undefined;

  if (!dir && !mode) {
    res.json({ code: -1, msg: 'either dir or mode is required', data: { ok: false, error: 'either dir or mode is required' } });
    return;
  }

  if (dir) {
    if (dataDirCollidesWithSettings(dir)) {
      res.json({ code: -1, msg: 'that path is the application settings file', data: { ok: false, dir, error: 'that path is the application settings file' } });
      return;
    }
    const check = isUsableDataDir(dir);
    if (!check.ok) {
      // Reject at the moment of choosing rather than failing later with a database error.
      res.json({ code: -1, msg: check.error ?? 'folder is not usable', data: { ok: false, dir, error: check.error ?? 'folder is not usable' } });
      return;
    }
  }

  // Persist and report the truth: a swallowed write failure would send the operator into a
  // restart that silently resolves to the default folder.
  const written = setFirstRunDataChoice({ dir: dir || null, mode });
  if (!written.ok) {
    res.json({ code: -1, msg: written.error ?? 'could not save the choice', data: { ok: false, error: written.error } });
    return;
  }
  res.json({ code: 0, msg: 'success', data: { ok: true, dir: dir || defaultDataDir(), restartRequired: true } });
});

/**
 * POST /api/v1/data/first-run/check { dir } — is this folder usable?
 *
 * Used by the prompt while the operator types or browses, so a bad choice is visible before
 * it is committed. Unlike `/check-dir` this does NOT require an existing database: on a
 * genuinely fresh install there is none yet.
 */
dataDirRouter.post('/first-run/check', (req: Request, res: Response) => {
  const dir = typeof req.body?.dir === 'string' ? req.body.dir.trim() : '';
  if (!dir) {
    res.json({ code: -1, msg: 'dir is required', data: { ok: false, error: 'dir is required' } });
    return;
  }
  // `create: false` — this runs on every blur while the operator types, and creating the
  // path as a side effect turned a mistyped `.../settings.json` into a directory that then
  // blocked writing the real settings file.
  if (dataDirCollidesWithSettings(dir)) {
    res.json({ code: 0, msg: 'success', data: { dir: path.resolve(dir), ok: false, error: 'that path is the application settings file' } });
    return;
  }
  res.json({ code: 0, msg: 'success', data: { dir: path.resolve(dir), ...isUsableDataDir(dir, { create: false }) } });
});

// POST /api/v1/data/dir { dir } — persist a directory. Applies on the next start, because
// the backend resolves DATA_DIR at import time (see config.ts).
dataDirRouter.post('/dir', (req: Request, res: Response) => {
  const dir = typeof req.body?.dir === 'string' ? req.body.dir.trim() : '';
  if (!dir) {
    res.json({ code: -1, msg: 'dir is required', data: { ok: false, dir: getDataDir() } });
    return;
  }
  const resolved = path.resolve(dir);
  try {
    fs.mkdirSync(resolved, { recursive: true });
    setDataDir(resolved);
    res.json({ code: 0, msg: 'success', data: { ok: true, dir: resolved } });
  } catch (err: unknown) {
    res.json({ code: -1, msg: getErrorMessage(err), data: { ok: false, dir: getDataDir() } });
  }
});

// POST /api/v1/data/check-dir { dir } — is this a usable data directory?
dataDirRouter.post('/check-dir', (req: Request, res: Response) => {
  const dir = typeof req.body?.dir === 'string' ? req.body.dir.trim() : '';
  if (!dir) {
    res.json({ code: -1, msg: 'dir is required', data: { ok: false, dir: getDataDir() } });
    return;
  }
  const resolved = path.resolve(dir);
  // A directory is usable when it is writable AND already holds the database — the same
  // rule the old `data:set-dir-path` handler applied, so an accidental empty folder is not
  // adopted as the data root.
  let usable = false;
  try {
    if (fs.existsSync(resolved)) {
      fs.accessSync(resolved, fs.constants.W_OK);
      usable = fs.existsSync(path.join(resolved, 'antidetect.db'));
    }
  } catch {
    usable = false;
  }
  res.json({ code: 0, msg: 'success', data: { ok: usable, dir: resolved } });
});

// POST /api/v1/data/migrate { target, migrateData } — stop browsers, copy, persist.
//
// Order matters and mirrors the old IPC handler exactly: the launchers must stop and the
// DB must be closed *before* the copy, or the copy captures a half-written database.
// The DB is re-opened in `finally` so a failed migration still leaves the app running
// against the OLD directory rather than with a dead database handle.
dataDirRouter.post('/migrate', async (req: Request, res: Response) => {
  const target = typeof req.body?.target === 'string' ? req.body.target.trim() : '';
  const migrateData = req.body?.migrateData !== false;
  const oldDir = getDataDir();

  if (!target || path.resolve(target) === path.resolve(oldDir)) {
    res.json({ code: -1, msg: 'same or invalid folder', data: { ok: false, dir: oldDir } });
    return;
  }
  const dest = path.resolve(target);

  try {
    await stopAll();
    flushDb();
    closeDb(); // release file handles so the copy is consistent

    try {
      await fs.promises.mkdir(dest, { recursive: true });
      if (migrateData) {
        await fs.promises.cp(oldDir, dest, {
          recursive: true,
          force: false, // never overwrite anything already in the target
          errorOnExist: false,
          filter: (src) => {
            const base = path.basename(src);
            return !base.endsWith('.tmp') && base !== 'service.lock' && !base.endsWith('.restore-tmp');
          },
        });
      }
      setDataDir(dest);
    } finally {
      // Re-open at the OLD location so the app keeps working until restart.
      await initDb();
      seedDevices();
    }

    res.json({ code: 0, msg: 'success', data: { ok: true, dir: dest, migrated: migrateData } });
  } catch (err: unknown) {
    // Make sure the DB is usable again at the old location after any failure.
    try {
      await initDb();
      seedDevices();
    } catch {
      // ignore — the original error is the one worth reporting
    }
    res.json({ code: -1, msg: getErrorMessage(err), data: { ok: false, dir: oldDir } });
  }
});
