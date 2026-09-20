# Oracle brief — licensing-and-fork-protection

Blind acceptance. You are given the operator's own words (below) and the repository. You are NOT
to read `proposal.md`, `specs/`, or `tasks.md` — those are our own claims about ourselves. Your
job is to compare what the repository **actually does** against what the operator **actually
asked for**, and to say where they differ.

## The operator's words (verbatim, untranslated)

> "Смотри, у нас с публичной репозиторией, но я хочу защититься от того, чтобы нас форкали,
> хочу, чтобы у нас был примиальный функционал, хочу лицензировать свой софт и так далее,
> как это сделать, давай составим план по защите."

("примиальный" is a typo for "премиальный" — premium. Treat it as "premium".)

Answers given to the Wave-0 interview (these are the operator's own selections):

| Fork | Answer |
|---|---|
| Licence | AGPL-3.0 + commercial dual licence |
| Free/Pro boundary | "Как сейчас: локально всё бесплатно, Pro = команды + облачный синк" |
| Hardware binding | "Без привязки — только подпись" |
| Scope of this wave | Key rotation, LICENSE/TRADEMARK/CLA, Free/Pro boundary, licence check in Rust, issuance tooling |
| Git history | "Переписать историю (git filter-repo) + force-push" |
| Payments (later wave) | Telegram bot + Stars/crypto |

## What to verify independently

Do not trust any summary. Open the files, run the commands.

1. **The key rotation actually happened.** Find the key pinned in the build and the key material in
   the test suite. Prove, by execution, that a licence signed with the **old** committed private key
   is now **refused**, and that one signed with the **current** vendor key is **accepted**. Report
   the commands you ran and their real output.
   - The old key's public half (public data, safe to use): `MCowBQYDK2VwAyEAVxFPPO9Q0RRZZUYacTrT5OnBwit7GcyTpYR/ijc+tsA=`
   - If you cannot find the current private key, you may generate a *temporary* keypair and sign
     with it after substituting the pinned key — but say clearly in your verdict that this is what
     you did, and that you therefore verified the *mechanism*, not the *shipped key*.

2. **No private key is recoverable from the repository.** Search tracked files for private key
   material. Report exactly what you searched and what you found. Distinguish real key material from
   placeholders and from string literals that merely *name* the PEM header.

3. **The Rust verification is real and cannot be fooled.** Read the Rust licence module. Check that
   a malformed, tampered, expired, foreign-signed, or wrong-plan licence is refused, and that the
   function cannot panic on hostile input. Run the Rust tests for that module and report counts.
   A test that asserts only `valid == false` without naming the cause is weak — say so.

4. **Pro cannot be granted by JavaScript alone in a packaged build.** Find how the native verdict
   reaches the Node backend and check whether every clause is *deny-only*. Attack it: what happens
   when the verdict file is missing, stale, from another key, or hand-edited? Does the app crash,
   or does it degrade to Free? **Try to find a path where a hand-written verdict file grants Pro
   without a valid signature.** If you find one, that is a finding, not a nitpick.

5. **The legal surface matches what was asked.** AGPL-3.0 present and verbatim (not paraphrased)?
   Trademark policy that forbids reusing the name/logo without rebranding? A CLA that actually
   grants the rights needed to keep dual licensing lawful? Any **invented** legal fact — a company
   name, address, jurisdiction, or price that nobody supplied — is a finding: it must be a
   placeholder instead.

6. **The Free/Pro boundary did not move.** The operator explicitly kept it as it is: local work
   free, Pro = teams + cloud sync. Check that no profile limits, feature throttles, or other new
   restrictions on free users were introduced.

7. **Nothing that worked before is broken.** Run the full Node test suite and the full Rust test
   suite yourself. Baseline before this change: **145 test files / 1174 passed / 6 skipped**.
   Report the real numbers. A green run with fewer tests than the baseline is a regression.

8. **The history-rewrite procedure is real.** `git filter-repo` was absent from this machine and
   the leak spans 202 commits and 24 of 54 tags. Check that a runbook exists, that it records a
   rehearsal against a clone, and — importantly — that it did **not** force-push the live remote.

## What counts as a finding

- A claim in a document that the code does not support.
- A guard that cannot fail (a test asserting something that is true regardless of the code).
- A path that grants Pro without a valid signature.
- An invented fact in a legal document.
- A regression: fewer tests passing than the baseline, or a previously working path now broken.
- A leaked secret of any kind.

## What does not count

- Style, naming, formatting preferences.
- "Could be more thorough" without a concrete attack that succeeds.
- Anything you did not verify by reading the actual file or running the actual command.

## Return contract

≤40 lines:

```
VERDICT: ACCEPT | REJECT | ACCEPT-WITH-FINDINGS
EVIDENCE: per item above — the command you ran and the real result
FINDINGS: numbered, each with file:line and the concrete failing input/path
UNVERIFIED: what you could not check, and why
```

Quote real output. If you cannot prove something, say `UNVERIFIED` rather than assuming it works.
