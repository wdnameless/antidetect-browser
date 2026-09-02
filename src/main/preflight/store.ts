import { PreflightVerdict } from './types';

// In-memory cache of last preflight verdicts per profile
const lastVerdicts = new Map<string, PreflightVerdict>();

export function storeVerdict(verdict: PreflightVerdict): void {
  lastVerdicts.set(verdict.profileId, verdict);
}

export function getLastVerdict(profileId: string): PreflightVerdict | null {
  return lastVerdicts.get(profileId) ?? null;
}

export function clearLastVerdicts(): void {
  lastVerdicts.clear();
}
