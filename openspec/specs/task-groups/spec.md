# task-groups Specification

## Purpose
TBD - created by archiving change task-groups-queues. Update Purpose after archive.

## Requirements

### Requirement: Bounded parallel batch execution
The system SHALL execute a task group (script × profile set) through a queue that never exceeds the group's `activeSession` parallelism limit, applies per-task timeouts, and retries failed tasks up to `repeatCount` with exponential backoff.

#### Scenario: Parallelism cap holds
- **WHEN** a group with 200 profiles and activeSession=5 runs
- **THEN** at no instant do more than 5 tasks hold state `working`

#### Scenario: Retry with backoff
- **WHEN** a task fails and repeatCount=2
- **THEN** the task is re-queued up to 2 times with increasing delay before final state `error`

### Requirement: Time-window scheduling
The system SHALL start and stop group execution within configured time windows (cron-compatible), pausing dispatch outside the window.

#### Scenario: Outside window
- **WHEN** the current time is outside the group's window
- **THEN** no new task is dispatched and queued tasks remain `waiting`

### Requirement: Observable lifecycle
Every task SHALL expose states waiting | working | finished | error | stop and a live log stream retrievable by task uuid.

#### Scenario: Log streaming
- **WHEN** a client requests /api/tasks/:uuid/logs for a working task
- **THEN** log lines stream as they are emitted until terminal state

### Requirement: Graceful stop
Stopping a group MUST gracefully terminate working tasks and mark queued tasks `stop` without launching them.

#### Scenario: Stop mid-run
- **WHEN** a group with 3 working and 10 waiting tasks is stopped
- **THEN** working tasks receive termination and waiting tasks become `stop`
