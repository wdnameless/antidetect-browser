# Interfaces — a blocked launch that explains itself

Renderer-only. No server contract changed: the blocked response already carried the full verdict,
which the UI previously discarded in favour of a generic message.

## Changed

```ts
// preflight.ts — the plan now distinguishes what blocks a launch from what merely warns
export interface PreflightFixItem {
  checkName: string;
  status: 'warn' | 'fail';
  reasonCode?: string;
  detail?: string;
  /** New: a `fail` is refusing the launch; a `warn` is not. */
  isBlocking: boolean;
  autoFix?: PreflightAutoFix;
  manualReason?: string;
  manualReasonRu?: string;
}

export interface PreflightFixPlan {
  fixableCount: number;
  unfixableCount: number;
  /** New: totals over the plan, so the UI can state that a blocker remains unfixed. */
  blockingCount: number;
  blockingFixableCount: number;
  items: PreflightFixItem[];
}
```

```ts
// PreflightModal.tsx — the modal is told why it was opened
isBlockedLaunch?: boolean;
```

```ts
// Profiles.tsx — a transport refusal is tracked separately from a guard block
const [transportError, setTransportError] = useState<{
  profileId: string; profileName?: string; message: string;
} | null>(null);
```

## Unchanged (deliberately)

- `POST /api/profiles/:id/start-with-preflight` keeps answering 412 with the verdict in `data`.
- `start(id, name, skipPreflightGuard)` keeps its signature; the modal's escape hatch uses it.
- The guard's decision logic. Both refusals are correct behaviour and stay.
- No automatic proxy unpairing anywhere.

## Ownership

| Area | Files |
| --- | --- |
| Plan blocking/warning distinction, fix application | `src/renderer/src/preflight.ts` |
| Blocked banner, escape hatch, honest summary, transport banner | `src/renderer/src/components/PreflightModal.tsx`, `src/renderer/src/pages/Profiles.tsx` |
| RU strings | `src/renderer/src/i18n.tsx` |
