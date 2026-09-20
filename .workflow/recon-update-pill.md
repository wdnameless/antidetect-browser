# Recon — "Update available" but clicking does nothing

Lane T1. Operator report: the sidebar pill reads **Update available**, clicking it does
**nothing**, and they expect the browser to update **seamlessly**.

## Cause 1 — the pill only *checks*; nothing downloads (verified in source)

`App.tsx:519-535` wires the click to `apiObj.update.check()` and nothing else. Download and
install are separate bridge calls (`update.download()`, `update.quitAndInstall()`) that exist
only inside Settings → Updates (`Settings.tsx:330-338`), behind buttons the operator never
reaches from the footer.

So the control is not broken — it is a **one-way check with no path to completion**. The pill
changes to "Update available" and stops. Nothing in the footer ever calls download or install,
and `App.tsx` does not even map the shell's `download-progress` state, so progress could not be
shown there.

Reproduced against the running app (0.6.3, port 50325): the pill renders
`NullTrace v0.6.3 / Not checked`, and its click handler contains no download call.

## Cause 2 — the portable swap could never succeed (verified by experiment)

Even with a download button, the portable swap was impossible as written. `build_windows_swap_command`
(`updater.rs:752`) builds:

    ping -n 3 127.0.0.1 >nul & move /Y "<target>.new" "<target>" & start "" "<target>"

Two problems, both proven:

1. **Nothing ever closes the app, so the target stays locked.** The portable branch of
   `install()` emits "Update staged successfully. Please restart the application" and returns —
   it never exits. Demonstrated directly: with a live process holding `live.exe`,
   `move /Y live.new live.exe` returns **"Access is denied. 0 file(s) moved."** The staged file
   survives, `move` fails, and `start` then launches the **old** binary. The operator sees
   nothing happen — exactly the report.
2. **The `ping -n 3` wait is a race, not a synchronisation.** It waits ~2 s regardless of
   whether the process has actually released the file. Windows does allow renaming a running
   exe in some cases, but it is not reliable, and the helper neither checks the move's result
   nor surfaces a failure.

## Cause 3 — a correct payload would still be written to the wrong file (context)

`PORTABLE_EXECUTABLE_FILE` is exported by the **0.6.4** launcher; the running 0.6.3 shell does
not contain that string, and neither does the 0.6.4 *shell* — only the launcher sets it. So the
build the operator is running replaces `current_exe()` (the extracted shell) rather than the
launcher, and the launcher re-extracts on every run. Verified by searching both binaries for the
constant.

## Also observed

The screenshot shows the footer reading `v0.6.2` while `/status` answers `0.6.3`. The version is
read from the backend (`api.status()`), so the visible `v0.6.2` in that screenshot predates the
version fix; the live app now reports 0.6.3 through the same path.

## Acceptance check

- Clicking the pill on a build with an available update must end in a **running new version**,
  with no manual step beyond the click: check → download (with progress) → install → relaunch.
- If any stage fails, the UI must say so in the footer rather than appearing inert.
- The portable swap must wait for the process to actually exit, verify the move succeeded, and
  report failure instead of silently launching the old binary.
