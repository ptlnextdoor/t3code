# ROADMAP: jcode provider

_Goal-backward: "aayu opens T3 Code, picks jcode, chats with full memory, resumes old sessions."
Derive what must be TRUE, build only that. Each phase = one PR, atomic commits, gates in
QUALITY_GATES.md._

## Phase 0 — Environment + baseline green  (wave 1)
**Must be true:** the fork builds and upstream's own checks pass locally, so later
failures are OURS, not inherited.
- Install `vp` (Vite+), `vp i`, run repo typecheck + test suite; record baseline results
  (count of pre-existing failures, if any) in `phases/00/00-BASELINE.md`.
- Run `npx t3@latest`-equivalent from source (`apps/server` + `apps/web`) once; screenshot
  a working Codex/Claude session to prove the harness itself runs on this machine.
**Verify:** baseline doc exists; server boots; one existing provider works from source.
**Risk:** Vite+/Node version mismatch. Mitigate: devcontainer config exists in repo.

## Phase 1 — Protocol fixture capture  (wave 1, parallel with 0)
**Must be true:** we know exactly what `jcode acp` emits, so the adapter is written
against fixtures, not guesses. (This kills the main 15% failure mode.)
- Script `scripts/jcode-acp-fixture.mjs`: spawn `jcode acp`, run initialize →
  session/new → prompt → session/load, record NDJSON both directions.
- Save fixtures under `apps/server/src/provider/testFixtures/jcode/`.
- Diff jcode's capability surface against what `AcpSessionRuntime` + `AcpRuntimeModel`
  consume (auth methods, modes, permission requests, terminal capability).
**Verify:** fixture files committed; a table in `phases/01/01-FINDINGS.md` mapping every
AcpRuntimeModel expectation → jcode's actual behavior → gap/no-gap.

## Phase 2 — Contracts + ACP support  (wave 2)
**Must be true:** T3's type system knows jcode exists and how to launch it.
- `packages/contracts`: `JcodeSettings` schema (binary path, extra args, env).
- `provider/acp/JcodeAcpSupport.ts` cloned from `GrokAcpSupport.ts`: command discovery
  (`~/.local/bin/jcode`, PATH), args `["acp"]`, version probe (`jcode version --json`),
  capability gates from Phase 1 findings.
- Unit tests cloned from `GrokAcpSupport.test.ts`, run against Phase 1 fixtures.
**Verify:** typecheck green; new tests pass; no existing test broken.

## Phase 3 — Driver / Adapter / Provider trio  (wave 2, after contracts land)
**Must be true:** T3's server can construct, snapshot, and stream a jcode provider.
- `Drivers/JcodeDriver.ts` (template: GrokDriver, 164 LOC).
- `Layers/JcodeAdapter.ts`, `Layers/JcodeProvider.ts` (status probe: binary present +
  version + acp handshake ok → available; else clear unavailable reason).
- Register: `builtInDrivers.ts`, `builtInProviderCatalog.ts`, `model-manifest.json` entry.
- Tests mirroring the Grok test set (adapter, provider, registry hydration).
**Verify:** `ProviderRegistry` tests pass with jcode registered; server boots and
`provider list` snapshot includes jcode with correct status on this machine.

## Phase 4 — UI registration  (wave 3)
**Must be true:** jcode is pickable and legible in the web/desktop UI.
- `providerDriverMeta.ts` (name "jcode", description), `providerModels.ts`,
  `providerIconUtils.ts` (icon asset), settings form section for `JcodeSettings`.
**Verify:** web app renders jcode in provider settings + new-chat picker; screenshot in PR.

## Phase 5 — End-to-end proof  (wave 3)
**Must be true:** the actual user workflow works.
- E2E: new jcode chat from T3 web → prompt → streamed reply → tool call renders →
  permission prompt round-trips.
- Resume: open an existing jcode session (one of the canonical sessions from
  `~/jcode-context/00-MASTER-INDEX.md`) inside T3.
- Record both as short screen captures; attach to PR.
**Verify:** both workflows demonstrated against the REAL jcode binary, not mocks.

## Phase 6 — Quality gauntlet + merge to main  (wave 4)
Run the full QUALITY_GATES.md sequence (thermo-nuclear review, thermo-nuclear code
QUALITY review, deslop, ponytail-review, blast-radius, second-opinion, standard checks).
Fix everything found. Then merge `feat/jcode-provider` → `main`.
**Verify:** gauntlet artifacts committed under `phases/06/`; merge done; tag `jcode-v0.1`.

## Phase 7 — Upstream-sync hardening  (wave 4)
**Must be true:** Theo's next drop doesn't silently break the provider.
- Add a tiny CI job on the fork: on every sync-PR, run typecheck + jcode provider tests.
- Document the conflict-prone files (registration points) in `.github/JCODE_FORK.md`.
**Verify:** simulate a sync (fetch upstream, merge locally), gates run, provider survives.
