// Android guest identity injector over ADB.
// Traced to requirements R08, R09: hardware identity spoofing and emulator artifact removal.
// Every step is try/caught individually so partial failures are recorded in `errors`
// while all remaining steps continue executing.

import type { AdbClient } from './adb';
import type { AndroidFingerprint } from './fingerprint';
import { logger } from '../util/logger';

export interface InjectResult {
  applied: string[];
  skipped: string[];
  errors: string[];
  /**
   * How much of the identity could actually be applied. `full` means the read-only `ro.*`
   * properties and the emulator artefacts were rewritten; `setprop-only` means the guest still
   * answers as an emulator to a careful check. Callers must surface the difference rather than
   * treating a partial application as a clean spoof.
   */
  privilege: 'full' | 'setprop-only';
}

/** Message of an unknown thrown value. */
function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Attempts to give the ADB daemon root on the guest.
 *
 * This is the enabling step for R08/R09: read-only `ro.*` properties cannot be rewritten through
 * an unprivileged `setprop`, and the goldfish/QEMU artefacts live where only root may write. It
 * succeeds only on a `userdebug`/`eng` image — which is why the engine installs the `google_apis`
 * variant rather than the locked Play Store one — and returns false rather than throwing when the
 * guest refuses, so the caller can report the downgrade instead of failing the whole launch.
 */
export async function enableGuestRoot(adb: AdbClient): Promise<boolean> {
  let out: string;
  try {
    out = await adb.shell(['root']);
  } catch (err: unknown) {
    logger.warn('adb root failed on the guest', { error: toErrorMessage(err) });
    return false;
  }

  // A locked image answers with `adbd cannot run as root in production builds`.
  if (/cannot run as root/i.test(out)) {
    logger.warn('Guest refused adb root; identity spoofing is limited to settable properties');
    return false;
  }

  // `adb root` restarts adbd, so the next command needs a moment to land.
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 1500);
  await promise;
  return true;
}

/**
 * Probes the guest over ADB to detect whether a Magisk/Zygisk spoof module (or resetprop) is present.
 * Fails closed and returns false on any shell error.
 */
export async function detectSpoofModule(adb: AdbClient): Promise<boolean> {
  try {
    const res = await adb.shell(['which', 'resetprop']);
    if (res && res.trim().length > 0 && !res.includes('not found')) {
      return true;
    }
  } catch {
    // resetprop not found in guest PATH
  }

  try {
    const res = await adb.shell(['ls', '/data/adb/modules']);
    if (res && !res.includes('No such file') && !res.includes('not found')) {
      return true;
    }
  } catch {
    // /data/adb/modules missing or inaccessible
  }

  return false;
}

/**
 * Applies the mobile identity to a booted guest over ADB.
 * Every step is idempotent and individually try/caught so that errors are reported in `errors`
 * rather than terminating the pipeline prematurely.
 *
 * Steps:
 * 1. build.prop props via `resetprop` when Zygisk is present and supported, else `setprop`
 *    (reports downgrade in skipped list).
 * 2. android_id via `settings put secure android_id`.
 * 3. IMEI/MAC written to /data/adb/ JSON config if spoof module is detected, else recorded in skipped.
 * 4. Emulator artifact removal (ro.kernel.qemu, goldfish hardware/board, qemu props) when module is present.
 * 5. Locale and timezone settings.
 * 6. Screen density via `wm density`.
 */
export async function injectGuestIdentity(
  adb: AdbClient,
  fp: AndroidFingerprint,
  opts?: {
    timezone?: string | null;
    locale?: string | null;
    hasZygisk?: boolean;
  }
): Promise<InjectResult> {
  const applied: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];

  // Root is the prerequisite for every write below that touches a read-only property or an
  // emulator artefact. Detected once here so the rest of the pipeline can branch on a fact
  // rather than on a guess.
  const hasRoot = await enableGuestRoot(adb);
  const hasModule = await detectSpoofModule(adb);
  // `resetprop` (from Magisk) is the other way to rewrite `ro.*`; either mechanism is enough.
  const useResetProp = hasModule;
  const canWriteReadOnlyProps = hasRoot || useResetProp;

  if (!canWriteReadOnlyProps) {
    logger.warn(
      'Guest has neither root nor a spoof module: read-only identity properties and emulator ' +
        'artefacts cannot be rewritten, so the guest remains detectable as an emulator',
    );
  }

  if (opts?.hasZygisk && !hasModule) {
    skipped.push('resetprop (spoof module not present; relying on adb root instead)');
    logger.warn('Zygisk requested but spoof module not detected on guest');
  }

  // 1. build.prop identity properties
  const propsToSet: Array<{ key: string; value: string }> = [
    { key: 'ro.product.model', value: fp.model },
    { key: 'ro.product.brand', value: fp.manufacturer.toLowerCase() },
    { key: 'ro.product.name', value: fp.presetId },
    { key: 'ro.product.device', value: fp.presetId },
    { key: 'ro.product.manufacturer', value: fp.manufacturer },
    { key: 'ro.build.id', value: fp.buildId },
    { key: 'ro.build.display.id', value: fp.buildId },
    { key: 'ro.build.version.release', value: fp.androidVersion },
    { key: 'ro.build.version.sdk', value: String(fp.sdkInt) },
    { key: 'ro.build.fingerprint', value: fp.buildFingerprint },
    { key: 'ro.serialno', value: fp.serial },
  ];

  const tool = useResetProp ? 'resetprop' : 'setprop';
  for (const { key, value } of propsToSet) {
    try {
      await adb.shell([tool, key, value]);
      applied.push(`${tool}:${key}`);
    } catch (err: unknown) {
      errors.push(`${tool}:${key}: ${toErrorMessage(err)}`);
    }
  }

  // These properties are `ro.` (read-only). Without root or resetprop the writes above either
  // fail or appear to succeed while the old value is still served, so say plainly that the
  // identity is not fully applied rather than reporting a spoof that will not survive a check.
  if (!canWriteReadOnlyProps) {
    skipped.push('build_prop:ro.* (needs adb root or a spoof module; values unchanged)');
  }

  // 2. Android ID
  try {
    await adb.shell(['settings', 'put', 'secure', 'android_id', fp.androidId]);
    applied.push('settings:android_id');
  } catch (err: unknown) {
    errors.push(`settings:android_id: ${toErrorMessage(err)}`);
  }

  // 3. IMEI and MAC identity config in /data/adb/ (requires spoof module)
  if (hasModule) {
    try {
      const configPayload = JSON.stringify({
        imei: fp.imei,
        mac: fp.wifiMac,
        serial: fp.serial,
        model: fp.model,
        manufacturer: fp.manufacturer,
        android_id: fp.androidId,
      });
      await adb.shell(['sh', '-c', `echo '${configPayload}' > /data/adb/identity.json`]);
      applied.push('spoof_module:identity_config');
    } catch (err: unknown) {
      errors.push(`spoof_module:identity_config: ${toErrorMessage(err)}`);
    }
  } else {
    skipped.push('spoof_module:identity_config (spoof module not present)');
  }

  // 4. Emulator artefact removal. Needs either resetprop or root: these props are `ro.*`, and
  // the files they mirror are outside what an unprivileged shell may write.
  if (canWriteReadOnlyProps) {
    // Clear ro.kernel.qemu
    try {
      await adb.shell([tool, '--delete', 'ro.kernel.qemu']);
      applied.push('emulator_artifacts:ro.kernel.qemu');
    } catch (err: unknown) {
      errors.push(`emulator_artifacts:ro.kernel.qemu: ${toErrorMessage(err)}`);
    }

    // Force ro.hardware and ro.product.board off goldfish
    try {
      await adb.shell([tool, 'ro.hardware', fp.presetId]);
      await adb.shell([tool, 'ro.product.board', fp.presetId]);
      applied.push('emulator_artifacts:goldfish');
    } catch (err: unknown) {
      errors.push(`emulator_artifacts:goldfish: ${toErrorMessage(err)}`);
    }

    // Remove qemu props
    try {
      await adb.shell([tool, '--delete', 'ro.boot.qemu']);
      await adb.shell([tool, '--delete', 'ro.kernel.android.qemud']);
      applied.push('emulator_artifacts:qemu_props');
    } catch (err: unknown) {
      errors.push(`emulator_artifacts:qemu_props: ${toErrorMessage(err)}`);
    }
  } else {
    skipped.push('emulator_artifacts:ro.kernel.qemu (needs adb root or a spoof module)');
    skipped.push('emulator_artifacts:goldfish (needs adb root or a spoof module)');
    skipped.push('emulator_artifacts:qemu_props (needs adb root or a spoof module)');
  }

  // 5. Locale
  if (opts?.locale) {
    try {
      await adb.shell(['setprop', 'persist.sys.locale', opts.locale]);
      applied.push(`locale:${opts.locale}`);
    } catch (err: unknown) {
      errors.push(`locale: ${toErrorMessage(err)}`);
    }
  } else {
    skipped.push('locale');
  }

  // 6. Timezone
  if (opts?.timezone) {
    try {
      await adb.shell(['setprop', 'persist.sys.timezone', opts.timezone]);
      applied.push(`timezone:${opts.timezone}`);
    } catch (err: unknown) {
      errors.push(`timezone: ${toErrorMessage(err)}`);
    }
  } else {
    skipped.push('timezone');
  }

  // 7. Screen density
  if (fp.screen && typeof fp.screen.densityDpi === 'number') {
    try {
      await adb.shell(['wm', 'density', String(fp.screen.densityDpi)]);
      applied.push(`density:${fp.screen.densityDpi}`);
    } catch (err: unknown) {
      errors.push(`density: ${toErrorMessage(err)}`);
    }
  } else {
    skipped.push('density');
  }

  const privilege: InjectResult['privilege'] = canWriteReadOnlyProps ? 'full' : 'setprop-only';

  logger.info('Injected guest identity', {
    appliedCount: applied.length,
    skippedCount: skipped.length,
    errorsCount: errors.length,
    privilege,
    hasRoot,
    hasModule,
  });

  return { applied, skipped, errors, privilege };
}
