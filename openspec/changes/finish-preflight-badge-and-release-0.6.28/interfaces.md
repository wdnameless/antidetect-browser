# Interfaces — finish the preflight badge, sweep, release 0.6.28

No public contract changes. The renderer display is completed and dead code is removed; the release
is version bookkeeping.

## Renderer — the completed display

`src/renderer/src/pages/Profiles.tsx`, Actions cell. The existing component is reused unchanged:

```tsx
// component/PreflightModal.tsx — already implemented and styled, NOT modified
export interface PreflightBadgeProps {
  status?: PreflightStatus | 'loading' | 'error' | null;
  verdict?: PreflightVerdict | null;
  durationMs?: number;
  onClick?: () => void;
  onRun?: () => void;
  title?: string;
}
```

Wired form — same handlers the shield button used, so behaviour is preserved:

```tsx
<PreflightBadge
  status={preflightCache[p.user_id]?.status}
  verdict={preflightCache[p.user_id]?.verdict}
  onClick={() => void inspectPreflight(p.user_id, p.name || undefined)}
  onRun={() => void runPreflight(p.user_id, p.name || undefined, true)}
/>
```

`inspectPreflight` opens the modal with a cached verdict, or runs a fresh check when none exists;
`runPreflight` sets `preflightCache[profileId]` to `loading` then to the verdict's `overall`. That
cache is what feeds `status`, so the badge reflects a run the operator started from anywhere —
including the launch guard.

## Removed (provably dead: assigned, never read)

```ts
// state — each had call sites in openCreateModal / openEditModal / openManage
copiedSeed, memoryGb, osPlatform, mediaMicCount, mediaSpeakerCount, mediaWebcamCount, fpConfig
// helper — its only user was the removed state
copySeedToClipboard
// import — used elsewhere (App.tsx), not in this file
DevicesIcon
```

Each removal deletes the declaration AND its call sites together; a declaration removed alone would
leave a `setX` reference that breaks the build.

## Unchanged (deliberately)

- `PreflightBadge` / `PreflightModal` implementations and their CSS.
- `preflightRun` / `preflightLast` / `startWithPreflight` API shapes.
- The `preflightCache` shape and the `checkList` (array) vs `checks` (object) distinction: the array
  form is what all renderers must consume, and the object form must not be fed to `.filter`/`.map`.
- No Preflight column is re-added (R13).
