# Tasks

## 1. One folder holds everything (R01, R02, R03)

- [ ] 1.1 `config.ts`: settings base resolves beside the executable in portable mode
- [ ] 1.2 `config.ts`: a recorded directory is honoured only while it exists; otherwise the portable folder
- [ ] 1.3 `config.ts`: a recorded directory that exists but no longer contains data falls back to the portable folder
- [ ] 1.4 Shell (`main.rs`): resolve the same settings directory the backend will
- [ ] 1.5 WebView2 cache directory follows the portable folder
- [ ] 1.6 MCP audit log resolves under the data directory
- [ ] 1.7 Tests: resolution order; a moved folder; a stale recorded path; no writes under the user profile

## 2. Profile table columns (R04)

- [ ] 2.1 Remove the Device/OS, Fingerprint and Preflight header and body cells
- [ ] 2.2 Keep the actions column reachable; adjust the wide-table min-width
- [ ] 2.3 Test: the header carries neither of the three labels

## 3. Import/export into Settings (R05)

- [ ] 3.1 Move Import CSV, Export CSV and Import Bundle from the Profiles toolbar to Settings → Data Folder
- [ ] 3.2 Each keeps its behaviour, including the file picker and the bundle parse
- [ ] 3.3 Test: the toolbar no longer renders them; Settings does

## 4. Breadcrumb names the group (R06)

- [ ] 4.1 The first breadcrumb segment is the sidebar group of the active destination
- [ ] 4.2 Test: every page's breadcrumb equals its group

## 5. MCP (R07, R08, R09)

- [ ] 5.1 Start the MCP server as the backend comes up; report a failure reason
- [ ] 5.2 Remove the MCP-config copy control from the panel
- [ ] 5.3 Documentation opens the GitHub docs URL in the system browser
- [ ] 5.4 Tests: autostart attempted on boot; the copy-config control is absent

## 6. Version line (R10)

- [ ] 6.1 Restyle with design tokens; add a progress state
- [ ] 6.2 Honour reduced motion
- [ ] 6.3 Test: the control renders a state class per update state

## 7. Verification

- [ ] 7.1 typecheck, full vitest, cargo test
- [ ] 7.2 Live: a portable launch writes nothing under the user profile
- [ ] 7.3 Live: the profiles table, Settings actions, breadcrumbs, MCP autostart
