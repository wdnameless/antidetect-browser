# Design: Extra Launch Args

## Key Decisions

1. **Append-last semantics**: launcher composes `[defaults..., stealth flags..., transport flags..., profile.launch_args...]`; Chromium's last-wins rule gives user switches override power without a merge protocol. Implemented as a pure `appendProfileArgs(base, extra)` — trivially unit-testable.
2. **Save-time denylist**, not launch-time: rejecting at save keeps the failure visible in the editor; launched profiles can never carry denylisted switches. Denylist = exact `--` prefixes: `--fingerprint`, `--remote-debugging`, `--user-data-dir`, `--proxy-server`, `--load-extension`, `--disable-extensions`.
3. **Storage shape**: JSON string array on the profile row (matches existing JSON-column conventions in the schema); empty/missing = no change to launch behavior.
4. **Value-joined args allowed**: entries may be `--flag=value` single strings; splitting behavior matches Chromium (no shell quoting — entries are argv elements verbatim).

## Testing Strategy

- `tests/unit/launchArgs.test.ts`: append order (user args last), denylist rejection at save (each token), empty/undefined passthrough, `--flag=value` verbatim argv, launch of a profile with args (mocked spawn asserts argv composition).