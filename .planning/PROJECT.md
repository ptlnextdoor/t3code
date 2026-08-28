# PROJECT: jcode provider for T3 Code fork

_GSD project file. Fork: `ptlnextdoor/t3code` tracking `pingdotgg/t3code`. Branch: `feat/jcode-provider`._

## Vision
T3 Code becomes the persistent GUI for aayu's agents while **jcode stays the engine**
(memory graph, skills, providers). Chats never "die with the terminal" again: T3's
desktop/mobile/web apps drive jcode over ACP, and Theo's upstream keeps flowing in.

## Why this is feasible (verified, not vibes)
- `jcode acp` handshakes: `protocolVersion: 1`, `loadSession: true`, `sessionCapabilities.resume/close`. Verified live 2026-08-28.
- T3 already drives Cursor and Grok over ACP (`apps/server/src/provider/acp/*`, `packages/effect-acp`). jcode rides the same rails.
- Upstream sync workflow already committed (`.github/workflows/sync-upstream.yml`).

## First-principles pass (Musk advisor mode, no roleplay)
- **Question the requirement:** "jcode support in T3" decomposes to exactly one
  irreducible need: *T3's server can spawn `jcode acp`, speak ACP to it, and render the
  stream*. Everything else (settings UI, icons, model manifest) is registration glue.
- **Delete before building:** we write **zero new protocol code**. The asymptotic floor
  is "new enum value + launch args + status probe." Target ≤ 1,200 LOC net including
  tests. If we exceed ~2,500 LOC, we're re-implementing something T3 already has: stop
  and re-check the Grok path.
- **Idiot index check:** Grok's provider surface ≈ 42 files, but most are clones of a
  template. Real novel logic ≈ 4 files (AcpSupport, Driver identity, status probe,
  settings schema). Ratio ≈ 10:1 boilerplate-to-logic. Clone mechanically, think only
  in the 4.
- **Probability of success:** ~85% that a working chat round-trip lands. Most likely
  failure mode (the remaining 15%): T3's `AcpSessionRuntime` assumes provider-specific
  extensions (auth methods, session modes) that jcode doesn't emit; mitigation is
  Phase 1's fixture capture BEFORE writing any provider code.
- **Iteration as data:** every phase ends with a runnable check. A phase that can't
  demonstrate its outcome doesn't merge.

## Requirements (scoped)
1. `jcode` appears in T3's provider list when the jcode binary is on PATH.
2. New session → prompt → streamed response works in T3 web + desktop.
3. Existing jcode sessions are resumable from T3 (ACP `loadSession`/`resume`).
4. Tool calls + permission prompts render (T3's ACP path already maps these).
5. Fork stays mergeable with upstream: all changes additive; registration edits minimal.
6. Quality gates (below) pass before ANY merge to `main`.

## Non-goals (deleted requirements — each had no owner)
- jcode model picker parity (T3 shows what ACP reports; no custom model UI). 
- jcode-specific settings beyond binary path + default args.
- Mobile-app-specific work (rides the same server API).
- Upstreaming to Theo (he's not accepting big features; revisit later).

## Phases
Roadmap in ROADMAP.md. Each phase = one PR into `feat/jcode-provider`, gated by
the review gauntlet in QUALITY_GATES.md. Final merge to `main` re-runs the full gauntlet.
