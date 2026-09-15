import { Router } from 'express';
import { checkKernelUpdate, getInstalledKernelVersion } from '../../util/kernelUpdate';
import { ensureKernel, PINNED_KERNEL_VERSION, KernelAcquireError } from '../../util/kernelAcquire';
import { logger } from '../../util/logger';

const router = Router();

// GET /api/v1/kernel/info — installed kernel version (no network).
router.get('/api/v1/kernel/info', (_req, res) => {
  res.json({ code: 0, msg: 'success', data: { installed: getInstalledKernelVersion() } });
});

// GET /api/v1/kernel/check-update — compare with the upstream GitHub release.
router.get('/api/v1/kernel/check-update', async (_req, res) => {
  const info = await checkKernelUpdate();
  res.json({ code: 0, msg: 'success', data: info });
});

/**
 * Download state for the one-time kernel install.
 *
 * The kernel is ~425 MB of patched Chromium and is deliberately NOT bundled (the artefact
 * would be enormous, and the upstream asset is SHA-256 pinned). It was previously fetched
 * only by `scripts/ensure-kernel.mjs` at BUILD time, so a machine that ran the shipped
 * artefact had no kernel at all and every profile launch failed with "browser not found" —
 * with nothing in the UI explaining why or offering a way out.
 */
interface KernelInstallState {
  status: 'idle' | 'downloading' | 'verifying' | 'done' | 'error';
  received: number;
  total: number;
  error?: string;
}

let installState: KernelInstallState = { status: 'idle', received: 0, total: 0 };
let inflight: Promise<void> | null = null;

/** GET /api/v1/kernel/status — current install progress. */
router.get('/api/v1/kernel/status', (_req, res) => {
  res.json({
    code: 0,
    msg: 'success',
    data: {
      ...installState,
      installed: getInstalledKernelVersion(),
      pinned: PINNED_KERNEL_VERSION,
      installing: inflight !== null,
    },
  });
});

/**
 * POST /api/v1/kernel/install — download and verify the kernel if it is missing.
 *
 * Idempotent: a second call while a download is running joins the existing one rather than
 * starting a parallel 425 MB transfer, and a call when the kernel already exists returns
 * immediately. Verification is the whole point of this path — `ensureKernel` checks the
 * pinned SHA-256 and refuses a mismatch, so a corrupted or substituted download cannot be
 * installed silently.
 */
router.post('/api/v1/kernel/install', async (_req, res) => {
  if (getInstalledKernelVersion()) {
    res.json({ code: 0, msg: 'success', data: { ok: true, alreadyInstalled: true, installed: getInstalledKernelVersion() } });
    return;
  }

  if (!inflight) {
    installState = { status: 'downloading', received: 0, total: 0 };
    inflight = ensureKernel({
      onProgress: ({ received, total }) => {
        installState = { status: 'downloading', received, total };
      },
    })
      .then((r) => {
        installState = { status: 'done', received: 0, total: 0 };
        logger.info('kernel installed', { executablePath: r.executablePath });
      })
      .catch((err: unknown) => {
        // A digest mismatch and a network failure are different problems for the operator,
        // so the message is carried through rather than flattened into "failed".
        const message =
          err instanceof KernelAcquireError
            ? `${err.message} (code: ${err.code})`
            : err instanceof Error
              ? err.message
              : String(err);
        installState = { status: 'error', received: 0, total: 0, error: message };
        logger.error('kernel install failed', { error: message });
      })
      .finally(() => {
        inflight = null;
      });
  }

  await inflight;

  if (installState.status === 'error') {
    res.status(502).json({ code: -1, msg: installState.error ?? 'kernel install failed', data: { ...installState } });
    return;
  }
  res.json({ code: 0, msg: 'success', data: { ok: true, installed: getInstalledKernelVersion() } });
});

export default router;
