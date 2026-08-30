# SWARM-PLAN.md — Opus 4.8 swarm execution plan to shippable

Companion to ARCHITECTURE.md (layers/seams), PRODUCT.md (the 30-min promise),
SUPERAPP-PLAN.md (freeze rules). This is the _who does what, to what standard,
verified how_. Last updated 2026-08-30.

---

## 0. Engineering standards (stolen from the three best sources we track)

Verified today by reading the actual repos, not from memory:

**From t3code (CONTRIBUTING.md + AGENTS.md — our own house rules):**

- Small, focused PRs. Never mix unrelated fixes. 1,000-line feature PRs get closed.
- UI change ⇒ before/after images in the PR. Motion/timing ⇒ short video.
- "Hit every surface" checklist before calling frontend done: entry points,
  clients, providers, contracts, reverse states (way in ⇒ way out), connection
  modes, docs. The most common defect is a change tested on one path only.
- Performance is sacred: no large payloads over websocket, watch CSS/GPU.
- Never kill by pattern; never write to the live `~/.t3/userdata`; never bake origins.

**From jcode (CONTRIBUTING.md + git log):**

- Conventional commits with scope: `fix(spawn):`, `feat(gmail):`, `style:`.
- Issues need repro steps, expected vs actual, logs/screenshots.
- Generated code is "deceptively plausible" — a human-comprehension pass is
  required before merge. PRs are references until understood.
- Minimal repro or failing test accompanies every bugfix.

**From omnigent (repo structure):**

- The Polly pattern: **the reviewer is never the same vendor as the author.**
  Code written by a Claude worker gets reviewed by a GPT worker, and vice versa.
- A capability test bench guards every harness/integration seam.
- CHANGELOG.md maintained; pre-commit enforced; policies as first-class config.

## 1. Swarm topology (deep mode, gated DAG)

```
COORDINATOR (this session, fable-5)
│  owns: task graph, gates, merges, the ONLY writer to main
│
├── ARCHITECT      opus-4-8, high      seam design, C4 guardianship, spike verdicts
├── BUILDER ×2-3   opus-4-8, medium    implementation nodes (one node = one worktree = one PR-shaped commit series)
├── SCOUT          gpt-5.5, none       bulk reading, upstream tracking (jcode/omnigent/Dayflow commits), context fetch
├── REVIEWER       gpt-5.5, medium     cross-vendor code review (Polly rule: GPT reviews Claude's code)
├── VERIFIER       fable-5, medium     runs gates: typecheck, 2,892 tests, team-e2e, visual screenshot diff
└── DESIGNER       fable-5, medium     sand-design conformance, one-urgency-signal-per-row audits
```

Rules of engagement:

- **One node = one worktree.** No two builders share files (separate-before-serializing).
- Builders never push to main; the coordinator lands work after REVIEWER + VERIFIER both pass.
- Every node completes with the Fable-loop handoff (thomaslentine.com/fable-guide, read 2026-08-30):
  What I built / How I verified (observed behavior — "should work" is banned) /
  Spec conformance: Met-Partial-Deviations / Flags for the judge / Confidence + why.
  Written for a skeptic, not to reassure.
- Workers batch ALL questions into one upfront round, then move. No trickle.
- The coordinator never implements. Merges yes, code no. Caught editing = stop, respawn a builder.
- Context discipline (headroom): scouts return summaries, never raw payloads,
  to the coordinator. Bulk output gets compressed; the graph, not chat, carries state.
- Opus 4.8 is the builder brain because implementation quality is the bottleneck;
  scouts stay cheap (gpt-5.5 effort none) because reading is not.

## 2. Verification stack (every node passes ALL that apply)

| Gate                | Command / method                                                | Standard                                                                                                                  |
| ------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Types               | `pnpm typecheck`                                                | 0 errors, always                                                                                                          |
| Tests               | `pnpm --filter web test` (+server)                              | 2,892 → only grows                                                                                                        |
| Routing E2E         | `node scripts/team-e2e.mjs`                                     | 0 unrouted, blocking/dated counts asserted                                                                                |
| Visual              | `node scripts/ui-screenshot.mjs` → eyeball the PNG              | every UI change, before/after, no exceptions (learned the hard way)                                                       |
| Surfaces            | AGENTS.md "hit every surface" list, walked explicitly           | reviewer confirms which entries applied                                                                                   |
| Cross-vendor review | REVIEWER (GPT) on Claude-authored diffs                         | blocking; findings fixed or explicitly waived with reason                                                                 |
| Remote smoke        | deploy to Hetzner, screenshot over Tailscale                    | any change touching C4/server/env paths                                                                                   |
| Perf                | payload size over websocket eyeballed on touched routes         | no regressions (house rule #2)                                                                                            |
| Anti-slop           | `/deslop` pass on code diffs, `/unslop` on prose, before review | reviewer sees clean diffs; mediocre output gets one fresh "scrap it, implement the elegant solution" take, not line-edits |

Worker hygiene (from claude-code-best-practice, 65k stars, read 2026-08-30):

- Workers report back before ~40% context; degradation past that is measured, not folklore.
- Slice vertically (tracer bullets: DB+server+UI in one node), never horizontal phases.
- Every skill we author gets a Gotchas section that grows with observed failure points.
- Cross-model QA validated: our Polly rule matches their cross-model workflow (Claude plans/builds, other-vendor reviews).

## 3. Skills routing (which skill, which role, when)

| Skill                                             | Used by                       | When                                                               |
| ------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------ |
| `ponytail` (lazy senior dev)                      | BUILDERS, always-on           | delete before add; stdlib before dependency; shortest working diff |
| `caveman`                                         | inter-agent messages          | worker↔coordinator traffic is terse; user-facing prose is not      |
| headroom compress                                 | SCOUT, coordinator            | any tool output >2k tokens gets compressed, hash kept              |
| `code-review` / `caveman-review`                  | REVIEWER                      | one line per finding: location, problem, fix                       |
| `blast-radius`                                    | REVIEWER on C4/contract diffs | anything touching a named seam                                     |
| `verification-before-completion`                  | ALL                           | no "done" claims without command output                            |
| `ui-screenshot` harness + `web-design-guidelines` | DESIGNER, VERIFIER            | every visual change                                                |
| `review-animations`                               | DESIGNER                      | sand-easing/motion work                                            |
| `show-me-your-work`                               | COORDINATOR                   | TSV decision trail for the whole run (unattended-work rule)        |
| `babysit` / `loop-on-ci`                          | COORDINATOR                   | after each merge until green                                       |
| `create-verification-skill`                       | one-time, Phase 0             | see §5 skill updates                                               |

Meta-routing: the swarm prompt (~/.jcode/swarm-prompt.md) is the router config.
Updated today to route hard implementation to opus-4-8 (§5).

## 4. The task graph (phases; each node independently landable)

**Phase 0 — Foundations (now, ~half a day of swarm time)**

- N0.1 `verify-skill` — create project-local verification skill wrapping the four
  gates so every future agent runs them identically. (create-verification-skill)
- N0.2 `spike-omnigent` — ARCHITECT + SCOUT on the Hetzner box. Kill criteria
  K1–K4 from ARCHITECTURE.md §8. **Verdict gates Phase 3.**
- N0.3 `g1-staleness` — NOW.md generated-at banner. Small, closes a real hole.
- GATE: cross-review + full verification stack.

**Phase 1 — Solidify what exists (~2 days)**

- N1.1 `g2-sync` — derived-down (NOW.md/FRONTS.md rsync over Tailscale on nightly
  refresh) + sessions-up design doc (build depends on N0.2 verdict).
- N1.2 `de-aayu-pass-1` — audit every hardcoded path/name/front; env-var or
  config-file each one. SCOUT enumerates, BUILDER fixes, grep proves zero left.
- N1.3 `g8-remote-verify` — prove the notice-banner fix live on the box (screenshot).
- GATE: remote smoke + review.

**Phase 2 — The stranger's first 30 minutes (~2 weeks)**

- N2.1 `voice-onboarding` — record → transcribe → existing escalation parser →
  draft roster → editable → first NOW.md. The crux node; opus-4-8, high effort,
  its own E2E fixture (three real rambling transcripts, parsed counts asserted).
- N2.2 `capturer-vendor` — vendor Dayflow-type capture as tracked upstream
  (patch queue, ARCHITECTURE.md §6 level 2). Mac-first, honest about Win/Linux.
- N2.3 `calendar-connector` — Gmail connector is the template (proactive refresh,
  never says "token").
- N2.4 `g5-proactive` — employees poll their connectors on schedules.
- GATE: a non-Aayu human (or a fresh VM) walks the 30-min flow; timed; recorded.

**Phase 3 — Substrate + distribution (~2 weeks, shaped by N0.2 verdict)**

- If spike PASSED: N3.1 migrate C4 to omnigent OpenAPI (keep our session code
  a month before deleting); N3.2 inherit auth/mobile/deploy; N3.3 per-employee
  policies on their engine.
- If spike FAILED: N3.1′ one-command deploy (Docker); N3.2′ minimal auth;
  N3.3′ policies as UI-confirm degrade (§5 table); mobile deferred.
- Either way: N3.4 `upstream-tracker` — SCOUT job that diffs jcode/omnigent/
  Dayflow releases weekly and files caveman-style summaries.

**Phase 4 — Ship (~1 week)**

- N4.1 trust/docs (why it reads email+screen; local-first visible).
- N4.2 CHANGELOG.md + release cut + install script.
- N4.3 tribe beta: 3 users whose lives look like Aayu's; instrument the 30-min
  funnel; fix the top three drop-offs.

## 5. Skill updates made today

- **swarm-prompt** (~/.jcode/swarm-prompt.md): added opus-4-8 routing for hard
  implementation nodes (was fable-5/gpt-5.5 only). Design/review stays fable-5;
  bulk context stays gpt-5.5 effort-none. Deliberate: builders are the quality
  bottleneck, scouts are not.
- **Gap:** no project-local verification skill exists — that is N0.1, so the
  four gates stop living in agents' heads.
- Audited and left alone: ponytail/caveman/code-review families are current.

## 6. SpaceX operating mode (how pain converts to achievement here)

1. **Question the requirement.** Every node names its owner and reason; orphan
   requirements get cut in review, not built politely.
2. **Delete first.** ponytail always-on; reviewers reward negative diffs.
3. **The gates are the test stand.** Nothing "works" until it survives all
   eight rows of §2 — the same way an engine isn't done until it's fired.
4. **Iteration as data.** Cheap reversible nodes, half-day max; a failed node
   is information, not shame. Exception: irreversible actions (sends, deletes,
   payments) always gate on a human.
5. **The graph is the org chart.** No standing meetings, no channels — artifacts
   on nodes, DMs for exceptions.

## 7. Honest odds and the standing risk

- Phase 0–1 land clean: ~90%.
- Phase 2 voice-onboarding good enough that a stranger keeps going: ~60% first
  pass; the E2E fixtures and the tribe beta are what raise it.
- Full "any-tribe-user, 30 minutes" in ~5 weeks of swarm time: ~55% (unchanged
  from PRODUCT.md; the swarm compresses calendar time, not uncertainty).
- **The standing risk is still F1: this eats the paper.** The swarm's whole
  point is that builders run while Aayu writes IECBES. The coordinator enforces
  it: no node ever requires Aayu except gates marked human, and those batch
  into one daily review.

## 8. Launch checklist (before spawning anything)

- [ ] G9: Hetzner token revoked (Aayu, 2 min — still open)
- [x] Repo clean, tests green (2,892), typecheck 0
- [x] Standards doc (this file) committed
- [x] swarm-prompt routes opus-4-8
- [ ] Aayu says go
