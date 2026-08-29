# The employee layer: five people instead of 1,518 chats

## The problem, measured

Aayu runs ~55 fronts across 1,518 real jcode sessions (filtered from 12,081
files). The failure mode is not missing information, it is that the
information has no owner. Dayflow's own record of the last 60 days is blunt:

- **38 hrs building agent tooling vs 17.5 hrs on the #1 deliverable** (the
  IECBES paper).
- **16.2 distinct activities per day.** That is thrash, not multitasking.

A session list, however well named, does not fix this. It is still 1,518
things to hold in your head.

## The idea, taken from grokbot

grokbot's real invention is not its model router (t3code already registers
six drivers: jcode, grok, claude, codex, cursor, opencode). It is that **the
unit of work is a person, not a session.** You do not resume chat #847; you
ask an employee where things stand. Sessions still exist underneath as their
memory.

This PR builds that layer. Nothing here replaces the models or the jcode
harness; it sits above both.

```
Models (brains)  ->  jcode harness (hands)  ->  t3code shell (window)  ->  Employees (people)
```

## What shipped

**A five-person roster derived from data, not from an org chart.** Topic
labels across all 1,518 sessions were counted, then cross-referenced against
what actually appears in NOW.md:

| Employee | Owns                                    | Sessions |
| -------- | --------------------------------------- | -------- |
| Paper    | Zaidi manuscript, IECBES, arXiv         | 131      |
| Outreach | Stanford PIs, Coleman, Zare, NextSense  | 16       |
| Apps     | Boom, college, scholarships, SAT        | 68       |
| Bench    | Kahlus benchmark, plasma hardware, URTC | 291      |
| Ops      | machine, inbox, calendar, health admin  | 196      |

**Four areas were deliberately left unstaffed.** Roshni (177 sessions),
LinkedIn (84), printing (20), and reelmind (18) have real history but _zero_
live escalations. Hiring for them would have been pure overhead. They stay
searchable.

**Two surfaces in one rail, with no duplication:**

- **Team** — who is blocked and on what. One headline ask per person.
- **Queue** — the 16 items waiting on an approval or a decision.

## Decisions worth reviewing

**No new database.** Threads already live in sqlite; escalations already live
in NOW.md. An employee is a _mapping_, not a store. If this ever needs a
migration, it has failed its own test.

**`ownerOf()` returns null instead of using a catch-all.** An unrouted item is
a visible signal that the roster is wrong. A default bucket would have hidden
exactly the thing worth knowing.

**Keywords must be proper nouns, never generic verbs.** A failing test caught
`"submission"` on Paper stealing the URTC poster from Bench, because every
area submits things.

**Deleted rather than built:** avatars/monograms (no information, and they
forced a 3-column grid that misaligned multi-line asks), per-card borders
(contradicted the pill on the same row), and the TODAY panel's critical-path
section (Team already showed those four items, grouped better).

## Bugs that only real data exposed

The fixture data was too clean. Screenshotting against the live NOW.md caught
three defects that unit tests passed straight through:

1. **State did not discriminate.** Any employee holding a draft was marked
   "needs-you", which lit all five rows red. If everyone is urgent, no one is.
   `needs-you` is now reserved for the critical path: **3 red / 2 amber**.
2. **"idle" rendered beside a coloured state bar** — a direct
   self-contradiction on the same row.
3. **Countdown pills parsed dates out of draft prose** ("sitting since
   Aug 19") and rendered them as `overdue`. Countdowns are now derived only
   for genuinely blocking work.

## Verification

- **1,437 unit tests pass**, no regressions. 13 new tests cover routing,
  summarization, and the state model.
- **`pnpm typecheck`: 0 errors.** Web and server both build.
- **Live E2E** (`scripts/team-e2e.mjs`) against a running server:
  **26/26 escalations routed, 0 unrouted, 3 blocking / 2 dated.** Exits
  non-zero, so it can gate a release.
- **Design validated by screenshot at every step**, not by reading CSS.
  References committed under `design-refs/`.

## Deliberately not in this PR

Chat-to-configure-role, avatar upload, and remote execution. Per the
five-step rule, you do not automate something before proving it should exist.
The employee entity has to earn its keep first.

The row actions (Send / Reply / Decide) are styled but **not wired**. Making
them actually send is the next PR, and it is the half that turns this from a
better dashboard into a chief of staff.
