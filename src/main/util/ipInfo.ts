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
