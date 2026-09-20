# portable-state-and-ui-cleanup

Make the application self-contained in one folder, and clear out interface elements the operator
asked to remove.

## Why

**The application is not actually portable.** Three things live outside the folder the operator
copies:

| What | Where it goes now | Consequence |
|---|---|---|
| `settings.json` (holds `dataDir`) | `%APPDATA%\antidetect-browser` | On another machine it is absent, so the recorded folder is lost |
| WebView2 cache | `%LOCALAPPDATA%\NullTrace` | Recreated as a stray folder on every machine |
| MCP audit log | `%APPDATA%\antidetect-browser\mcp-audit.jsonl` | Same |

Measured on this machine: `%APPDATA%\antidetect-browser` holds `dataDir: "D:\\NULLTRACE"` plus the
webview cache, and `~/.antidetect` holds a second settings file and a `data/` tree. Copying
`D:\NULLTRACE` to a USB stick and opening it elsewhere therefore finds neither the profiles nor
even the record of where they are.

## What changes

- **Settings move inside the portable folder** when the executable is running from one, so the
  recorded choice travels with the data. The Windows shell resolves the same directory, so the
  shell and the backend agree.
- **A recorded folder is honoured while it exists**, and the portable folder is used when it does
  not. This is what makes a moved stick work without relocating live data: on the original machine
  `D:\NULLTRACE` still resolves, and on a machine where that path is absent the folder beside the
  executable is used. Relocating an existing installation's data was explicitly avoided — the code
  already warns that discovering an empty library looks exactly like losing it.
- **The webview cache follows the folder**, so no stray directory is created under the user
  profile.
- The rest is interface: three columns removed from the profiles table, three actions moved to
  Settings, a breadcrumb that names the sidebar group, MCP starting with the application, and two
  panel controls corrected.

## Impact

- Data: none is moved. Existing installations keep their folder; the change is what happens when
  that folder is absent.
- Security: unchanged — the stealth key, extension signatures and update signature all resolve
  through the same data directory.
- API: no route changes.
