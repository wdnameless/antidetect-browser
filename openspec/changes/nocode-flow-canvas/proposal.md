## Why

Afina's visual RPA canvas (drag-and-drop blocks: navigate/click/wait/condition/loop/extract/screenshot, triggers, retries) is its main non-coder adoption driver. We require raw JS for everything, which excludes SMM/agency users. This is the largest P1 slice and ships after `task-groups-queues` (its scheduler) exists.

## What Changes

- Flow document format (JSON, versioned): nodes (navigate, click, type, wait, condition, loop, extract, screenshot, eval, script-module call) + edges with branch conditions.
- Compiler: flow JSON -> sandboxed script-engine program; deterministic, testable without UI.
- Trigger binding: manual, cron, webhook (later: IMAP) via task-groups.
- Panel: drag-and-drop canvas editor, block palette, per-run live log; JSON import/export for sharing.
- Execution observability reuses task-groups statuses/logs.

## Capabilities

### New Capabilities
- `flow-canvas`: flow document format, compiler, triggers, and visual editor contract.

### Modified Capabilities

None.

## Impact

- New `src/main/flows/` (format + compiler), `packages/panel/` canvas UI, task-groups trigger hooks; script-engine unchanged (compiler targets its existing sandbox API).
- Dependency: `task-groups-queues` MUST land first (scheduling/logs). Split: wave 2 = format+compiler+API; wave 3 = canvas UI.
