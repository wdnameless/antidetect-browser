## 1. Registry expansion

- [ ] 1.1 Read `mcp/src/tools.ts` and `mcp/src/auth.ts` first, then add tools for the uncovered areas. **Serialize with `add-form-filling-helper` on `mcp/src/tools.ts`** — coordinate before editing.
- [ ] 1.2 Group coverage: **proxies** (list, create, delete, check), **extensions** (list, install, delete), **flows** (list, get, run, validate), **task groups** (list, get, tasks, start, stop), **trash** (list, delete forever — restore already exists), **cookies** (export, import), **triggers** (list, create, delete, toggle), **tags** (list, attach, detach), **batch** (bulk start, bulk stop, bulk delete).
- [ ] 1.3 Every tool goes through the existing registration path: a `ToolManifest` entry, a `case` in `executeToolInternal`, and membership in the correct name set in `auth.ts`. Do not add a parallel registration mechanism.

## 2. Risk classification

- [ ] 2.1 Default tier: read operations and reversible routine actions.
- [ ] 2.2 Gated tier: destructive or credential-touching operations — anything that deletes durable data (trash delete-forever, profile delete, bulk delete), reveals a secret, or mutates credentials. Gate them behind the existing `admin` / `profile:write_danger` scopes; do not invent a new scope.
- [ ] 2.3 Review the whole list once more against the prohibited set: no tool may expose raw CDP, arbitrary process execution, arbitrary filesystem access, or unbounded evaluation.

## 3. Documentation and tests

- [ ] 3.1 Update the tool list and its tiers in `mcp/README.md` (it enumerates the tiers today and would otherwise be wrong).
- [ ] 3.2 Tests: every new tool is classified (no tool present in neither name set — a tool that is neither default nor gated would be unreachable or ungated); gated tools are refused without the required scope; a representative gated tool is refused for a standard-scope caller and allowed for an admin-scope caller.
- [ ] 3.3 Full suite green + typecheck clean; CHANGELOG; `openspec validate extend-mcp-tool-surface --strict`.
