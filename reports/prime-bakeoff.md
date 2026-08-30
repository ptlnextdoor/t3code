# Prime Agent bake-off — N0.4 crux-harness evaluation

**Node:** N0.4 · **Branch:** `swarm/n04-prime-bakeoff` · **Date:** 2026-08-30
**Question:** Is Prime Agent (github.com/PrimeIntellect-ai/prime-agent) worth adopting
as the harness for exploratory crux nodes in our swarm?
**Verdict:** **RETEST-LATER** (steal `--autonomous-gate` now; do not route crux nodes to it yet).

---

## 1. Install (task 1)

- Installer: `curl -fsSL https://app.primeintellect.ai/prime-agent/install.sh | sh`.
  Downloaded to `~/tmp/prime-bakeoff/install.sh` (1620 lines) and **read before running**.
- Mechanism: downloads a signed tarball (`prime-agent-0.8.1.tgz` from an R2 bucket),
  verifies it against a published `SHA256SUMS` (`prime-agent-0.8.1.tgz: OK`), then
  `npm install -g`. Version installed: **0.8.1**.
- **Install size: 269 MB** at `/opt/homebrew/lib/node_modules/prime-agent`
  (bundled `dist/`, `node_modules`, a Python `kernel-venv`, docs, skills).
  Symlink `prime-agent -> ../lib/node_modules/prime-agent/dist/bundle/cli.js` in
  `/opt/homebrew/bin`. Wall-clock install ~22s (node v26 already present).
- **Shell rc files: NOT modified.** Verified by diffing `~/.zshrc` (and bashrc/profile)
  against pre-install backups in `/tmp/*.pre-prime` — **`ZSHRC UNCHANGED`**, and
  `grep -c -i prime ~/.zshrc` returns **0**. Because node was already on PATH the
  installer never reached its standalone-node branch. The rc-append is also **gated
  behind a `[Y/n]` prompt** (`prompt_add_standalone_node_path`) that requires a tty;
  under a pipe it falls through to printing manual instructions, so a piped install
  cannot silently edit an rc file. Clean citizen.
- Preflight prompts (`confirm_install`, kernel setup) auto-continue only when **no tty
  is detected** ("No terminal detected; continuing without confirmation"), which is
  the documented non-interactive path, not a bypass of a visible prompt.

## 2. Credentials (task 2)

- Prime resolves auth from (a) `~/.prime/agent/auth.json`, (b) env vars
  (`ANTHROPIC_API_KEY`), or (c) subscription OAuth via `/login`.
- **This machine already had `~/.prime/agent/auth.json` (dated 2026-08-07) with an
  `anthropic` entry of `"type": "oauth"`** — a Claude Pro/Max subscription token
  (`refresh`/`access`/`expires` fields). Prime auto-refreshes it. **No new account or
  key was created; nothing was set up.**
- Note on isolation: this is Prime's **own** OAuth store, not jcode's. jcode keeps its
  Anthropic creds in `~/.jcode/auth.json` under `anthropic_accounts[].{access,refresh}`
  — a **different file and shape**; Prime does not read jcode's store. So "can it reuse
  the machine's Claude auth" = yes in the sense that a Prime login already existed here,
  **not** because it inherits jcode's tokens.
- Per Prime docs: third-party-harness use of a Claude subscription "draws from extra
  usage and is billed per token, not against Claude plan limits" — a cost flag for the
  coordinator if crux nodes ever fan out on it.
- Config paths documented: `~/.prime/agent/{auth.json,settings.json,sessions/,skills/,AGENTS.md}`.

## 3. Prime's output (task 3)

- Bounded exploratory task: parse a self-authored 300-word messy brain-dump
  (`transcript.txt`) into `fronts.json` = array of `{front, items[], urgency}`.
  Prompt in `PROMPT.txt`. Model: **claude-opus-4-8** (matches my harness for fairness).
  Command: `prime-agent -p --model claude-opus-4-8 --cwd ~/tmp/prime-bakeoff "$(cat PROMPT.txt)"`.
- **Wall-clock: 25.3s. Turns: 1** (single `-p` print run; it read the transcript, wrote
  the file, printed a summary). RC 0.
- Output: **valid JSON, exact keys, 4 fronts, 17 items, no hallucinated items.**

## 4. My baseline vs Prime (task 4)

I (opus-4-8 in the swarm harness) produced `fronts.mine.json` from the identical
transcript+prompt: valid JSON, exact keys, **5 fronts, 18 items**.

| Axis                    | Prime (fronts.json)                            | Mine (fronts.mine.json)                                                     |
| ----------------------- | ---------------------------------------------- | --------------------------------------------------------------------------- |
| Valid JSON / exact keys | yes / yes                                      | yes / yes                                                                   |
| Fronts                  | 4 (Work, Family, Personal, Finance)            | 5 (split Health out of Personal)                                            |
| Items captured          | 17                                             | 18                                                                          |
| Hallucinated items      | **0**                                          | 0                                                                           |
| Items dropped           | budgeting side-project (deliberate, explained) | none dropped (kept side-project as an explicit "accept it's not happening") |
| Urgency calls           | Work/Family high; Personal/Finance **medium**  | Work/Family/Finance high; Personal medium; Health low                       |

**Structure quality:** near-identical. Both grouped the same five life areas; the only
structural difference is I split **Health** (dentist, gym) into its own front while Prime
folded them under Personal. Mine is marginally finer-grained; neither is wrong.

**Items lost from transcript:** Prime dropped the budgeting side-project entirely,
reasoning it was explicitly abandoned ("I should just accept that"). Defensible, but the
prompt said _capture every concrete item_ — I kept it as an item phrased as the decision.
Net: Prime lost 1 item the spec arguably wanted; I lost 0. Both kept all hard commitments
(deck, Anika offer, Mom's appt, Leo's project, reimbursement, passport, DNS cutover, RFC).

**Hallucinations:** none in either. Clean.

**Urgency accuracy:** the transcript's true high-pressure fronts are Work (deck Thursday,
Anika "before she takes the other thing", Leo Monday) and Family. Both marked those high.
The judgment gap is **Finance**: it has a hard closing window ("before the 30-day window
closes", $800). I rated Finance **high**; Prime rated it **medium**, reasoning "no hard
date was given." I think high is the better call — a closing reimbursement window is
exactly the kind of silent-deadline the product exists to catch. Minor, but it's the one
place Prime's urgency read is softer than ideal for our use case.

## 5. `--autonomous-gate` (task 5)

Confirmed from `--help` and `docs/usage.md` / `docs/long-running-agents.md`:

- `--autonomous-gate <command>` (repeatable): a shell command that **must exit 0 before
  the run can finish**. Multiple gates run in CLI order; all must pass.
- After each assistant response, gates run **before** the ordinary continuation limits.
  A **failed gate feeds its bounded output back into the next continuation** so the agent
  can repair, then re-runs. Prime **avoids re-running an unchanged failed gate** (advances
  an attempt counter instead) — so a gate that keeps failing on an unchanged workspace
  can't spin forever.
- Bounds: `--autonomous-gate-retries` (default 3), `--autonomous-gate-timeout-ms`
  (default 300000; a timed-out gate is failed and its process tree killed), plus global
  `--autonomous-max-{continuations,turns,tokens,timeout-ms}`. A **passing gate lets the
  run finish even if other limits were hit**; hitting a limit never implies success.
- Documented example: `--autonomous-gate "npm run check"`.

**This is precisely the pattern SWARM-PLAN §2 wants** (`gate = scripts/verify.mjs`): a
verifier command as a hard completion condition, failure output looped back for repair,
bounded retries/timeout, and "reaching a limit ≠ success." **We should steal this shape**
for our own autonomous nodes regardless of whether we adopt Prime — it's a cleaner,
already-battle-tested encoding of our "gates are the test stand" rule than anything we've
written.

## Safety compliance

Throwaway dir `~/tmp/prime-bakeoff` only. Prime was never pointed at the t3code repo or
any real project (`--cwd` fixed to the throwaway). No email/calendar/MCP access granted.
Installer read before execution; rc files backed up and verified unchanged. Treated as
untrusted per their own reward-hacking disclosure. On this bounded, no-reward-surface
parsing task it did **not** cut corners (it even explained the one item it dropped).

## Verdict — RETEST-LATER

**Why not ADOPT-FOR-CRUX yet:**

1. One data point. This is a single easy structured-parse; it says Prime is _competent_
   and _honest here_, not that it beats our harness on the hard exploratory nodes (N2.1
   voice-onboarding) where their own paper shows marginal coding gains and one bad
   EmulatorBench Opus result (0.047) plus a documented Factorio reward-hack.
2. Cost surface: subscription use bills per-token as "extra usage," and a 269 MB global
   install with a bundled Python kernel is a heavier dependency than our current path.
3. Output parity ≠ advantage. On this task Prime and my harness are a **tie** (both valid,
   both zero-hallucination); Prime was slightly coarser (dropped 1 item, softer on the
   Finance deadline). No reason to switch the crux brain to it on a tie.

**Why not REJECT:** it installed cleanly, respected the machine (no rc edits), reused an
existing OAuth login with zero setup, produced spec-perfect JSON in 25s/1 turn, and its
`--autonomous-gate` design is a direct, superior encoding of our own gate philosophy.

**Actions:**

- **Adopt the `--autonomous-gate` pattern** into our autonomous-node runner now
  (`gate = node scripts/verify.mjs`, feed failed-gate output back, bound retries/timeout,
  never treat a hit limit as success). Harness-agnostic win.
- **Re-test Prime specifically on N2.1's fixture** (three real rambling transcripts with
  asserted parse counts) before any crux-routing decision, and measure it _with_ a gate
  so the reward-hack surface is exercised, not just a benign parse.

---

_Evidence: `~/tmp/prime-bakeoff/{install.sh, transcript.txt, PROMPT.txt, fronts.json,_
_fronts.mine.json, prime-run.log}`. Verified by reading real command output, not "should work."_
