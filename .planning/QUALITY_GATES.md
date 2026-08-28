# QUALITY GATES — mandatory gauntlet for every PR and the final merge

_No commit merges to `feat/jcode-provider` without Tier 1. No merge to `main` without
all tiers. Gate artifacts (reports, logs) commit under `.planning/phases/<N>/gates/`._

## Tier 1 — Standard checks (every commit / every PR)
Run in order; a failure stops the line (fix, don't waive):
1. **Typecheck** — repo's TS project check (`vp` task / `tsc -b`). Zero new errors vs
   Phase 0 baseline.
2. **Lint** — repo lint incl. `oxlint-plugin-t3code` custom rules. Zero new warnings.
3. **Unit tests** — full suite. Zero new failures vs baseline; new code ships with tests
   (clone the Grok test set's coverage shape).
4. **Build** — server + web build clean.
5. **Self-review diff pass** — read the full diff once before pushing; no debug prints,
   no commented-out code, no stray files, commit messages explain WHY.
6. **Conventional atomic commits** — one logical change per commit
   (`feat(provider): ...`, `test(acp): ...`), so upstream merges stay surgical.

## Tier 2 — Skill-based review gauntlet (every phase PR)
Run each as its own review pass; file findings as PR comments; every finding either
fixed or explicitly waived with a reason in the PR description:
1. **/code-review** — standards + intent axes against the phase's stated goal.
2. **/ponytail-review** — over-engineering hunt: delete reinvented stdlib, unneeded
   abstraction, boilerplate nobody asked for. (Enforces the ≤1,200 LOC net target;
   breach triggers a re-check of the Grok template path.)
3. **/blast-radius** — what could this change break OUTSIDE the diff (registry
   hydration, snapshot aggregation, other providers' tests, upstream merge surface)?
   Prove the one fact that makes it safe.
4. **/karpathy-guidelines** — LLM-mistake sweep (hallucinated APIs, wrong imports,
   silent behavior drift from the template files).
5. **/typescript-best-practices** + Effect-TS conventions — match the repo's idioms
   (Effect layers, Schema branding, no ad-hoc promises where Effect is expected).

## Tier 3 — Thermo-nuclear passes (Phase 6, before merge to main; rerun on release tags)
1. **/thermo-nuclear-review** — deep security + correctness audit of the whole branch
   diff vs upstream main: process spawning (binary path injection), env handling,
   NDJSON parsing robustness, permission-prompt bypass, session-id trust.
2. **/thermo-nuclear-code-quality-review** — strict maintainability audit: abstraction
   quality, file size, condition sprawl, naming, template-clone drift (did we copy Grok
   warts we should have deleted?).
3. **/thermos variant** — run both nukes in parallel via subagents, then synthesize
   findings into one fix list. Fix all criticals + highs; mediums fixed or ticketed.
4. **/deslop** — final sweep for AI slop: dead comments, needless defensive checks,
   redundant re-validation, verbose naming, useless try/catch, filler docs. The diff
   should read like the surrounding upstream code wrote it.
5. **/second-opinion** — external-model review (Codex or Gemini CLI) of the final
   branch diff; triage its findings honestly.
6. **/verification-before-completion** — before declaring done: re-run Phase 5's two
   E2E workflows against the real jcode binary and attach fresh evidence. No claim of
   "works" without an artifact.

## Tier 4 — Merge & sync discipline (ongoing)
- **PR acceptance checklist** (applies to every PR incl. upstream-sync PRs):
  - [ ] Tier 1 green in CI
  - [ ] Tier 2 findings resolved/waived-with-reason
  - [ ] No secrets, tokens, or absolute user paths committed
  - [ ] Diff touches only files the phase claims to touch
  - [ ] Upstream-conflict surface documented if registration files changed
- **Upstream sync PRs**: never rubber-stamp. Run typecheck + provider tests on the
  merge result; read upstream's changes to `provider/acp/*` and `effect-acp` (our
  dependency surface) before merging.
- **Rule of holes**: if a gate keeps failing for the same root cause twice, stop
  patching symptoms; use /systematic-debugging and fix the cause.

## Waiver policy
A gate finding may be waived ONLY with: (a) written reason in the PR, (b) a ticket if
it's deferred work, (c) never for security findings. Waivers are ponytail-style marked
in code (`ponytail: <ceiling + upgrade path>`).
