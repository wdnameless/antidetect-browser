## 1. Flow format and compiler

- [x] 1.1 Define versioned flow JSON schema (zod): node types navigate/click/type/wait/condition/loop/extract/screenshot/eval/module, branch edges, variables.
- [x] 1.2 Compiler flow JSON -> script-engine program; deterministic output snapshot-tested per node type.
- [x] 1.3 Validation: unreachable nodes, type errors on edges, cyclic loop guards; unit tests per rule.

## 2. Execution and triggers

- [x] 2.1 Execute compiled flows through task-groups (manual + cron triggers); per-node span timing in logs.
- [x] 2.2 REST API: CRUD flows, validate endpoint, run via task group, JSON import/export.
- [x] 2.3 Integration tests: multi-branch flow on fixture site, failure mid-flow -> error state with node id.

## 3. Canvas UI (wave 3)

- [ ] 3.1 Drag-and-drop canvas in panel: palette, edge editing, per-node config forms, validation errors inline.
- [ ] 3.2 Live run view binding to task-group log stream; screenshot node previews.
