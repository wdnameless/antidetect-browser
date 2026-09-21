# android-runtime — delta spec

Traced to `manifest.md` (R01–R18). This capability covers the Android guest itself: acquiring
its binaries, running it headlessly, seeing it inside the app, giving it a mobile identity, and
proving none of its traffic escapes the profile's proxy.

## ADDED Requirements

### Requirement: Android engine is acquired on demand and verified before use

The system SHALL NOT ship the emulator binaries or the base system image inside the installer.
`ensureAndroidEngine()` SHALL download every archive into the data directory, verify its pinned
SHA-256 by streaming the hash while receiving, and SHALL fail closed — deleting the payload and
raising an error — on digest mismatch, truncation, or network failure. The acquisition SHALL
refuse to install at all while any asset lacks a pinned digest, naming the file and the URL whose
digest a human must verify.

Traces: R02, R03, R13, R17

#### Scenario: Digest mismatch fails closed

- **WHEN** a downloaded archive's computed SHA-256 differs from the pinned digest
- **THEN** the temporary payload is deleted and acquisition throws `ERR_ANDROID_DIGEST_MISMATCH`
- **AND** no executable and no marker file is left behind, so the next attempt starts clean

#### Scenario: An unpinned asset refuses instead of downloading

- **WHEN** `ensureAndroidEngine()` runs while an asset has `sha256: null`
- **THEN** it throws `ERR_ANDROID_DIGEST_UNPINNED` naming the file and URL
- **AND** it performs no network request for that asset

#### Scenario: An abandoned partial download is reclaimed

- **WHEN** a `.download-*.tmp` file older than the staleness window exists in the engine directory
- **THEN** a new acquisition removes it before starting its own transfer

#### Scenario: Progress is observable

- **WHEN** a caller passes `onProgress`
- **THEN** it receives the asset name, bytes received, and total size (or `null` when unknown) as the transfer advances

### Requirement: The hypervisor is probed and reported honestly

`resolveAndroidPlatform()` SHALL be a pure function of host platform and CPU architecture,
choosing WHPX or AEHD on Windows with `x86_64`, HVF on macOS (native `arm64-v8a` on Apple
Silicon, `x86_64` on Intel), and KVM on Linux. `assertHypervisorReady()` SHALL probe the real
host and SHALL throw `ERR_ANDROID_NO_HYPERVISOR` with an instruction the operator can act on
rather than falling back to an unaccelerated emulator.

Traces: R12, R13

#### Scenario: Apple Silicon resolves to a native ARM image

- **WHEN** the resolver is asked for `darwin` on `arm64`
- **THEN** the plan's ABI is `arm64-v8a` and its backend is `hvf`

#### Scenario: Windows without WHPX refuses with instructions

- **WHEN** the optional feature `HypervisorPlatform` is not enabled and no AEHD driver is present
- **THEN** the check throws `ERR_ANDROID_NO_HYPERVISOR` whose message names the Windows feature to enable

#### Scenario: An unsupported host is named

- **WHEN** the resolver is asked for a platform it does not support
- **THEN** it throws `ERR_ANDROID_UNSUPPORTED_HOST` naming the platform

### Requirement: An Android profile boots headless from an isolated writable overlay

`AndroidInstance` SHALL spawn the emulator with no native window (`-no-window -no-audio
-no-boot-anim`), pointed at the profile's own writable `userdata` image created over the shared
read-only base, SHALL wait for `sys.boot_completed` before reporting `running`, and SHALL tear
down the whole process tree on stop. A warm start SHALL reuse the `quickboot` snapshot so the
observed start is seconds rather than a cold boot.

Traces: R01, R07, R14

#### Scenario: The guest is not reported running before it boots

- **WHEN** `start()` returns successfully
- **THEN** `status.state` is `running` and a subsequent ADB shell command succeeds
- **AND** while booting, `status.state` is `booting`, never `running`

#### Scenario: Two profiles do not share writable state

- **WHEN** two Android profiles are created
- **THEN** each has its own data image path under its own profile directory
- **AND** the base system images are only ever read

#### Scenario: Stop leaves nothing running

- **WHEN** `stop()` resolves
- **THEN** the emulator process is gone, every ADB forward that was added has been removed, and `isAndroidRunning()` is false

#### Scenario: The screen is not an OS window

- **WHEN** the emulator is launched by any code path in this capability
- **THEN** the argument list contains `-no-window`

### Requirement: The guest screen is streamed into an in-app canvas

The backend SHALL push `scrcpy-server.jar` into the guest, forward its socket over ADB, and relay
the H.264 stream over a loopback-only WebSocket that requires a single-use ticket. The renderer
SHALL decode that stream with WebCodecs (`avc1.42E01E`, latency-optimised) and draw frames to a
canvas; when `VideoDecoder` is unavailable it SHALL render an explicit message rather than a blank
region. Pointer and wheel events SHALL be translated into Android touch and scroll events, and the
operator SHALL be given Back, Home, Recents, Power and Rotate controls.

Traces: R04, R05

#### Scenario: The stream cannot be fetched without a ticket

- **WHEN** a WebSocket upgrade arrives without a ticket, or with a ticket that was already consumed
- **THEN** the connection is rejected and no scrcpy bytes are forwarded

#### Scenario: The relay is not reachable off-host

- **WHEN** the stream host is listening
- **THEN** its socket is bound to `127.0.0.1` only

#### Scenario: The wire format round-trips

- **WHEN** a synthetic stream consisting of a codec-meta header, a CONFIG packet, a key frame and a delta frame is parsed
- **THEN** the parser recovers each packet's exact payload, size and flag bits, and exposes the codec meta
- **AND** a chunk split at an arbitrary byte boundary yields the same packets as an unsplit stream

#### Scenario: Pointer input reaches the guest as touch

- **WHEN** the operator presses and drags on the canvas
- **THEN** the client sends a touch `down` followed by `move` events whose coordinates are scaled from CSS pixels to the guest's screen size

#### Scenario: A missing decoder is visible

- **WHEN** `window.VideoDecoder` is undefined
- **THEN** the canvas component shows a message stating WebCodecs is unavailable

### Requirement: The guest presents a coherent mobile identity

An Android profile SHALL derive its identity deterministically from the profile id and seed, using
the existing mobile preset pool, and SHALL apply it to the guest over ADB: `build.prop` properties,
Android ID, IMEI (Luhn-valid), serial and Wi-Fi MAC, plus locale, timezone and screen density.
Emulator artefacts (goldfish and QEMU properties) SHALL be hidden when the spoof module is
present. Every injection step SHALL be idempotent, and each step that fails SHALL be reported in
the result rather than discarded.

Traces: R06, R08, R09

#### Scenario: The same seed yields the same phone

- **WHEN** the fingerprint is generated twice for the same profile id and seed
- **THEN** both results are deeply equal

#### Scenario: Different profiles are different phones

- **WHEN** fingerprints are generated for many profile ids
- **THEN** their IMEIs, Android IDs, serials and MACs are all distinct

#### Scenario: A generated IMEI passes Luhn

- **WHEN** any generated IMEI is validated with the Luhn algorithm
- **THEN** it passes

#### Scenario: A partial injection is reported, not hidden

- **WHEN** one injection step fails on the guest
- **THEN** `InjectResult.errors` names that step and the other steps still ran

### Requirement: No guest traffic escapes the profile's proxy

When a profile has a proxy, the guest's traffic SHALL be routed through `tun0` served by
tun2socks, which forwards TCP and UDP (DNS included) to that proxy; the guest SHALL NOT have a
direct route out. When a profile has no proxy, the network plan SHALL be marked blocked and no
tun2socks service SHALL be started, so traffic fails closed rather than leaking. GPS coordinates
SHALL be pushed to the emulator's controller from the proxy's geolocation, and where the proxy has
no coordinates the guest SHALL receive no location at all rather than a plausible default.

Traces: R10, R11

#### Scenario: A proxied guest is tunnelled

- **WHEN** the network plan is built for a profile with a proxy
- **THEN** `blocked` is false, the SOCKS endpoint addresses the guest's view of the host, and setup reports `ok`

#### Scenario: A profile without a proxy is blocked, not leaked

- **WHEN** the network plan is built for a profile with no proxy
- **THEN** `blocked` is true and no tun2socks service is started

#### Scenario: Coordinates come from the proxy or not at all

- **WHEN** the profile's proxy has latitude and longitude
- **THEN** those exact coordinates are pushed to the controller
- **AND** when it has none, no location is pushed

#### Scenario: Teardown removes the route

- **WHEN** the instance stops
- **THEN** the tun2socks service is stopped and the route is removed

### Requirement: Android profiles are reachable through the API

The backend SHALL expose engine status and install, instance start/stop/status, and stream-ticket
issuance, all answering in the existing `{code, msg, data}` envelope with `code: -1` and the
error message on failure. Starting a profile whose engine is not installed SHALL answer `409` with
`code: 'NOT_READY'` rather than attempting a launch that cannot succeed.

Traces: R13, R14

#### Scenario: Engine status is readable before installation

- **WHEN** `GET /api/v1/android/engine` is called on a machine with no engine
- **THEN** the response has `code: 0` and reports `installed: false` with the platform plan and any error

#### Scenario: Start refuses a missing engine

- **WHEN** `POST /api/v1/android/profiles/:id/start` is called while the engine is absent
- **THEN** the response status is `409` and its body carries `code: 'NOT_READY'`

#### Scenario: A stream ticket is refused when nothing runs

- **WHEN** `POST /api/v1/android/profiles/:id/stream-ticket` is called for a profile that is not running
- **THEN** the response status is `409`

#### Scenario: A missing profile is distinguished from an idle one

- **WHEN** `GET /api/v1/android/profiles/:id/status` is called for an id with no row
- **THEN** the response status is `404`

### Requirement: The desktop launch path is unaffected

Adding Android SHALL NOT change the behaviour of a desktop profile. `resolveLaunchConfig()` SHALL
remain the resolution path for `chromium` and `firefox` profiles and SHALL be untouched by this
capability's code.

Traces: R06, R18

#### Scenario: A desktop profile still resolves as before

- **WHEN** a profile with `browser_type = 'chromium'` is launched
- **THEN** its launch configuration is byte-identical to the one produced before this change

#### Scenario: The selector is explicit

- **WHEN** a caller launches a profile
- **THEN** Android is chosen only by an explicit `browser_type === 'android'` test, never by falling through a default
