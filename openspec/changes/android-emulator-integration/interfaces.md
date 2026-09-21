# interfaces.md — android-emulator-integration

Frozen **before** any builder starts. Every builder codes against this file only.
Changing a signature here requires the orchestrator's approval, not a builder's judgement.

## 0. Ownership zones (one writer per file — no exceptions)

| Zone | Owner | Files (all paths repo-relative) |
|---|---|---|
| A1 core | `AndroidCore` | `src/main/android/platform.ts`, `src/main/android/packageManager.ts`, `src/main/android/index.ts` |
| A2 runtime+stream | `AndroidStream` | `src/main/android/adb.ts`, `src/main/android/scrcpyProtocol.ts`, `src/main/android/streamHost.ts` |
| A3 identity+net | `AndroidIdentity` | `src/main/android/fingerprint.ts`, `src/main/android/injector.ts`, `src/main/android/network.ts` |
| A4 wiring | `AndroidWiring` | `src/main/android/instance.ts`, `src/main/android/config.ts`, `src/main/db/schema.ts`, `src/main/api/routes/android.ts`, `src/main/api/server.ts` |
| B1 frontend core | `AndroidFrontend` | `src/renderer/src/androidStream.ts`, `src/renderer/src/components/AndroidCanvas.tsx` |
| B2 frontend shell | `AndroidShell` | `src/renderer/src/pages/Android.tsx`, `src/renderer/src/api.ts`, `src/renderer/src/App.tsx` |

`src/main/profiles/profileManager.ts` is **frozen** — no builder edits it. `A4` reads the
existing `getLiveProfile()`; the Android runtime is resolved by `config.ts`, not by extending
`resolveLaunchConfig()`. This keeps the desktop path byte-identical (R18).

## 1. Non-negotiable constraints for every builder

1. **No new npm dependencies.** `ws`, `node-fetch`, `adm-zip`, `sql.js`, `express` are already
   present. `@yume-chan/scrcpy` is deliberately NOT added (R17): the scrcpy wire format is
   implemented in `scrcpyProtocol.ts`. Do not run `npm install`.
2. **Never fabricate a digest.** A digest that was invented fails closed forever and is a lie.
   Every shipped asset is pinned to the digest Google actually publishes — **SHA-1**
   (`<checksum type="sha1">` in `repository2-3.xml` / `sys-img2-3.xml`); Google publishes no
   SHA-256 feed for these archives. An asset with **no** digest (both `sha256` and `sha1`
   null) must refuse loudly (`ERR_ANDROID_DIGEST_UNPINNED`), see §3.
3. **Fail closed.** Any integrity, boot or download failure throws/returns an error carrying a
   `code` field. Silent fallbacks are prohibited.
4. Follow `src/main/util/kernelAcquire.ts` for download/verify/extract style and
   `src/main/util/logger.ts` (`logger.info/warn/error`) for logging.
5. Every builder runs `npx tsc -p tsconfig.main.json --noEmit` (renderer builders run
   `npm run typecheck:renderer`) on its own files and reports the result. Do NOT run the full
   vitest suite (deferred to one integration pass).

## 2. A1 — platform & package manager

```ts
// src/main/android/platform.ts
export type AndroidHostPlatform = 'windows' | 'macos' | 'linux';
export type HypervisorBackend = 'whpx' | 'aehd' | 'hvf' | 'kvm';

export interface AndroidPlatform {
  host: AndroidHostPlatform;
  /** Guest ABI the system image must use. Apple Silicon -> arm64-v8a, everything else -> x86_64. */
  abi: 'x86_64' | 'arm64-v8a';
  /** Backends the resolver will accept, best first. */
  backends: HypervisorBackend[];
  /** Path (relative to the android engine dir) of the emulator executable. */
  emulatorSubpath: string;
}

export class AndroidPlatformError extends Error {
  constructor(message: string, public readonly code: AndroidPlatformErrorCode);
}
export type AndroidPlatformErrorCode =
  | 'ERR_ANDROID_UNSUPPORTED_HOST'
  | 'ERR_ANDROID_NO_HYPERVISOR'
  | 'ERR_ANDROID_HYPERVISOR_NOT_READY';

/** Pure resolver: host+arch -> platform plan. No I/O, unit-testable. */
export function resolveAndroidPlatform(
  opts?: { platform?: NodeJS.Platform; arch?: string }
): AndroidPlatform;

/**
 * Real readiness probe (I/O). Windows: WHPX must be enabled (`Get-WindowsOptionalFeature
 * -Online -FeatureName HypervisorPlatform` == Enabled) or the AEHD driver installed.
 * macOS: `sysctl kern.hv_support` == 1. Linux: /dev/kvm exists and is rw.
 * A hypervisor that is *absent* throws ERR_ANDROID_NO_HYPERVISOR with an instruction the
 * operator can act on (enable the Windows feature / install the driver).
 */
export function assertHypervisorReady(p: AndroidPlatform): Promise<void>;
```

```ts
// src/main/android/packageManager.ts
export interface AndroidAssetInfo {
  /** File name inside the engine dir. */
  file: string;
  url: string;
  /** Byte size, or null when the vendor did not publish one. */
  size: number | null;
  /**
   * Pinned SHA-256, lowercase hex — or null when the vendor does not publish one.
   * Preferred over `sha1` whenever it is available.
   */
  sha256: string | null;
  /**
   * Pinned SHA-1, lowercase hex — the digest Google actually publishes for emulator and
   * system-image archives (`<checksum type="sha1">`). Used when `sha256` is null.
   * Both null is NOT "skip verification": acquisition throws ERR_ANDROID_DIGEST_UNPINNED.
   */
  sha1: string | null;
  archiveType: 'zip' | 'tar.gz';
  /** Marker path (relative to engine dir) whose existence means "already installed". */
  marker: string;
}

/** Keyed by `${host}-${abi}`, e.g. `windows-x86_64`. */
export const ANDROID_ENGINE_ASSETS: Record<string, AndroidAssetInfo[]>;
/** AOSP system image archives, keyed by API level then `${host}-${abi}`. */
export const ANDROID_SYSTEM_IMAGES: Record<number, Record<string, AndroidAssetInfo[]>>;

export interface AndroidEngineStatus {
  installed: boolean;
  engineDir: string;
  emulatorPath: string | null;
  /** API levels whose system image is present. */
  installedApiLevels: number[];
  /** Asset files with no pinned digest (`sha256` and `sha1` both null); non-empty => install is refused. */
  unpinnedAssets: string[];
  platform: AndroidPlatform | null;
  error?: { code: string; message: string };
}

export class AndroidAcquireError extends Error {
  constructor(message: string, public readonly code: AndroidAcquireErrorCode);
}
export type AndroidAcquireErrorCode =
  | 'ERR_ANDROID_DIGEST_UNPINNED'
  | 'ERR_ANDROID_DIGEST_MISMATCH'
  | 'ERR_ANDROID_DOWNLOAD_FAILED'
  | 'ERR_ANDROID_EXTRACTION_FAILED'
  | 'ERR_ANDROID_ABORTED';

export function getAndroidEngineStatus(): AndroidEngineStatus;            // sync, no download
export async function ensureAndroidEngine(opts?: {
  apiLevel?: number;                       // default 34
  onProgress?: (p: { asset: string; received: number; total: number | null }) => void;
  signal?: AbortSignal;
}): Promise<{ engineDir: string; emulatorPath: string; systemImageDir: string }>;
```

Download rules (mirror `kernelAcquire`): stream to `.download-<ts>-<file>.tmp`, hash while
streaming, `fs.unlinkSync` the temp file on mismatch, extract via `AdmZip` (zip) or
`spawnSync('tar', ['-xzf', …])` (tar.gz), write the `marker` last, and age-gate removal of
abandoned `.download-*` files at 1 h (reuse the `STALE_DOWNLOAD_MS` idea).

Engine dir: `path.join(DATA_DIR, 'android')`. New export needed in `config.ts`? No — A1
computes it locally as `path.join(DATA_DIR, 'android')` using the existing `DATA_DIR` import,
so `config.ts` stays untouched by A1.

## 3. Emulator / system-image acquisition honestly

Every archive in `ANDROID_ENGINE_ASSETS` / `ANDROID_SYSTEM_IMAGES` ships **pinned to the
digest Google actually publishes** — SHA-1, lowercase hex, transcribed verbatim from
`<checksum type="sha1">` in `repository2-3.xml` / `sys-img2-3.xml`. Google publishes no
SHA-256 feed for these archives, so `sha256` is `null` throughout and `sha1` carries the
pin. `ensureAndroidEngine()` first collects `unpinnedAssets` (assets with **both** digests
null); if non-empty it throws before any network request:

```
ERR_ANDROID_DIGEST_UNPINNED: no pinned digest for <file>.
Verify the official digest of <url> against Google's published repository metadata
(repository2-3.xml / sys-img2-3.xml) and pin it in ANDROID_ENGINE_ASSETS in
src/main/android/packageManager.ts before installing.
```

Verification is algorithm-aware: `sha256` wins when present, otherwise `sha1`; the hash is
created with the matching algorithm and a mismatch reports the algorithm plus expected and
actual values (`ERR_ANDROID_DIGEST_MISMATCH`).

The URL/version constants are pinned from Google's public repository
(`https://dl.google.com/android/repository/`), and the file list is the real one
(`emulator-windows_x64-<build>.zip`, `sys-img/google_apis_playstore/x86_64-34_r14.zip` —
underscores, not hyphens). A test injects a deliberately digest-free asset table and asserts
exactly this refusal with **no** network call.

## 4. A2 — ADB, scrcpy wire format, stream host

```ts
// src/main/android/adb.ts
export class AdbClient {
  constructor(adbPath: string, serial: string);
  /** Runs `adb -s <serial> shell <args>`, returns trimmed stdout; throws on non-zero exit. */
  shell(args: string[]): Promise<string>;
  push(localPath: string, remotePath: string): Promise<void>;
  /** `adb -s <serial> forward tcp:<local> tcp:<remote>`; resolves the chosen local port. */
  forward(remote: string, localPort?: number): Promise<number>;
  removeForward(localPort: number): Promise<void>;
  /** Polls `getprop sys.boot_completed` until `1` or the deadline. */
  waitForBoot(opts?: { timeoutMs?: number; pollMs?: number }): Promise<void>;
  install(apkPath: string): Promise<void>;
  kill(): Promise<void>;   // `adb -s <serial> emu kill`
}
export function resolveAdbPath(engineDir: string): string;
export function allocateEmulatorPorts(preferred?: number): Promise<{ console: number; adb: number }>;
```

```ts
// src/main/android/scrcpyProtocol.ts   — pure, no I/O, fully unit-tested
export const SCRCPY_HEADER_SIZE = 12;
export const SCRCPY_FLAG_CONFIG = 1n << 62n;
export const SCRCPY_FLAG_KEY_FRAME = 1n << 61n;

export interface ScrcpyPacket {
  /** Presentation timestamp in microseconds, with the flag bits masked off. */
  pts: bigint;
  size: number;
  isConfig: boolean;
  isKeyFrame: boolean;
  payload: Buffer;
}

export interface ScrcpyCodecMeta {
  codecId: number;      // 0x68323634 = 'h264'
  width: number;
  height: number;
}

/** Incremental parser over a byte stream; feed() emits every complete packet it can. */
export class ScrcpyParser {
  constructor(opts?: { expectCodecMeta?: boolean });
  feed(chunk: Buffer): ScrcpyPacket[];
  get codecMeta(): ScrcpyCodecMeta | null;
}
export function buildControlMessages(...): Buffer;   // see §4.1
```

scrcpy 2.x/3.x framing (verified, implemented locally — no dependency):
each packet is a 12-byte big-endian header — `uint64 pts` (top 2 bits are the flags
`CONFIG`/`KEY_FRAME`) followed by `uint32 size` — then `size` bytes of H.264 NAL payload.
When `codecMeta` was requested, the FIRST header is followed by a 12-byte codec-meta body
instead of video (id, width, height).

```ts
// src/main/android/streamHost.ts
export interface AndroidStreamTicket {
  /** One-shot token; the WS upgrade URL must carry it. */
  ticket: string;
  wsUrl: string;         // ws://127.0.0.1:<port>/android/stream?ticket=<t>
  width: number;
  height: number;
  expiresAt: number;
}

export class AndroidStreamHost {
  constructor(instance: AndroidInstanceLike);
  /** Pushes scrcpy-server.jar, forwards the socket, spawns the server, starts the relay. */
  start(opts: { port: number; maxSize?: number; bitRate?: number; maxFps?: number }): Promise<void>;
  stop(): Promise<void>;
  issueTicket(): AndroidStreamTicket;
  /** Sends a control message (touch/scroll/key/rotate) to the guest. */
  sendControl(msg: Buffer): void;
  readonly status: 'idle' | 'starting' | 'streaming' | 'error';
}

/** Minimal surface streamHost needs, satisfied by A4's instance. Declared here so A2 does not import A4. */
export interface AndroidInstanceLike {
  readonly profileId: string;
  readonly serial: string;
  readonly adb: AdbClient;
  readonly screen: { width: number; height: number };
}
```

Relay rules: the WS server binds to `127.0.0.1` only; a ticket is required and single-use
(consumed on upgrade, rejected when the socket to ADB cannot be opened); the host forwards
raw scrcpy bytes to the client untouched and interprets only the client→server control
channel (length-prefixed, see §4.1). On `stop()` every forwarded port is removed.

### 4.1 Control channel (frozen; B1 codes against it)

Client→server messages are `[1 byte type][payload]`, sent as **binary** WS frames:

| type | payload | meaning |
|---|---|---|
| `0x01` | `uint8 action` (0 up, 1 down, 2 move) + `uint32 x` + `uint32 y` + `uint32 screenW` + `uint32 screenH` + `uint8 buttons` | touch |
| `0x02` | `uint32 x` + `uint32 y` + `uint32 screenW` + `uint32 screenH` + `int32 hScroll` + `int32 vScroll` | scroll |
| `0x03` | `uint8 keycode` (4 Back, 3 Home, 187 Recents, 26 Power) | key |
| `0x04` | — | rotate device (server sends the emulator `rotate` console command) |
| `0x05` | `uint32 width` + `uint32 height` | client viewport changed; server returns a fresh `ScrcpyCodecMeta` frame |

Server→client frames: **binary** = raw scrcpy stream bytes (already framed); **text** = JSON
status `{"type":"status"|"error","message":string,"code"?:string}`.

## 5. A3 — identity, injector, network

```ts
// src/main/android/fingerprint.ts
export interface AndroidFingerprint {
  /** Preset id from src/main/devices/mobilePresets.ts — the identity source (no new pool). */
  presetId: string;
  model: string;
  manufacturer: string;
  androidVersion: string;      // e.g. "15"
  sdkInt: number;              // e.g. 35
  buildId: string;
  buildFingerprint: string;    // google/<device>/<device>:<ver>/<buildId>/<incremental>:user/release-keys
  /** 16 hex chars. Derived from the seed, formatted like a real Android ID. */
  androidId: string;
  /** 15 digits, Luhn-valid. */
  imei: string;
  serial: string;
  /** Uppercase colon-separated MAC, locally-administered bit preserved. */
  wifiMac: string;
  screen: { width: number; height: number; densityDpi: number };
  gpu: { renderer: string; vendor: string };
}
/** Deterministic: same profileId+seed => same identity, forever. */
export function generateAndroidFingerprint(profileId: string, seed: number): AndroidFingerprint;
export function luhnCheckDigit(digits: string): number;   // pure, unit-tested
```

```ts
// src/main/android/injector.ts
export interface InjectResult { applied: string[]; skipped: string[]; errors: string[] }
/**
 * Applies the identity to a booted guest over ADB. Every step is idempotent and every
 * failure is REPORTED in `errors`, never thrown away.
 * Steps: build.prop props via `resetprop` when Zygisk is present, else `setprop`;
 * android_id via `settings put secure android_id`; IMEI/MAC via the spoof module's
 * SQLite/JSON config written to /data/adb/; emulator artifact removal (goldfish/qemu
 * props, `ro.kernel.qemu`, `ro.hardware=goldfish`); locale/timezone; screen density.
 */
export async function injectGuestIdentity(adb: AdbClient, fp: AndroidFingerprint, opts?: {
  timezone?: string | null; locale?: string | null; hasZygisk?: boolean;
}): Promise<InjectResult>;
/** True when the installed system image carries the Magisk/Zygisk spoof module. */
export async function detectSpoofModule(adb: AdbClient): Promise<boolean>;
```

```ts
// src/main/android/network.ts
export interface GuestNetworkPlan {
  tunInterface: 'tun0';
  socksHost: string;    // 127.0.0.1 as seen from the guest: 10.0.2.2
  socksPort: number;
  tun2socksBinaryOnHost: string;
  /** True when the profile has no proxy — the guest then has NO route (fail closed). */
  blocked: boolean;
}
export function planGuestNetwork(proxy: { type: string; host: string; port: number } | null): GuestNetworkPlan;
/** Starts the host-side SOCKS bridge and the guest tun2socks service; returns the guest-side pid. */
export async function setupGuestNetwork(adb: AdbClient, plan: GuestNetworkPlan, opts: {
  tunnel?: { start: () => Promise<{ localPort: number }>; stop: () => Promise<void> };
}): Promise<{ ok: boolean; detail: string }>;
export async function teardownGuestNetwork(adb: AdbClient): Promise<void>;
/**
 * Pushes GPS + sets the sensor stream. When the proxy has no coordinates the guest gets
 * NO location at all (never a plausible default — a wrong city is worse than no city).
 */
export async function pushGeolocation(
  grpc: AndroidControllerClient,
  geo: { latitude: number; longitude: number } | null
): Promise<void>;

export interface AndroidControllerClient {   // emulator gRPC/console control surface
  setLocation(lat: number, lng: number): Promise<void>;
  rotate(): Promise<void>;
  sendKey(keycode: number): Promise<void>;
  close(): void;
}
export function connectController(consolePort: number, authTokenPath: string): AndroidControllerClient;
```

## 6. A4 — instance, config, DB, routes

```ts
// src/main/android/instance.ts
export interface AndroidStartOptions {
  profileId: string;
  systemImageDir: string;
  emulatorPath: string;
  adbPath: string;
  /** Per-profile writable overlay; created from the read-only base if absent. */
  dataImagePath: string;
  screen: { width: number; height: number };
  proxy: { type: string; host: string; port: number; username?: string | null; password?: string | null } | null;
  timezone?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  seed: number;
  headless?: boolean;     // always true today; kept explicit for R01
  coldBoot?: boolean;     // skip the quickboot snapshot
}

export interface AndroidInstanceStatus {
  profileId: string;
  state: 'starting' | 'booting' | 'running' | 'stopped' | 'error';
  serial: string;
  consolePort: number;
  adbPort: number;
  screen: { width: number; height: number };
  stream: 'idle' | 'starting' | 'streaming' | 'error';
  startedAt: number;
  error?: { code: string; message: string };
  inject?: InjectResult;
}

export class AndroidInstance implements AndroidInstanceLike {
  readonly profileId: string;
  readonly serial: string;
  readonly adb: AdbClient;
  readonly screen: { width: number; height: number };
  start(): Promise<void>;      // spawn -> waitForBoot -> inject -> network -> stream
  stop(): Promise<void>;       // snapshot (best effort) -> teardown -> adb emu kill -> kill tree
  get status(): AndroidInstanceStatus;
  issueStreamTicket(): AndroidStreamTicket;
}

export async function startAndroidProfile(o: AndroidStartOptions): Promise<AndroidInstanceStatus>;
export async function stopAndroidProfile(profileId: string): Promise<boolean>;
export function isAndroidRunning(profileId: string): boolean;
export function getAndroidInstance(profileId: string): AndroidInstance | undefined;
export function listAndroidStatuses(): AndroidInstanceStatus[];
```

```ts
// src/main/android/config.ts
export interface ResolvedAndroidConfig {
  profileId: string;
  name: string | null;
  fingerprint: AndroidFingerprint;
  screen: { width: number; height: number };
  proxy: { type: string; host: string; port: number; username: string | null; password: string | null } | null;
  timezone: string | null;
  geolocation: { latitude: number; longitude: number } | null;
  seed: number;
}
/** Reads the LIVE profile row + its proxy row. Does NOT touch resolveLaunchConfig. */
export function resolveAndroidConfig(profileId: string): ResolvedAndroidConfig;
```

DB (A4 only, appended to the existing migration list in `src/main/db/schema.ts`):

```ts
ensureColumn(db, 'profiles', 'android_config', 'TEXT');
```

with a comment explaining it holds Android-only settings
(`{"apiLevel":34,"screen":"phone","coldBoot":false}`) and that `browser_type` is the
runtime selector. `browser_type` accepts `'android'`; `resolveLaunchConfig` is left alone
and callers must branch on `browser_type === 'android'` **before** calling it.
Also extend the `ProfileRow` interface? **No** — A4 must not edit `profileManager.ts`.
A4 reads the raw column with its own prepared statement in `config.ts`.

Routes (`src/main/api/routes/android.ts`, mounted in `server.ts` as
`app.use(androidRoutes);` immediately after `app.use(profileRoutes);`):

| Method | Path | Behaviour |
|---|---|---|
| GET | `/api/v1/android/engine` | `getAndroidEngineStatus()` → `{code:0,msg:'success',data:<status>}` |
| POST | `/api/v1/android/engine/install` | body `{apiLevel?:number}` → `ensureAndroidEngine`; progress via the existing SSE event bus if trivial, else no progress |
| GET | `/api/v1/android/instances` | `listAndroidStatuses()` |
| POST | `/api/v1/android/profiles/:id/start` | `resolveAndroidConfig` → `ensureAndroidEngine` → `startAndroidProfile`; `409 {code:'NOT_READY'}` when the engine is missing |
| POST | `/api/v1/android/profiles/:id/stop` | `stopAndroidProfile` |
| GET | `/api/v1/android/profiles/:id/status` | one instance status, `404` when unknown |
| POST | `/api/v1/android/profiles/:id/stream-ticket` | `{code:0,...,data:{ticket,wsUrl,width,height,expiresAt}}`; `409` when not running |

Every route wraps in `try/catch` and answers `res.json({ code: -1, msg: (err as Error).message, data: {} })`,
matching `routes/diagnostics.ts`. Error `code` from the thrown error is put in `data.code` when present.

## 7. B1/B2 — renderer

```ts
// src/renderer/src/androidStream.ts
export type AndroidStreamStatus = 'connecting' | 'streaming' | 'closed' | 'error';
export interface AndroidStreamHandlers {
  onStatus(s: AndroidStreamStatus, message?: string): void;
  /** Codec description + first frames, once the codec-meta frame has been parsed. */
  onCodecMeta(meta: { codecId: number; width: number; height: number }): void;
  onFrame(frame: { data: Uint8Array; isKeyFrame: boolean; pts: bigint; isConfig: boolean }): void;
}
export class AndroidStreamClient {
  constructor(wsUrl: string, handlers: AndroidStreamHandlers);
  connect(): void;
  close(): void;
  sendTouch(action: 0 | 1 | 2, x: number, y: number): void;
  sendScroll(x: number, y: number, hScroll: number, vScroll: number): void;
  sendKey(keycode: 4 | 3 | 187 | 26): void;
  sendRotate(): void;
  sendViewport(width: number, height: number): void;
  /** Keeps the coordinates the socket is told about correct without a round-trip per move. */
  setViewport(width: number, height: number): void;
}
```
`AndroidStreamClient` mirrors `scrcpyProtocol.ts`'s parser (12-byte header, big-endian
`uint64 pts` + `uint32 size`, `CONFIG = 1n<<62n`, `KEY_FRAME = 1n<<61n`, first packet is
codec-meta body when `expectCodecMeta`). It must NOT import from `src/main/**` — the two
parsers are independent implementations of the same frozen wire format.

```tsx
// src/renderer/src/components/AndroidCanvas.tsx
export interface AndroidCanvasProps {
  wsUrl: string;
  screen: { width: number; height: number };
  onStatus?(s: AndroidStreamStatus, message?: string): void;
}
export function AndroidCanvas(props: AndroidCanvasProps): JSX.Element;
```
Requirements: `VideoDecoder` with `codec: 'avc1.42E01E'`, `optimizeForLatency: true`, fed the
CONFIG packet as `description` and each key/delta frame as an `EncodedVideoChunk`; frames
drawn with `drawImage` onto a `<canvas>` sized to `screen`; pointerdown/move/up → `sendTouch`
with coordinates scaled from CSS pixels to `screen`; wheel → `sendScroll`; toolbar buttons →
`sendKey`/`sendRotate`; `ResizeObserver` → `sendViewport`; on unmount `decoder.close()` and
`client.close()`. When `VideoDecoder` is unavailable render a clear message, not a blank box.

```tsx
// src/renderer/src/pages/Android.tsx
export function AndroidPage(props: { profileId: string; profileName?: string | null }): JSX.Element;
```
Shows the engine status, an Install button when the engine is absent (surfacing the exact
backend error text, including `ERR_ANDROID_DIGEST_UNPINNED`), a Start/Stop control, and the
`AndroidCanvas` once a stream ticket has been issued. `api.ts` gains:
`androidEngine()`, `androidEngineInstall(apiLevel?)`, `androidInstances()`,
`androidStart(profileId)`, `androidStop(profileId)`, `androidStatus(profileId)`,
`androidStreamTicket(profileId)` — same `request<T>()` envelope as every existing method.
`App.tsx` gains one `NAV_DESTINATIONS` entry and one branch in the JSX ternary chain,
following the existing pattern exactly.

## 8. Acceptance for the whole change

- `npx tsc -p tsconfig.main.json --noEmit` and `npm run typecheck:renderer` both clean.
- `npm test` — all 146 pre-existing tests plus the new ones green.
- The desktop path is provably untouched: `git diff --stat` shows no change to
  `src/main/launcher/**` or `src/main/prox**` except additions.
- An unpinned digest refuses with `ERR_ANDROID_DIGEST_UNPINNED` and makes no network call.
- `scrcpyProtocol`/`AndroidStreamClient` round-trip a synthetic stream (config packet + key
  frame + delta frame) and recover the exact payloads and flags.
- Hosts without a hypervisor produce `ERR_ANDROID_NO_HYPERVISOR` with an actionable message.
