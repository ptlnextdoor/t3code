# ARCHITECTURE.md — The Superapp, End State and Path

Durable architecture for the personal-productivity superapp. Companion to
SUPERAPP-PLAN.md (which holds the _why_ and the freeze rules). This holds the
_what_ and the _how_, in enough depth that nothing important is discovered late.
Last updated 2026-08-30.

---

## 0. One-sentence thesis

Own the three layers nobody else can build (Face, Brain, Truth); rent the
commodity layers (Substrate, Metal) from open source; keep the executor (jcode)
because it is ours and fast; make every seam swappable so no vendor — including
omnigent — can hold the stack hostage.

## 1. The five layers

```
┌─────────────────────────────────────────────────────────────┐
│ L5 FACE      t3code shell + grokbot sand design             │  OURS
│              Team rail · Queue · briefings · connections UI  │
├─────────────────────────────────────────────────────────────┤
│ L4 BRAIN     Employee layer                                  │  OURS (the moat)
│              roster · escalation parser · briefing builder   │
│              knowledge org (NOW.md, FRONTS.md, 1,518 chats)  │
├─────────────────────────────────────────────────────────────┤
│ L3 TRUTH     Personal data plane                             │  OURS (privacy boundary)
│              Dayflow (screen) · Gmail · Calendar · local FS  │
├─────────────────────────────────────────────────────────────┤
│ L2 SUBSTRATE Session/host/sandbox/policy orchestration       │  RENTED
│              today: t3code server (jcode direct)             │
│              candidate: omnigent server (pending spike)      │
├─────────────────────────────────────────────────────────────┤
│ L1 EXECUTOR  jcode (fast loop, our repo)                     │  OURS
│              other harnesses (Codex/Cursor/…) via L2 later   │
├─────────────────────────────────────────────────────────────┤
│ L0 METAL     Mac (personal data + Dayflow) ·                 │  RENTED
│              Hetzner CPX (compute) · Tailscale (network)     │
└─────────────────────────────────────────────────────────────┘
```

**Layer rule:** each layer talks only to the layer below through a named
contract (§3). No layer reaches two levels down. This is what makes L2
swappable — the whole omnigent decision reduces to "swap what's behind
contract C2."

## 2. What each layer owns (and explicitly does NOT own)

### L5 Face

- Owns: rendering, interaction, the sand design system (DESIGN.md, sand.css),
  the one-urgency-signal-per-row discipline, screenshot harness.
- Does NOT own: any business logic. If a component decides _what_ to show
  rather than _how_, that logic belongs in L4. (We already learned this: the
  `defaultProjectRef` silent no-op bug was L5 making an L4 decision badly.)

### L4 Brain — the moat

- Owns:
  - **Roster** (Paper, Outreach, Apps, Bench, Ops) — a mapping, never a store.
  - **Escalation parser** (`todayPanel.logic.ts`) — NOW.md → routed items.
  - **Briefing builder** (`briefing.ts`) — employee + item → prefilled prompt.
  - **Knowledge org** (`~/.jcode/knowledge-org/`) — manifest of 1,518 chats,
    FRONTS.md, nightly refresh.
  - **Employee policies** (future): per-employee spend caps, approval rules,
    tool allowlists. Expressed here, _enforced_ in L2.
  - **Task memory** (future): what each employee did, learned, was corrected on.
- Does NOT own: session execution, token refresh mechanics, transport.

### L3 Truth

- Owns: every connector to Aayu's real life. Dayflow sqlite (read-only,
  hard rule), Gmail (proactive refresh + keeper, never says "token"),
  Calendar (not built), filesystem facts (disk, processes).
- Privacy boundary: **raw personal data never leaves machines Aayu owns.**
  L3 runs on the Mac (Dayflow is Mac-only) and syncs _derived summaries_
  (NOW.md), never raw databases, to remote hosts. See §7.
- Does NOT own: interpretation. L3 reports facts; L4 decides what matters.

### L2 Substrate

- Owns: sessions, streaming, hosts, remote execution, sandboxes,
  policy _enforcement_, multi-harness dispatch, (eventually) mobile access.
- Today this is t3code's server running jcode directly. The omnigent spike
  (§8) decides whether it becomes omnigent's server with jcode as a harness.
- Does NOT own: which employee a task belongs to, or anything rendered.

### L1 Executor

- jcode. Our repo, our speed. Community PRs land upstream = us.
- Future: per-task harness choice (an employee routes a UI task to the
  harness best at it). That choice is an L4 decision executed by L2.

### L0 Metal

- Mac: personal data plane + daily driver. Must stay fast (the whole point).
- Hetzner CPX (Tailscale 100.75.151.44): compute. Sized by measurement
  (~1.2 GB agent load), not vibes. Upgrade path: bigger box or a second box
  per workload class — L2's problem, invisible above.
- Tailscale: the only network path. No public ports beyond SSH.

## 3. The seams (named contracts — the whole architecture is these)

| #   | Between            | Contract today                                                                                                     | Stability rule                                                                                  |
| --- | ------------------ | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| C5  | Face→Brain         | TS interfaces in `employees/` (`summarize.ts` output, `briefing.ts` input)                                         | Ours; change freely with tests                                                                  |
| C4  | Brain→Substrate    | "open a thread in project P, prefill text T, on host H" + session status stream                                    | **The pivotal seam.** Keep it this thin. If it stays thin, swapping L2 is a week, not a rewrite |
| C3  | Truth→Brain        | NOW.md (structured markdown, parser-tested), Dayflow read-only sqlite, connector status enum (Connected/Reconnect) | Format changes require parser + E2E updates in same commit                                      |
| C2  | Substrate→Executor | today: jcode ACP/provider seam in t3code contracts. Under omnigent: their harness API (YAML/ACP)                   | Extension points only — never patch substrate internals (§9)                                    |
| C1  | Executor→Metal     | ssh/Tailscale, systemd, env overrides (`T3CODE_NOW_MD` etc.)                                                       | Everything env-overridable; no hardcoded homedir paths (learned 2026-08-29)                     |

**C4 is the architecture.** Every feature request gets asked: "does this fatten
C4?" If yes, redesign. A fat C4 is how we end up unable to leave any substrate.

## 4. Data flows (end to end)

### 4a. The morning read ("what needs me now")

```
Dayflow chunks.sqlite ─┐  (Mac, read-only)
Gmail API ─────────────┤→ nightly refresh (launchd) → NOW.md → escalation
Calendar (future) ─────┘                                parser → roster routing
                                                        → Team rail + Queue (L5)
```

Failure mode: refresh silently stops → stale NOW.md presented as current.
Mitigation: NOW.md carries a generated-at header; L5 renders staleness > 24h
as a visible warning, not silence. (Not yet built — gap G1.)

### 4b. Acting ("do it")

```
Click employee/queue action → briefing.ts builds prompt →
C4: open thread(project, prefill, host) → L2 session on chosen host →
jcode executes → stream back → thread visible in rail
```

Human-in-the-loop today: prompt is prefilled, never auto-sent. Autonomy comes
later _only_ behind per-employee policies (§5).

### 4c. Side effects (email, later calendar/payments)

```
Employee drafts → two-step confirm in L5 → L3 connector sends →
result recorded in employee memory (future)
```

Rule: every irreversible action has an approval gate. No exceptions until a
policy explicitly grants one, and payments never.

## 5. Governance: employees × policies

The insight from studying omnigent: their policy engine (allow/block/pause,
stacked server→agent→session) maps 1:1 onto employees. Whether or not we adopt
their server, we adopt this _shape_:

| Employee | Spend/day | Shell                         | Email send     | Sandbox                           |
| -------- | --------- | ----------------------------- | -------------- | --------------------------------- |
| Paper    | $5        | ask                           | n/a            | no — needs local LaTeX            |
| Outreach | $2        | no                            | **always ask** | no                                |
| Apps     | $2        | no                            | ask            | no                                |
| Bench    | $5        | allow (repo dirs only)        | n/a            | yes — disposable for risky builds |
| Ops      | $1        | ask (destructive: always ask) | n/a            | no — needs the real Mac           |

Policies are _declared_ in L4 (part of the employee), _enforced_ in L2.
If L2 can't enforce (today's t3code server can't), the policy degrades to a
UI confirm — visible, never silently dropped.

## 6. The upgrade strategy (the Cursor question, answered)

Hierarchy, cheapest first — never move down without exhausting the level above:

1. **Extension points** (free): omnigent harness API, OpenAPI surface, policy
   handlers; jcode is upstream-is-us. `omni upgrade` / `git pull` = free R&D.
2. **Patch queue** (cheap): unavoidable modifications live as explicit patches
   (patch-package style — the `effect` beta patch on Hetzner is the exemplar).
   Reapply on upgrade; conflicts surface loudly.
3. **Hard fork** (Cursor mode — expensive, forbidden without a written reason
   in this file): only if upstream refuses a needed surface.

Pinning rule: substrate dependencies pin exact releases. Upgrades are
deliberate: read changelog → run our E2E (team-e2e.mjs must stay 0 unrouted)
→ bump → commit. Never track main of a 3,000-commit repo.

## 7. Sync & multi-machine truth

Current reality: Mac has the 1,518 chats + Dayflow; Hetzner has a fresh DB and
a static NOW.md snapshot. This split is _correct_ (privacy boundary, §2 L3)
but the sync is missing.

Design:

- **Derived artifacts sync down** (Mac → box): NOW.md, FRONTS.md, roster
  config. One-way rsync over Tailscale on the nightly refresh. Small, safe.
- **Session records sync up** (box → Mac): remote sessions appear in the Mac
  rail. Under omnigent this is native (sessions follow you). Under t3code
  server it needs building — one reason the spike matters.
- **Raw personal data never syncs.** Dayflow sqlite, Gmail tokens, state.sqlite
  chat bodies stay on the Mac. Remote employees operate on summaries.
- Conflict rule: Mac is the source of truth for L3/L4 data; box is the source
  of truth for sessions it ran. No bidirectional merge of the same file, ever.

## 8. The omnigent spike (decides L2) — half a day, timeboxed

On the Hetzner box, pinned release:

1. Install omnigent, run one real task via `omnigent claude` and one custom
   YAML agent.
2. Wire jcode as a custom harness (ACP path). Measure loop latency vs raw.
3. Register the box as a host; check session-follow from Mac browser + phone.
4. Attempt one per-employee-style policy (spend cap + shell approval).
5. Measure RAM (Python server on a 3.8 GB box alongside 266 MB t3code server).

Kill criteria (any one fails → keep t3code server, steal ideas only):

- K1: >30% latency overhead on the jcode loop.
- K2: harness API can't carry jcode's tool surface (loses tools or streaming).
- K3: needs patching omnigent internals (violates §6 level 1) for anything
  in our C4 contract.
- K4: RAM pressure forces a box upgrade just to idle.

Pass → migration is: t3code server keeps L3+L4, delegates C4 to omnigent's
OpenAPI. Face unchanged. Estimated 1–2 weeks, reversible until we delete our
session code (so: don't delete it for a month).

## 9. Security model

- **Transport:** Tailscale only. Firewall: SSH + tailnet. No public web port.
- **Secrets:** Gmail tokens in `apps/server` connector store, Mac only. Env
  vars on the box hold nothing personal. Hetzner API token lives at
  `~/.config/hetzner/token` (600, Mac only) — owner decision 2026-08-30:
  keep and use it (infra automation: resize/snapshot/rebuild/burst boxes);
  Aayu accepted transcript exposure, G9 closed. Never copy it to the box
  or any repo.
- **Blast radius:** an employee compromise is bounded by its policy row (§5).
  The box can be rebuilt from scratch in <1h (proven 2026-08-29); it holds no
  irreplaceable state by design (§7).
- **Sandboxing:** risky work (Bench builds, untrusted code) goes to disposable
  sandboxes once L2 provides them; until then it runs on the box, never the Mac.
- **Auth on the box:** t3code server has no auth today — acceptable _only_
  because Tailscale is the perimeter. If any public exposure is ever wanted,
  auth comes first (omnigent's invite/OIDC is a point in its favor).

## 10. Failure modes & mitigations (ranked by expected damage)

| #   | Failure                                            | P    | Damage  | Mitigation                                                                   |
| --- | -------------------------------------------------- | ---- | ------- | ---------------------------------------------------------------------------- |
| F1  | Superapp becomes the next shiny thing; paper slips | high | highest | Freeze rule in SUPERAPP-PLAN.md. Timebox. NOW.md keeps Paper red and visible |
| F2  | Stale NOW.md silently trusted                      | med  | high    | staleness banner (gap G1)                                                    |
| F3  | omnigent API churn under us                        | med  | med     | pin releases; touch OpenAPI surface only; keep C4 thin so exit is cheap      |
| F4  | Session-process leak recurs (67-proc incident)     | low  | med     | reap-sessions.mjs + hourly launchd, already shipped; watch it                |
| F5  | Box dies / Hetzner account issue                   | low  | low     | rebuild <1h; nothing irreplaceable on it                                     |
| F6  | Gmail token silently expires again                 | low  | med     | proactive refresh at 80% + background keeper, shipped; add status to rail    |
| F7  | Employee sends something wrong                     | low  | high    | approval gates on all sends; per-employee policies before any autonomy       |

## 11. Known gaps (the "unaware" list, made aware)

- G1: NOW.md staleness banner (§4a).
- G2: Mac↔box sync (§7) — remote rail is empty of history.
- G3: Calendar connector — biggest missing L3 input; deadlines are the #1
  escalation trigger and currently hand-written into NOW.md.
- G4: Employee memory — employees summarize but don't remember their own work.
- G5: Proactive checks — employees wait for NOW.md; they should poll their own
  connectors (Outreach checks the inbox, Ops checks disk) on schedules.
- G6: Chat-to-configure — roster/roles are code; the grokbot ideal is "talk to
  it to hire/rename/re-scope it."
- G7: Mobile — none. Cheapest path is inheriting omnigent's if spike passes.
- G8: Notice-banner fix (TeamPanel silent no-op) is uncommitted.
- G9: CLOSED 2026-08-30 — owner decision: token kept for infra automation, stored at ~/.config/hetzner/token (Mac, 600).
- G10: Prime-agent "hard mode" RL loop — parked, claims unverified
  (SUPERAPP-PLAN.md §Future).
- G11: Workspace shuttle — remote work on LOCAL files (non-git). Ship only the
  named files to the box, work there, return a change-manifest (adds/edits/
  deletes) applied locally after ONE batched approval; deletes always gate.
  Router picks per task: git→box, local-file→shuttle, browser-session/Mac-app→
  runs on the Mac. Generalizes G2 beyond NOW.md. (Aayu, 2026-08-30.)
  (SUPERAPP-PLAN.md §Future).

## 12. Sequencing (respects the freeze rule)

```
Now      → G9 (revoke token) · G8 (commit fix) · this doc
Spike    → §8, half a day, on the box. Decides L2. Nothing else blocks on it.
Then     → G1, G2 (small, close real holes from this week)
Post-paper → G3 calendar · G5 proactive checks · policies (§5) ·
             L2 migration if spike passed · G4 memory · G6 chat-config · G7 mobile
```

The paper outranks everything below the "Post-paper" line. This document
exists so that when we return, zero architecture is re-litigated.
