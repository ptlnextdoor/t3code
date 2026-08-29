# STATE — jcode provider build

_Repo: `/Users/aayu/Workspace/developer/t3code` · Branch: `feat/jcode-provider`_

## DONE (verified, committed, pushed)

- **Phase 0**: `pnpm install` OK. Server typecheck `tsgo --noEmit` = **0 errors** (13 pre-existing
  suggestions, none mine). Baseline: `.planning/phases/00/00-BASELINE.md`.
- **Phase 1 (the load-bearing one)**: proved against real jcode 0.75.5:
  - jcode rejects ACP `authenticate` (`-32601`) but needs no auth.
  - `initialize → session/new → session/prompt` streams `agent_message_chunk` → `end_turn`. ✅
  - **Fix landed**: `authMethodId` optional in `AcpSessionRuntime.ts`, skip `authenticate` when
    absent (spec-correct, additive, Cursor/Grok untouched). Compiles clean.
  - Fixture: `apps/server/src/provider/testFixtures/jcode/handshake.ndjson`.
  - Findings: `.planning/phases/01/01-FINDINGS.md`.

## KEY DECISION

**Template = Cursor, NOT Grok.** jcode is a local agent binary; no OAuth/API-key. Grok's XAI
extension (686 LOC) must NOT be copied.

## NEXT (Phase 2+3) — the provider trio

Clone the Cursor trio, swap identity to `jcode`, delete Cursor-specific bits:

- `Drivers/JcodeDriver.ts` ← `CursorDriver.ts` (188 LOC, thin — easy)
- `acp/JcodeAcpSupport.ts` ← `CursorAcpSupport.ts` (115 LOC — set command `jcode`, args
  `["acp"]`, **authMethodId: undefined**, binary discovery `~/.local/bin/jcode` + PATH)
- `Layers/JcodeAdapter.ts` ← `CursorAdapter.ts` (1188 LOC — **NOT a blind clone**. Cursor's
  size is mode/approval/plan logic. jcode has `availableCommands` (model/models/effort) but no
  Cursor modes. Strip mode alias logic; keep permission + prompt streaming. Real target ~300-500 LOC.)
- `Layers/JcodeProvider.ts` ← `CursorProvider.ts` (1153 LOC — status probe: binary present +
  `jcode version --json` + acp handshake ok. Strip Cursor CLI-login probe.)
- Contracts: `JcodeSettings` in `packages/contracts/src` (binary path, extra args, env).
- Register: `builtInDrivers.ts`, `builtInProviderCatalog.ts`, `model-manifest.json`.
- Default `enabled: false` (opt-in, like Cursor — check `settings.ts`).

## GATE before writing JcodeAdapter

Read `CursorAdapter.ts` end to end FIRST (ponytail: understand before cloning). Identify exactly
which blocks are Cursor-mode-specific (delete) vs generic ACP streaming (keep). Do NOT paste 1188
lines and half-edit — that's the confident-wrong-fix trap.

## Typecheck/test commands

- Typecheck server: `cd apps/server && ../../node_modules/.bin/tsgo --noEmit` (0 errors = pass)
- `vp` CLI not installed; use `node_modules/.bin/tsgo` directly, or `pnpm -w exec`.
- Full repo typecheck needs `vp` (Vite+): `curl -fsSL https://vite.plus | bash` if wanted.

## Deferred / non-goals (do not scope-creep)

- Model-picker parity (T3 shows `configOptions`; not blocking a working chat).
- Resume = **T3-created** jcode sessions only. Importing `~/jcode-context` sessions by id = separate project.
- Mobile-specific work (rides server API).
- Upstreaming to Theo.

---

## PHASE 2/3/4 — DONE (verified end-to-end against real jcode)

- Provider trio built + registered (`builtInDrivers.ts`), settings enabled in `~/.t3/userdata/settings.json`.
- `JcodeProvider.test.ts`: 6 tests incl. live version+handshake probe. PASS.
- **`JcodeAdapter.test.ts`: live acceptance (commit `f5f33924`):**
  - **Chat**: real binary, full lifecycle streamed (`session.started`→`turn.completed`), reply text matched. ~3s.
  - **Image**: real 32x32 red PNG written to attachmentsDir, round-tripped through adapter as ACP image block; jcode replied `"red"`. ~3s.
  - Auto-skips when no jcode binary present.
- Server typecheck: 0 jcode errors. All 8 jcode tests pass.

## REMAINING (deferred, optional)

- In-app GUI smoke: launch desktop, eyeball jcode in provider list + click-through chat/image (source/CLI proven; GUI not yet eyeballed).
- Model picker / mode selection (deferred by plan; `sessionModelSwitch: "unsupported"`).
