# Tasks — nulltrace-portable

Order: kernel acquisition → artefacts → data mode → CI → verification.
Suite stays green (113 files / 890 tests) and typecheck clean throughout.

## 1. Kernel acquisition (run-time, verified)

- [ ] 1.1 New kernel-download module: fetch the platform-correct archive from the
      upstream release pinned in source (`148.0.7778.215`), verify its SHA256 against
      the digest pinned in source, extract into the existing resolution path
      (`CHROMIUM_DIR`, `config.ts:54`), and report progress.
- [ ] 1.2 Pin all three platform artefacts with their published digests:
      `windows_x64.zip` `9ef3f471b7a6641b4224532522b29141ce3746e27d55788d88e2fd951f362579`,
      `x86_64.AppImage` `a5fa5e6c05cb7fa3617ec2ca642ad3cc6e586ac5249cc29edb0a602d695685f0`,
      `macos.dmg` `b72f091e2e1a7583eed389c4b8e3534ed355e568af8c8bbf8fc30a25e23ca679`.
      Record in a comment that these are external and must be re-pinned when the
      upstream version changes.
- [ ] 1.3 **Fail closed.** A digest mismatch, a truncated body, or a missing release
      MUST abort with a clear error and MUST NOT leave a usable-looking kernel. Test
      with a deliberately corrupted payload and with a wrong expected digest.
- [ ] 1.4 `kernelUpdate.ts` keeps its version check; the new module owns acquisition.
      Do not duplicate the upstream-release lookup.
- [ ] 1.5 First-run behaviour: when the kernel is absent, the app acquires it and
      shows progress; with no network it must say so plainly instead of failing to
      start silently.
- [ ] 1.6 Remove the kernel from `extraResources` once acquisition works, so the
      artefact stops carrying 425 MB. Verify the build still resolves a kernel.

## 2. Single-file artefacts

- [ ] 2.1 Windows: add the `portable` target and remove `nsis`, so no installer is
      produced. Keep `appId` unchanged so existing installs can move across.
- [ ] 2.2 Linux: add the `AppImage` target with the correct icon and category.
- [ ] 2.3 macOS: add the `dmg` target for arm64 (per the earlier platform decision),
      and document the quarantine step in the README — we have no Apple account, so
      it is unsigned.
- [ ] 2.4 `artifactName` must make each platform's artefact self-describing
      (`NullTrace-<version>-portable-win-x64.exe`, `…-linux-x86_64.AppImage`,
      `…-mac-arm64.dmg`) so a user picks the right file without guessing.

## 3. Portable data mode

- [ ] 3.1 `resolveDataDir` (`config.ts:37`) gains a `portable` mode: data beside the
      executable. Existing resolution order (env override → saved setting → system
      default) must keep working; this adds a mode, not a replacement.
- [ ] 3.2 First-run choice: on a portable launch with no recorded choice, ask whether
      to keep data beside the executable or in the system location, and persist it.
      Reuse the existing `settings.json` mechanism rather than inventing storage.
- [ ] 3.3 Verify portability end-to-end: with portable mode chosen, the data
      directory sits next to the executable, and moving that folder to another path
      keeps profiles and settings reachable.
- [ ] 3.4 A non-portable build (the ordinary desktop app) MUST NOT be asked this
      question — the prompt belongs to the portable launch path only.

## 4. CI (all three platforms)

- [ ] 4.1 Extend the release job to build every platform on its own runner:
      `windows-latest` (portable exe), `ubuntu-latest` (AppImage),
      `macos-14` (arm64 dmg). Each uploads its artefact.
- [ ] 4.2 The job must not require an Apple certificate or signing secrets —
      the macOS artefact ships unsigned, and the workflow must not fail without
      credentials it cannot have.
- [ ] 4.3 Run the existing typecheck/build/test gates on the Linux and macOS runners
      too, so a platform-specific break is caught rather than shipped.
- [ ] 4.4 Deliver as a PR from `fix/ci-pipeline` to `main` (the user reviews and
      merges). Do not push to `main` directly.

## 5. Verification

- [ ] 5.1 Build the Windows portable artefact locally and **run it**: confirm it
      launches, acquires the kernel, and serves the UI — a build that merely
      succeeds is not evidence.
- [ ] 5.2 Confirm no installer artefact is produced.
- [ ] 5.3 Full suite green, typecheck clean, CHANGELOG entry, README gains a
      "Portable" section covering all three platforms and the macOS quarantine step.
- [ ] 5.4 Record the deferred item: the monochrome noir redesign (R51i) runs after
      this program.

## 6. Deferred (recorded, not scheduled)

- [ ] 6.1 Monochrome noir redesign (R51i) — user chose portability first.
- [ ] 6.2 Embedded-kernel fallback — offered as «Вшить в файл (500 МБ, но автономно)» and not selected (R52i).
- [ ] 6.3 macOS code signing / notarization — no Apple Developer account.
