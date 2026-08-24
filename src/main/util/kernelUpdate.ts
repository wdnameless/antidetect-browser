// Kernel update checker (v0.2.20): compares the installed fingerprint-chromium
// version against the latest upstream GitHub release. Read-only — downloading
// and installing a new kernel stays a manual, deliberate step (ROADMAP risk:
// "зафиксировать версию ядра, обновлять осознанно").
import fetch from 'node-fetch';
import * as fs from 'fs';
import * as path from 'path';
import { CHROMIUM_DIR } from '../config';

const UPSTREAM_API = 'https://api.github.com/repos/adryfish/fingerprint-chromium/releases/latest';

/** Extract the installed kernel version (e.g. "148.0.7778.215") from the folder name. */
export function getInstalledKernelVersion(): string | null {
  const base = path.join(CHROMIUM_DIR, 'fingerprint-chromium');
  try {
    for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const m = entry.name.match(/(\d+\.\d+\.\d+\.\d+)/);
      if (m) return m[1];
    }
  } catch {
    // kernel dir missing
  }
  return null;
}

export interface KernelUpdateInfo {
  installed: string | null;
  latest: string | null;
  updateAvailable: boolean;
  releaseUrl?: string;
  checkedAt: number;
  error?: string;
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 4; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export async function checkKernelUpdate(): Promise<KernelUpdateInfo> {
  const installed = getInstalledKernelVersion();
  try {
    const res = await fetch(UPSTREAM_API, {
      headers: { 'User-Agent': 'antidetect-browser', Accept: 'application/vnd.github+json' },
      timeout: 15000,
    });
    const body = (await res.json()) as { tag_name?: string; name?: string; html_url?: string };
    const tag = body.tag_name ?? body.name ?? '';
    const m = tag.match(/(\d+\.\d+\.\d+\.\d+)/);
    const latest = m ? m[1] : tag || null;
    return {
      installed,
      latest,
      updateAvailable: Boolean(installed && latest && compareVersions(latest, installed) > 0),
      releaseUrl: body.html_url,
      checkedAt: Date.now(),
    };
  } catch (err) {
    return { installed, latest: null, updateAvailable: false, checkedAt: Date.now(), error: (err as Error).message };
  }
}
