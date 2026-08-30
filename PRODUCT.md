# PRODUCT.md — The shippable product ("any user, 30 minutes")

Companion to ARCHITECTURE.md (the _how_) and SUPERAPP-PLAN.md (the _why_ + freeze
rules). This file is the _what a stranger gets_. Last updated 2026-08-30.

Build waits behind IECBES (freeze rule). This is the durable target, not a
now-task.

---

## The promise

Any user deploys their own instance and gets their life together in 30 minutes.
Not "a dev sets it up." A person. One install, talk to it, done.

## The whole product in one line

Our **Face** (t3code shell + sand design) + our **Brain** (employees, escalation
parser, knowledge org) seeded by a **voice note** + our **built-in screen
capturer** (vendored Dayflow-type, tracked upstream) riding **omnigent's
substrate** (deploy, auth, remote, mobile — pending spike).

## The two ideas that make it shippable (2026-08-30)

Everything expensive about "any user" collapses onto these two:

### 1. Voice-note onboarding (solves cold-start)

A stranger has none of Aayu's history. On minute 1 the app knows nothing. So:
the user records **one rambling brain-dump** — "here's everything on my plate."
We transcribe → run it through the escalation parser we ALREADY built
(`todayPanel.logic.ts`) → fronts → roster → first NOW.md → employees.

- Minute 1 they talk. Minute 5 they have employees escalating real things.
- People voice-dump when they won't fill a form. This is why it works.
- Degrades gracefully: bad parse → user edits the list. Still 30 min, not months.
- Reuses our parser; we are NOT inventing life-inference from scratch.

### 2. Vendored screen capturer (solves "install Dayflow")

We ship a Dayflow-type capturer **inside** the app, vendored and tracked the
same way we track jcode/omnigent. The user installs ONE thing. No separate app,
no "Dayflow is Mac-only" leaking to the user.

- Same upstream discipline as ARCHITECTURE.md §6: track Dayflow's commits,
  keep our changes as a patch queue, ship integrated.
- Runs where the screen is (the user's machine); the brain can be remote.
  This is the L3-on-device / L4-remote split (ARCHITECTURE.md §7), now with
  our own binary instead of Dayflow's app.

## Tracked upstreams (the "stays up to date" discipline, now three)

| Upstream    | We ship it as                     | Update path                                     | Cost       |
| ----------- | --------------------------------- | ----------------------------------------------- | ---------- |
| jcode       | our executor (L1)                 | git pull — upstream is us                       | free       |
| omnigent    | substrate (L2, pending spike)     | `omni upgrade`, pinned release                  | free–cheap |
| **Dayflow** | **built-in screen capturer (L3)** | **track commits, patch-queue, ship integrated** | cheap      |

All three obey ARCHITECTURE.md §6: extension points first, patch queue second,
hard fork never (without a written reason). Their velocity becomes our free R&D.

## Scope to reach the promise (post-paper)

Voice-note + vendored-capturer kill the two rows I'd called the crux. Remaining:

| Must-build                                                                         | Why new                                                      | Size                            |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------- |
| Voice-note onboarding (record → transcribe → parse → roster → first NOW.md)        | Aayu never onboarded; he IS the seed                         | ~1 wk                           |
| Vendor the capturer (integrate Dayflow-type, track upstream, cross-platform story) | Dayflow is Mac/Swift; "any user" needs at least an honest v1 | 1–2 wks                         |
| One-command deploy (Docker / `curl \| sh` / click-deploy)                          | Aayu deployed by hand over SSH                               | free-ish IF omnigent, else 1 wk |
| De-Aayu-fication (remove every hardcoded path, front, name)                        | half-done via env vars; rest threaded through L4             | 1 wk                            |
| Auth + per-instance isolation (each instance = one private life)                   | box has none (Tailscale-only)                                | free IF omnigent, else 3–5 days |
| Mobile                                                                             | none today                                                   | free IF omnigent, else 1 wk     |
| Trust/docs ("why is it reading my email / screen")                                 | strangers must trust it with Gmail + screen                  | 3–5 days                        |

**Realistic total: 6–9 weeks focused**, most of it dissolving into omnigent if
the spike passes. Odds of a genuine "30-min, any user in the tribe" v1 in a
quarter: **~55%**.

## Narrow the "any user" (Elon: question the requirement)

v1 does NOT serve literally anyone. It serves **the tribe whose life looks like
Aayu's**: students, researchers, builders drowning in fronts, chats, and
deadlines. Named owner, real reason. "Anyone" is a year; "the tribe" is a
quarter. Widen later, from a working core.

## The canonical onboarding sequence (Aayu, verbatim, 2026-08-30)

"Setup my account. Connect my AI providers and subs. Have it fire up a remote
server. Load up my relevant files that it'd need access to on that server.
Connect my Gmail, Google Calendar, GitHub, etc all there. Add my SSH keys and
then have it set up to start working on my life."

Seven steps, each already mapped to built or planned machinery:

1. Account -> local-first identity, no cloud signup (Phase 3 auth node)
2. AI providers -> subscription OAuth flows (Claude Max, SuperGrok), stored
   like the Gmail connector: Connected/Reconnect, never tokens
3. Remote server -> Hetzner API (token wired 2026-08-30): create box, harden,
   Tailscale join, deploy server — automated, no console
4. Relevant files -> the G11 workspace shuttle: ship named files/dirs only
5. Connections -> one button each: Gmail (done), Calendar (N2.3), GitHub
6. SSH keys -> generated per-box like t3code_remote was, pushed via API
7. Start working -> voice-note seed (N2.1) + roster -> employees begin

This sequence IS the product's first-run wizard. Build order follows it.

## The 30-minute flow (what the stranger actually does)

```
0:00  install one thing (the app; capturer bundled)
0:02  "connect Gmail" — one button, login, no console          (L3, Gmail done)
0:05  record a voice note: everything on your plate             (the seed)
0:07  app transcribes + parses → shows a draft roster + fronts  (our parser)
0:10  you tweak names/roles by talking to it                    (G6 chat-config)
0:12  capturer starts watching your screen (opt-in, explained)  (vendored L3)
0:15  first NOW.md renders: "here's what needs you now"         (the payoff)
0:30  employees have escalated real items; you act on one       (C4 open-thread)
```

Every step maps to a layer we've already named. Nothing here is architecture
we haven't drawn — it's onboarding wrapped around the existing stack.

## Still genuinely hard (no pretending)

1. **Voice → clean fronts.** Transcription is easy; turning "uh and the Stanford
   thing and my mom keeps asking..." into tidy Paper/Outreach rows is the work.
   Mitigated by editable output, not solved.
2. **Cross-platform capture.** Dayflow is Mac/Swift. Honest v1 may be Mac-first
   with Win/Linux as a tracked gap, not a silent hole.
3. **Trust.** Reading a stranger's email AND screen is a big ask. Local-first
   (raw data never leaves their machine, ARCHITECTURE.md §7) is the answer, and
   it must be visible, not buried.

## Gates (unchanged)

- IECBES first. This whole file is post-paper.
- omnigent spike (ARCHITECTURE.md §8) decides how many scope rows are free.
- G9: revoke the pasted Hetzner token before any of this.
