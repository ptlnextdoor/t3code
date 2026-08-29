# SUPERAPP-PLAN.md

Durable plan for the personal productivity super-app. Survives context resets.
Mirror of initiative `superapp`. Last updated 2026-08-29.

## The problem (from real data)

Aayu runs ~35 live/dormant fronts across 1,518 real chats (12,081 session files total).
He loses work to crashes and 300+ terminal tabs, and duplicates chats for the same issue.
Dayflow (6 months, 139 days of screen activity) shows the sharpest fact:

- **38 hrs building agent tooling vs 17.5 hrs on the #1 deliverable** (IECBES paper), last 60 days.
- **16.2 distinct activities per day** — thrash, not multitasking.
- Every Melani + Dayflow brief converged on one failure mode: the paper loses each evening
  session to a newer, shinier project.

So this super-app is itself the risky category (tooling). It is justified ONLY if it
_reduces_ fronts and thrash, not adds a 4th tool. Timebox hard.

## The decision (three apps, one shell)

Verified compatible: t3code (React 19 + Electron 41) and grokbot (React 19 + Electron 42)
are the **same stack** — genuinely mergeable. Melani is Swift — cannot merge code, only concept.

```
t3code  (Electron shell — the body; already has the jcode engine wired)
├── Left rail: all 1,518 chats  [DONE — imported, named, resumable]
├── Top: TODAY panel  ← Melani's ONE good idea, ported to React (~200 lines)
│     reads Dayflow chunks.sqlite (read-only) + ~/.jcode/knowledge-org/NOW.md
├── Engine: jcode acp  [DONE]  +  grokbot router (Cursor/Claude/Codex/OpenRouter)
└── Usage meter + approval queue  (port last)
```

Melani stays installed and private. Its Swift is NOT ported. Its memo-generators die.

## Slices (smallest-first, each independently shippable)

1. **TODAY panel** — read-only Dayflow bridge in `apps/server` + panel at top of window.
   Highest value (the actual differentiator), smallest lift. Subagent: `dayflow-bridge-builder`.
2. **grokbot router** — extract routing + usage metering, express as t3code providers using the
   existing contracts. jcode provider is the reference. Subagent: `provider-router-merger`.
3. **Usage meter + approval queue** — port last.

## What is already done

- **jcode provider** on branch `feat/jcode-provider`: Driver/Adapter/Provider/AcpSupport/
  TextGeneration wired into contracts + `builtInDrivers.ts`. Chat streams, images work,
  **resume via `session/load` proven on an 843-msg session**. Server + contracts typecheck clean,
  full build succeeds, jcode baked into `dist/bin.mjs`.
- **1,518 chats imported** into `~/.t3/userdata/state.sqlite` (project "jcode (imported)"),
  all named, as live-attach threads.
- **Knowledge org** at `~/.jcode/knowledge-org/`: NOW.md (what needs you today),
  FRONTS.md (all 35 fronts), refreshed nightly by launchd `com.aayu.jcode-knowledge-refresh`.

## Hard constraints

- Never port Melani's Swift.
- Never write to Dayflow's DB (read-only bridge).
- Extend the provider seam; never rewrite it. Keep `pnpm typecheck` at 0 errors.
- No large payloads over the websocket (t3code perf rule, AGENTS.md).
- Ship the smallest useful slice. The paper comes before gold-plating this.

## Open risk

The 20% failure mode: this super-app becomes the next "newer shinier thing" that steals the
paper's session. Mitigation: Slice 1 only, then freeze until IECBES is submitted.

## The employee layer (decided 2026-08-29, build AFTER IECBES)

Aayu named what he actually loves about grokbot, and it is not the router
(t3code already has all six drivers). It is the persona layer:

- The unit is an EMPLOYEE, not a session. Sessions are disposable
  implementation details the employee hides. You ask "where are we?",
  you never resume chat #847.
- Role, name, avatar are set BY TALKING TO IT, not in settings.
- Connections are owned by the employee: "connect Gmail" = one button +
  login it walks you through. No consoles, no tokens. Elder-usable.
- Execution is remote (server), so the laptop never chokes on bash.

Stack: Models (brains) -> jcode harness (hands) -> t3code shell (window)
-> Employees (people). We replace NEITHER the model NOR the harness.

Proposed roster mapped to the 55 fronts:
Paper - Zaidi, IECBES, arXiv, Linderman gate
Outreach - Stanford PIs, Coleman, Zare, NextSense
Apps - Boom, college apps, scholarships, SAT
Bench - Kahlus repo, plasma hardware, PAROL6
Ops - Mac disk, calendar, Gmail hygiene

The 1,518 imported chats become employee MEMORY, not rail clutter.
TODAY panel becomes "what each employee is escalating to you."
Remote exec: t3code server already runs standalone on :3773; moving it to
a VPS is configuration, not architecture.

Freeze rule still holds: none of this before the paper is submitted.
