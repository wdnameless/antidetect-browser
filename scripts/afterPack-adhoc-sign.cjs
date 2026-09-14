// Ad-hoc sign the macOS bundle — no Apple Developer account required.
//
// WHY THIS EXISTS
// Every arm64 binary on Apple Silicon must carry a signature; the kernel refuses to
// execute unsigned ARM code. That is not Gatekeeper, and it is not optional — it is
// the loader. So "no signing at all" is not a thing that runs on an M-series Mac.
//
// What we can do without an account is an **ad-hoc** signature (`codesign -s -`):
// it satisfies the loader, costs nothing, and needs no certificate. It does NOT
// satisfy Gatekeeper, so a downloaded build still carries the quarantine attribute
// and the user still clears it once with:
//
//     xattr -dr com.apple.quarantine "/Applications/NullTrace.app"
//
// which is exactly what the reference product documents for the same reason.
//
// This hook runs after packing and before the dmg is built, so the signature is
// applied to the .app that ends up inside the disk image.

const { execFileSync } = require('child_process');
const path = require('path');

/** Recursively ad-hoc sign every Mach-O binary inside the bundle. */
function adHocSign(appPath, log) {
  // --deep is deprecated and unreliable for nested helper apps, so sign inside-out:
  // frameworks and helpers first, then the outer bundle. Signing the outer bundle
  // last is what makes the seal valid.
  const targets = [
    path.join(appPath, 'Contents', 'Frameworks'),
    path.join(appPath, 'Contents', 'Resources'),
  ];

  for (const target of targets) {
    try {
      execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', '--timestamp=none', target], {
        stdio: 'pipe',
      });
      log.info({ target: path.basename(target) }, 'ad-hoc signed nested content');
    } catch {
      // A missing or non-code directory is not an error worth failing the build over.
    }
  }

  execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', '--timestamp=none', appPath], {
    stdio: 'pipe',
  });
}

exports.default = async function afterPack(context) {
  const { appOutDir, packager, electronPlatformName, arch } = context;
  const log = packager?.info ? console : console;

  if (electronPlatformName !== 'darwin') {
    return;
  }

  const appName = packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);
  const archName = context.arch === 1 ? 'x64' : 'arm64';

  try {
    adHocSign(appPath, log);
    console.log(
      `[afterPack] ad-hoc signed ${appName}.app (${archName}) — ` +
        'this satisfies the Apple Silicon loader but NOT Gatekeeper; ' +
        'users must clear the quarantine attribute once.'
    );
  } catch (err) {
    // Do not silently ship an unsigned arm64 bundle: it would not launch, and the
    // failure would surface to the user instead of here.
    throw new Error(
      `ad-hoc signing failed for ${appPath}: ${err instanceof Error ? err.message : String(err)}. ` +
        'An unsigned arm64 bundle will not execute on Apple Silicon, so this is fatal.'
    );
  }
};
