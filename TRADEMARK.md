# NullTrace Trademark Policy

This policy governs the use of trademarks, service marks, trade names, logos, and brand elements associated with the **NullTrace** project ("Trademarks").

---

## 1. Rationale: Code vs. Brand

NullTrace is distributed under the GNU Affero General Public License, Version 3 (AGPL-3.0) with a commercial dual-licensing option. 

Under the open-source license, you are free to study, fork, modify, and redistribute the source code. However, open-source licenses grant copyright permissions; **they do not grant any trademark license or permission to use our brand identity**. 

The purpose of this Trademark Policy is to ensure that users know whether the software they are downloading or using is an authentic build provided by the official NullTrace maintainers or an independent fork.

---

## 2. Permitted Uses (Forks & Code Freedom)

You **MAY**:
- Fork the repository, modify the code, and distribute your fork in accordance with the AGPL-3.0 (or a separate commercial license agreement).
- State truthfully and factually that your software is "based on the NullTrace source code" or "forked from NullTrace", provided that such statement does not imply endorsement, sponsorship, or association with the official NullTrace project.
- Link to the official NullTrace repository or documentation in truthful, non-misleading technical contexts.

---

## 3. Prohibited Uses (Mandatory Rebranding for Redistributed Builds)

You **MUST NOT**:
- Distribute binaries, installers, Docker images, packaged releases, or services using the name **"NullTrace"**, **"Null Trace"**, or any confusingly similar variation as the primary product name.
- Use the official NullTrace logos, icons, wordmarks, or artwork located in `assets/brand/` (and related project assets) in any redistributed software, website, or marketing material.
- Retain the official application bundle identifier / App ID:
  - **`com.antidetect.browser`** (or `io.nulltrace.browser`, `com.nulltrace.*`)
  You must replace the bundle identifier, product name, executable name, and metadata with your own identifier before distributing builds.
- Imply, state, or suggest that your build, fork, or service is affiliated with, maintained by, or endorsed by the original authors and maintainers of NullTrace.

---

## 4. Rebranding Checklist for Forks

If you choose to distribute modified or unmodified versions of this software publicly, you **MUST complete a full rebrand**:
1. [ ] **Name**: Choose a distinct product and project name that does not contain "NullTrace".
2. [ ] **Brand Assets**: Replace all logos, icons, splash screens, and favicon assets (`assets/brand/*`, `renderer/public/*`, `src-tauri/icons/*`).
3. [ ] **Bundle Identifier**: Change `com.antidetect.browser` in `src-tauri/tauri.conf.json` and `package.json` to your own reversed domain identifier.
4. [ ] **Domain & Links**: Update support links, documentation links, API endpoints, and license purchase URLs to your own infrastructure.

---

## 5. Contact & Permissions

For requests regarding commercial brand licensing, authorized partner programs, or trademark clarification:
- **Contact**: `REPLACE-ME: trademark@nulltrace.io or maintainer email`
