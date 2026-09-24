// Egress-IP info helpers (ip-api.com). Used to keep timezone coherent with the IP.
import fetch from 'node-fetch';

let cachedTimezone: string | null = null;

/** Detect the machine's timezone from its egress IP (cached). */
export async function detectMachineTimezone(): Promise<string | null> {
  if (cachedTimezone) return cachedTimezone;
  try {
    const res = await fetch('http://ip-api.com/json/?fields=timezone', { timeout: 5000 });
    const body = (await res.json()) as { timezone?: string };
    if (body.timezone) cachedTimezone = body.timezone;
    return cachedTimezone;
  } catch {
    return null;
  }
}

/**
 * True for an address that cannot host a public service.
 *
 * Shared rather than local because two callers now need the same answer for different reasons: the
 * network diagnostic asks whether an ICE candidate leaked a usable address, and the proxy check
 * asks whether a proxy hostname resolved somewhere it could never be reached. A second hand-rolled
 * copy of this list is how the two drift — one accepting CGNAT, the other not.
 *
 * Covers RFC1918, loopback, link-local, CGNAT (RFC6598) and the IPv6 equivalents.
 */
export function isPrivateOrLocal(ip: string): boolean {
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 10 || a === 127) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }
  const lower = ip.toLowerCase();
  return (
    lower === '::1' ||
    lower.startsWith('fe80:') ||
    lower.startsWith('fc') ||
    lower.startsWith('fd')
  );
}
