## 1. Queue core

- [x] 1.1 Implement task group model + SQLite persistence (group, task, run, log tables) with migrations.
- [x] 1.2 Implement FIFO queue with `activeSession` semaphore, per-task timeout, `repeatCount` retry with exponential backoff, optional randomized profile order.
- [x] 1.3 Time-window scheduler (cron-compatible) for group start/stop windows.
- [x] 1.4 Unit tests: parallelism cap never exceeded, retry/backoff counts, timeout kills, randomized order distribution, window boundaries.

## 2. Engine integration

- [x] 2.1 Add script-engine invocation handle returning task uuid + live log stream; map engine crashes to task `error` with captured log tail.
- [x] 2.2 Stop semantics: stop group -> running tasks get graceful terminate, queued tasks -> `stop`.
- [x] 2.3 Integration tests against real script-engine with stub scripts.

## 3. API

- [x] 3.1 REST routes: POST /api/task-groups (create), GET list/:id, POST :id/start, POST :id/stop, GET :id/tasks, GET /api/tasks/:uuid/logs (stream).
- [x] 3.2 API tests: full lifecycle create->start->logs->stop; auth parity with existing panel routes.
