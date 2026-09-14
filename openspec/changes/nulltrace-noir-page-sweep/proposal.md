## Why

The shell, the token layer and the frames are done, but the pages still carry their own
colours and re-implement their own chrome. Reconnaissance counted the remaining work
precisely rather than estimating it:

| File | hex literals | orphan `var(--x, #hex)` |
|---|---|---|
| `pages/FlowCanvas.tsx` | **192** | 0 |
| `pages/Email.tsx` | 51 | **20** |
| `components/FleetPanel.tsx` | 18 | 0 |
| `pages/Profiles.tsx` | 8 | 0 |
| `pages/Calendar.tsx` | 8 | 0 |
| `pages/Diagnostics.tsx` | 5 | 1 |
| `pages/SecuritySettings.tsx` | 2 | 0 |
| `pages/SyncSettings.tsx`, `pages/Extensions.tsx` | 1 each | 1 each |

Everything else is already clean. This is therefore not "18 pages by hand" — it is six
files, one of which dominates.

Two facts about that dominant file shape the work. Of FlowCanvas's 192 literals, the
overwhelming majority are **neutral greys** (`#a1a1aa` ×42, `#141416` ×32,
`#fafafa` ×30, `#71717a` ×16, …) that need to become token references and nothing
more. Only about 25 are genuinely coloured: validation state (`#22c55e` / `#ef4444`),
the live-run indicator (`#3b82f6`), and SVG edge markers with raw hex baked into
attributes (`stroke="#3b82f6"`, `#ef4444`, `#ffffff`).

Two defects the shell wave reported are also closed here, because they live in page
files rather than the shell: duplicated page titles, and several inline empty-state
variants.

## What Changes

**Every page chrome value moves onto tokens.** Neutral literals become `var(--…)`;
coloured ones become token-driven states; the orphaned `var(--x, #hex)` fallback
dialect disappears entirely, since such a fallback silently renders a colour nothing
can override.

**Flow Canvas becomes token-driven, including its inline SVG** — node borders and
fills, the validation indicator, the live-run state, and the edge markers.

**Duplicate titles go.** The shell already renders one title per page; the two pages
that render their own are corrected.

**Empty states consolidate** onto one primitive, so every page states what it is for
and what to do next in the same shape.

Operator data colours — the profile and tag colour pickers — are explicitly preserved.
They are data the operator chose, not chrome.

## Capabilities

### New Capabilities

None — this brings the pages under the existing design system.

### Modified Capabilities
- `noir-design-system`: extended from the shell to the page surface.

## Impact

- `pages/FlowCanvas.tsx`, `pages/Email.tsx`, `components/FleetPanel.tsx`,
  `pages/Profiles.tsx`, `pages/Calendar.tsx`, `pages/Diagnostics.tsx`,
  `pages/SecuritySettings.tsx`, `pages/SyncSettings.tsx`, `pages/Extensions.tsx`,
  `pages/Proxies.tsx`, plus a new empty-state primitive under `components/`.
- Tests: the existing hue/orphan guards extend from the stylesheet to every renderer
  source file, so the sweep cannot silently regress.

### Goals

- No hue in page chrome, anywhere in the renderer.
- No orphan token references.
- One empty state, one header, one set of primitives.
- Flow Canvas visually consistent with the rest without losing its function.

### Non-Goals

- No page re-architecture (R77i). Flow Canvas keeps its canvas + inspector layout.
- No light theme.
- No change to operator data colours (R76i).
- No new dependency.

### Risks and commitments

- **FlowCanvas is 2678 lines with heavy inline styling.** It is the one file where a
  mechanical substitution could break behaviour rather than appearance: some literals
  drive conditional logic (validation valid/invalid, running/stopped), not just looks.
  Each such site must keep its branch semantics.
- **SVG attributes are not CSS.** `stroke="#3b82f6"` inside a React SVG element cannot
  read a CSS variable unless the value is applied through `style` or resolved first.
  Each site needs a decision, not a find-replace.
- **Losing a semantic distinction.** Where colour carried meaning — valid versus
  invalid, for instance — removing it without a replacement makes the UI worse rather
  than monochrome. Each such site needs weight, shape or a background step instead.
