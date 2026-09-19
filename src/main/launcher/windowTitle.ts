import { spawn, type ChildProcess } from 'child_process';

/**
 * The window title a launched profile advertises to the operating system.
 *
 * What the operator sees when hovering the taskbar button is the OS window title, and this
 * module is the only thing that sets it. Two mechanisms are needed, and which one applies is
 * decided by the characters in the name — measured against the shipped kernel
 * (`fingerprint-chromium 148.0.7778.215`), not assumed:
 *
 *   - `--window-name=<value>` pins the title in the kernel itself. It survives every page that
 *     sets `document.title`, and it leaves the tab strip alone (verified: the tab still reads
 *     the page's own title, and `document.title` is unchanged, so nothing leaks to a page).
 *     It accepts ASCII only — a value with any non-ASCII character is dropped entirely and the
 *     window falls back to "<page> - Chromium".
 *
 *   - For a name the flag cannot carry (a Cyrillic or accented profile name), the title is
 *     written through `SetWindowTextW` and re-applied on a short loop. A single write is not
 *     enough: a page that changes `document.title` overwrites it seconds later. Measured — a
 *     single write lost the title to the page's next navigation, while a repeating one held it
 *     across three successive retitles.
 *
 * The two must never run together: with the flag set, the kernel re-asserts its own value and
 * a WinAPI write is reverted (measured). So exactly one mechanism is chosen per launch.
 */

/** Longest title worth carrying; a taskbar tooltip wraps well before this. */
const MAX_TITLE = 96;

/**
 * The title for a profile: the name, with the colour badge in front when one is set.
 *
 * The badge is the parity feature that never worked — its old implementation prepended the
 * prefix to the live page title through a CDP command that does not exist (`Page.setTitle`),
 * so no window ever showed it. It is applied here instead, where the title is actually set.
 */
export function composeWindowTitle(
  profileName: string | null | undefined,
  badgePrefix = ''
): string {
  const name = (profileName ?? '').replace(/\s+/g, ' ').trim();
  if (!name) return badgePrefix.trim();
  return `${badgePrefix}${name}`.trim().slice(0, MAX_TITLE);
}

/** Whether every character can be carried by `--window-name`. */
export function isAsciiOnly(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) > 0x7f) return false;
  }
  return true;
}

/**
 * The flag value for a title, or null when the title needs the WinAPI path.
 *
 * Returning null rather than a stripped-down string is deliberate: a "cleaned" title
 * (`Профиль 1` → `1`) would look like the feature worked while showing a name the operator
 * never chose. The caller switches mechanism instead.
 *
 * Control characters are dropped even in ASCII titles — they cannot render in a window title
 * and a `\n` in one makes the taskbar tooltip unreadable.
 */
export function asciiWindowName(title: string): string | null {
  if (!title) return null;
  const cleaned = title.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  if (!isAsciiOnly(cleaned)) return null;
  return cleaned.slice(0, MAX_TITLE);
}

/**
 * Which mechanism carries this profile's title.
 *
 * Split out so the argument builder and the launcher agree on the choice instead of each
 * deciding separately — they must never both act, because the kernel reverts a WinAPI write
 * when `--window-name` is also set.
 */
export function planWindowTitle(profileName: string | null | undefined, badgePrefix = ''): {
  /** The `--window-name` value, or null when the flag cannot carry the title. */
  flagValue: string | null;
  /** The title to keep through the WinAPI, or null when the flag already covers it. */
  keeperTitle: string | null;
} {
  const title = composeWindowTitle(profileName, badgePrefix);
  const flagValue = asciiWindowName(title);
  if (flagValue) return { flagValue, keeperTitle: null };
  return { flagValue: null, keeperTitle: title || null };
}

/**
 * Keeps a title on a window, re-applying it as pages overwrite it.
 *
 * PowerShell rather than a native module: this repository has no FFI dependency and adding one
 * for a window title is not a trade worth making. The same route is already used elsewhere in
 * the backend (`src/main/io/cookieSqlite.ts` shells out to PowerShell for the same reason —
 * the platform's own API without a compiled dependency).
 *
 * The title travels base64-encoded inside the script so a name with quotes, backslashes or
 * spaces cannot break the command, and so the script text itself stays pure ASCII.
 *
 * Returns a stop function. The loop also exits on its own when the target process is gone, so
 * a missed cleanup cannot leave a stray process polling forever.
 */
export function startWindowTitleKeeper(pid: number, title: string): () => void {
  if (process.platform !== 'win32' || !Number.isFinite(pid) || pid <= 0 || !title) {
    return () => undefined;
  }

  const encoded = Buffer.from(title, 'utf8').toString('base64');
  const script = [
    'Add-Type @"',
    'using System; using System.Runtime.InteropServices; using System.Text;',
    'public class NullTraceTitle {',
    '  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern bool SetWindowText(IntPtr h, string s);',
    '  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);',
    '  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);',
    '  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);',
    '  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);',
    '  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);',
    '  public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);',
    '}',
    '"@',
    `$target = ${pid}`,
    `$want = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))`,
    'while ($true) {',
    '  if (-not (Get-Process -Id $target -ErrorAction SilentlyContinue)) { break }',
    '  $script:found = @()',
    '  $cb = [NullTraceTitle+EnumWindowsProc]{',
    '    param($h, $l)',
    '    $owner = 0',
    '    [void][NullTraceTitle]::GetWindowThreadProcessId($h, [ref]$owner)',
    '    if ($owner -eq $target -and [NullTraceTitle]::IsWindowVisible($h)) {',
    '      $cls = New-Object System.Text.StringBuilder 256',
    '      [void][NullTraceTitle]::GetClassName($h, $cls, 256)',
    '      if ($cls.ToString().StartsWith("Chrome_WidgetWin")) { $script:found += $h }',
    '    }',
    '    return $true',
    '  }',
    '  [void][NullTraceTitle]::EnumWindows($cb, [IntPtr]::Zero)',
    '  foreach ($h in $script:found) {',
    '    $cur = New-Object System.Text.StringBuilder 512',
    '    [void][NullTraceTitle]::GetWindowText($h, $cur, 512)',
    '    if ($cur.ToString() -ne $want) { [void][NullTraceTitle]::SetWindowText($h, $want) }',
    '  }',
    '  Start-Sleep -Milliseconds 300',
    '}',
  ].join('\n');

  let child: ChildProcess | null = null;
  try {
    child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      windowsHide: true,
      stdio: 'ignore',
    });
  } catch {
    // A missing PowerShell leaves the kernel's default title, which is the pre-existing
    // behaviour rather than a launch failure.
    return () => undefined;
  }

  child.on('error', () => {
    // Same reasoning: the title is cosmetic and must never take a launch down.
    child = null;
  });

  return () => {
    try {
      child?.kill();
    } catch {
      // already gone
    }
    child = null;
  };
}
