# Requirements manifest — NullTrace on macOS (Apple Silicon)

Source: the operator's request in this session. Verbatim quotes are the acceptance criteria; the
answers below them are the fork decisions the operator made in the Wave 0 interview, so no
requirement here is invented by the orchestrator.

## Operator statement (verbatim)

> Так теперь я хочу, чтобы наша порта была версия работала на маке. Это возможно?

Interview answers (structured, this session):

| Fork | Answer |
|---|---|
| Form | «Папка: NullTrace.app + data/» — data BESIDE the .app, never inside |
| Architecture | «Apple Silicon (M1–M4, arm64)» |
| Build host | «GitHub Actions на macOS-раннере» |
| Kernel | «Сначала проверить эмпирически» |

## Requirements

| ID | Requirement | Acceptance (observable) |
|---|---|---|
| R01 | The portable form on macOS MUST be a folder the operator can move: `NullTrace.app` plus its data beside it. | Copy the folder to another path on the same Mac; launch; the app opens with the same profiles. Nothing is written inside the `.app` bundle. |
| R02 | Data MUST NOT be written inside the `.app` bundle, because that invalidates the signature and macOS refuses to launch a modified bundle. | After a full run, `codesign --verify --deep --strict NullTrace.app` exits 0. |
| R03 | A macOS arm64 artefact MUST be produced by CI on a macOS runner. | A tagged run publishes `NullTrace-<version>-macos-arm64.zip` (or `.dmg`). |
| R04 | The browser kernel MUST be acquired, digest-verified and made runnable on macOS. `kernelAcquire.ts` currently pins the macOS asset and then throws `ERR_UNSUPPORTED_HOST_EXTRACTION` for the `dmg` branch. | From a clean state, requesting the kernel downloads, verifies SHA-256, extracts, and the app reports the kernel as installed. |
| R05 | Whether the pinned kernel runs NATIVELY on arm64 or only under Rosetta 2 MUST be established by measurement, and the answer MUST be stated in the docs. | The probe run reports `lipo -archs` for the kernel executable and the process architecture at launch. The finding appears in README/KERNEL.md. |
| R06 | Kernel stealth MUST hold on macOS: `navigator.webdriver === false` with CDP attached, and `--fingerprint` MUST change the visible surface between two seeds. | Probe: `webdriver_false === true`; two seeds produce different surfaces. |
| R07 | If the kernel cannot run natively on arm64, that limitation MUST be disclosed rather than hidden, including what the operator must do (Rosetta install) and the detection risk. | README states the native/Rosetta status as measured, with the Rosetta command if required. |
| R08 | The macOS app MUST NOT silently pretend the missing platform features exist. Screen-capture protection auto-lock and session-lock are Windows-only today. | Docs state it; the UI does not offer a control that does nothing on macOS. |
| R09 | Gatekeeper quarantine MUST be handled explicitly: ad-hoc signing is what the project has (no Apple Developer account), so first launch needs the documented one-time step. | README states the `xattr -dr com.apple.quarantine` step for the app. |
| R10 | The Windows path MUST NOT regress. | `cargo test`, `vitest`, and the portable build all pass unchanged. |

## Out of scope (explicit)

- Intel Macs — the operator chose Apple Silicon; the probe measures Intel only as a control.
- A universal (fat) bundle — one arm64 artefact, per the answer above.
- Notarisation / Apple Developer ID — no account; ad-hoc signing stays.
- Mac App Store distribution.
- Auto-update on macOS — the updater's portable swap is a Windows mechanism (`build_windows_swap_command`); an equivalent for the `.app` layout is a separate decision, not silently implied here.

## Blocking unknowns

None that stop design work: the probe answers the kernel question by measurement. If R05/R06 come
back negative (kernel will not run, or stealth does not hold), the macOS slice narrows to "the
application works, the browser kernel does not" — and that is what will be reported rather than
papered over.
