# Omnigent substrate spike — N0.2 verdict (K1–K4)

Investigation, not a migration. Decides whether omnigent becomes L2 (with jcode
as a custom harness) or t3code keeps its own server. Run on the Hetzner box
(`ssh t3code`, Tailscale 100.75.151.44, Ubuntu 24.04, 3.8 GB RAM) on 2026-08-30
against **omnigent 0.11.0** (latest PyPI release, built 2026-08-25).

Companion to ARCHITECTURE.md §8 (kill criteria) and §3 (the C4 contract).

---

## TL;DR verdict

| Criterion | Result | One-line evidence |
| --- | --- | --- |
| **K1** latency >30% overhead | **UNTESTABLE** | No model credential exists on box or Mac; no session can complete a turn. |
| **K2** tool-surface / streaming loss | **PASS** (no loss by design) | ACP executor is the same protocol jcode already speaks; `pi`/`codex` harnesses show `streaming:true`, `interrupt:true`. |
| **K3** internals patching required | **PASS** (none required) | jcode registered as `acp:jcode` via documented `~/.omnigent/config.yaml` `acp.agents`; omnigent's `inner.acp_executor` execed it. Zero source edits. |
| **K4** RAM pressure forces box upgrade | **PASS** | Server idle baseline 189 MB RSS; omnigent + t3code (229 MB) coexist with ~2.9 GB free, **0 swap** throughout. |

**Overall: NEEDS-CREDENTIAL-TO-DECIDE** — leaning MIGRATE-VIABLE.

The architecture question (K2/K3/K4 — "can jcode plug in via documented seams
without a box upgrade?") is **answered yes on all three**. The only open gate is
K1, a pure latency measurement blocked solely by the absence of any LLM API key
on the box or Mac. K1 is not a design risk; it is a one-run measurement waiting
for a credential. Give the spike any working model credential (Anthropic key,
Databricks profile, or a jcode-native subscription path) and K1 resolves in
minutes.

---

## Task 1 — install + baseline

Box before install: `free -m` → 3173 MB available, **Swap: 0 0 0** (no swap
configured — an OOM would kill, not swap). `df -h /` → 34 GB free. Python 3.12.3
present. `uv` absent → installed `uv 0.12.7` via astral script.

```
$ uv tool install omnigent==0.11.0
Installed 2 executables: omni, omnigent
real 0m2.735s
$ omnigent --version
omnigent 0.11.0 (built 2026-08-25T17:27:41Z)
$ du -sh ~/.local/share/uv/tools/omnigent
414M    /root/.local/share/uv/tools/omnigent
```

**Install size: 414 MB on disk** (trivial against 34 GB free). Pinned to exact
release per ARCHITECTURE.md §6 pinning rule.

**Server idle baseline RAM:** `omnigent server --host 127.0.0.1 --port 6767`
(bound to localhost only — no public port, honoring §9 security model).

```
$ ps -o pid,rss -p <server_pid>
  PID   RSS
22029 189400          # 189 MB RSS idle
$ curl -s /health   → {"status":"ok"}
$ curl -s /api/version → {"version":"0.11.0"}
$ curl -s -o /dev/null -w '%{http_code}' /   → 200   # web UI on :6767 serves
```

Baseline server RSS **189 MB** — comparable to our t3code server (229 MB).

## Task 2 — one real session (credential probe)

**No model credential exists anywhere reachable.** Checked:

- Box env: no `ANTHROPIC_*`, `OPENAI_*`, `DATABRICKS_*` keys. `~/.omnigent`
  held only a `crashes/` dir (no config, no creds). No `~/.claude*`,
  `~/.codex*`, `~/.anthropic*`.
- Mac: `jcode` present (`v0.75.4-dev`), but `ANTHROPIC_API_KEY` unset,
  `OPENAI_API_KEY` unset. (jcode drives its own subscription auth, not an env
  key we can hand to omnigent's runner.)

What was verified **without** a credential (all green):

- Server boot, `/health`, `/api/version`, web UI (`:6767` → 200).
- YAML agent parsing: a minimal `hello.yaml` (`name`/`prompt`/`executor`)
  parsed and launched; the only error was the expected downstream
  `harness 'pi' is not configured on host — run omni setup` (a CLI/credential
  gate, **not** a parse failure).
- `omnigent run --help` / `server --help` / `config --help` surfaces read and
  documented below.
- Harness registry: `GET /v1/harnesses` →
  `['antigravity','claude-sdk','codex','copilot','cursor','devin','grok','hermes','pi']`.
  Each carries a capability record, e.g. `codex`:
  `integration_mode:cli-subprocess, streaming:true, interrupt:true, resume:warm-reattach`.

A session **row** was even created against the built-in jcode agent
(`POST /v1/sessions {"agent_id": ...}` → `{"id":"6af0...","status":"idle"}`),
proving the create-session path works; it just can't run a turn without a model.

## Task 3 — K3 probe (the crux): jcode as a custom harness via documented seams

**Finding: jcode registers with ZERO omnigent source edits, using two
documented extension points.**

### The documented path (cited)

`docs/AGENT_YAML_SPEC.md`, section **"Custom ACP agents"** (verbatim):

> `harness: acp:<slug>` runs any configured Agent Client Protocol server
> command. Register commands in `~/.omnigent/config.yaml` under `acp.agents`;
> the slug is derived from the agent name.
>
> ```yaml
> acp:
>   agents:
>     - name: OpenClaw
>       command: openclaw acp --url <gateway-url> --token-file <token-file>
>       omnigent_mcp: false
> ```

jcode has an `acp` mode (`jcode acp`), so it drops straight into this shape.

### What I actually did (no patching)

Wrote `~/.omnigent/config.yaml` (a user config file, not omnigent internals):

```yaml
acp:
  agents:
    - name: jcode
      command: jcode acp
      omnigent_mcp: false
```

Then `omnigent run --harness acp:jcode -p "hi" --server local`. omnigent
resolved the slug and **execed the command**. Because the real jcode binary is
Mac-only (not on the Linux box), the first run failed with `[Errno 2] No such
file or directory`. To prove the invocation reached the ACP transport layer, I
dropped a fake `jcode` shim on PATH and re-ran:

```
WARN inner.acp_executor  acp initialize failed for 'jcode acp':
  unable to perform operation on <WriteUnixTransport closed=True ...>;
  the handler is closed. If this agent authenticates from an environment
  variable, declare it in os_env.sandbox.env_passthrough ...
```

This is decisive: omnigent's **`inner.acp_executor`** opened a Unix-socket ACP
transport and attempted the ACP `initialize` handshake against `jcode acp`. It
failed only because the shim exited immediately (didn't speak ACP back). The
extension point carried the harness end-to-end; nothing in omnigent's package
was modified. (Fake shim removed afterward.)

### Why this satisfies C2/§9

ARCHITECTURE.md C2 says the substrate→executor seam must use "extension points
only — never patch substrate internals." `acp.agents` in the user config file
plus the `acp:<slug>` harness id are exactly that: a first-class, documented
registration surface. The `pi` harness in omnigent's built-in set is the
"native harness pattern" the spike brief referenced; `acp:<slug>` is the
generic version of the same mechanism, open to any ACP speaker — which jcode is.

### K2 corollary (tool surface / streaming)

The YAML spec's executor table documents per-harness capabilities; the live
`/v1/harnesses` capability records show `streaming:true` and `interrupt:true`
for the CLI-subprocess harnesses (`codex`), and ACP is a superset protocol that
carries tool calls, streaming, and cancellation natively — the same channels
jcode already implements for its own ACP mode. There is no documented tool
truncation in the ACP path. **K2 = PASS** (no surface loss by design); a live
turn would confirm streaming end-to-end, but that needs K1's credential.

## Task 4 — K1 latency

**UNTESTABLE this run.** K1 requires a completed trivial turn through omnigent
vs raw `jcode acp`, three runs each, medians compared. Both sides need a model
credential to produce a turn, and none exists on the box or Mac (Task 2).
Additionally, `jcode` is not installed on the Linux box, so "raw jcode acp on
the box" would itself require installing jcode there. **This is a measurement
gap, not an architectural failure.** Unblock: any working model credential →
run the A/B on the box.

## Task 5 — K4 RAM under load

Measured with both servers alive plus session activity:

| State | Free RAM | Swap used | Note |
| --- | --- | --- | --- |
| Box before omnigent | 3173 MB | 0 | t3code server 229 MB running |
| omnigent server idle + t3code | 2979 MB | 0 | omnigent 189 MB RSS |
| After repeated session launches | 2575 MB | **0** | omnigent grew to ~947 MB across **8** procs |
| After `omnigent server stop` | 3135 MB | 0 | all omnigent procs gone, t3code 200 |

The 947 MB spike was **leftover runner/CLI/host-daemon processes accumulated
from my repeated failed test launches** (each runner ~90–170 MB), not steady
state. Process breakdown at peak: 1× server (189 MB) + 1× host daemon (96 MB) +
1× CLI (170 MB) + 5× orphaned runner procs (~90–105 MB each). Steady-state for
one server + one live session is ~189 + ~100 (host daemon) + ~100 (one runner)
≈ **390 MB**, well within budget alongside t3code's 229 MB with >2 GB to spare.

**K4 = PASS.** Never swapped (swap is 0-sized, so any real pressure would OOM,
and none occurred). The box holds omnigent server + a session + t3code
comfortably. Caveat: runner processes must be reaped between sessions;
long-lived orphans would erode headroom on a 3.8 GB box. `omnigent server stop`
cleaned every process and left t3code untouched (HTTP 200 throughout).

## Task 6 — OpenAPI vs the C4 contract

C4 (ARCHITECTURE.md §3) = **"open a thread in project P, prefill text T, on host
H" + a session status stream.** omnigent's OpenAPI (`/openapi.json`, 100+
endpoints) covers every clause:

| C4 clause | omnigent endpoint(s) | Evidence |
| --- | --- | --- |
| open a thread | `POST /v1/sessions` | Live create → `{"id":"6af0...","status":"idle"}`; only `agent_id` required, `project_id` optional field. |
| in project P | `GET/POST /v1/projects`, `project_id` on session | `/v1/projects` CRUD present; `UpdateSessionRequest` carries `project_id`. |
| prefill text T | `-p/--prompt` on create; `POST /v1/sessions/{id}/comments` (+ `/comments/send`) | Prompt accepted at create; comments endpoint for prefilled-not-sent text (matches §4b "prefilled, never auto-sent"). |
| on host H | `GET /v1/hosts`, `POST /v1/hosts/{id}/runners`, `runner_id` on session | Host + runner registration surface; `UpdateSessionRequest.runner_id`. |
| status stream | `GET /v1/sessions/{id}/stream` | Present (SSE; `sse-starlette` in deps). |
| policies (§5 bonus) | `GET/POST /v1/policies`, `/v1/sessions/{id}/policies` (+ `/evaluate`) | Server/agent/session-stacked policy CRUD — maps 1:1 onto the employee×policy table. |

**C4 is fully covered, and the seam stays thin.** Migration shape (if K1
passes): t3code server keeps L3+L4, delegates C4 to these endpoints; Face
unchanged. The policy endpoints are a bonus — they let §5 employee policies be
*enforced* in L2 instead of degrading to a UI confirm.

---

## Kill-criteria verdict (ARCHITECTURE.md §8)

- **K1 (>30% latency overhead?)** — **UNTESTABLE.** No credential on box/Mac to
  complete a turn either side; jcode not installed on the box. Measurement gap,
  not a design failure. Resolves with any model credential.
- **K2 (harness API can't carry jcode's tools/streaming?)** — **PASS.** ACP is
  the protocol jcode already speaks; capability records show streaming +
  interrupt; no documented tool truncation. Live-turn confirmation pending K1.
- **K3 (needs patching omnigent internals?)** — **PASS.** jcode registered as
  `acp:jcode` via documented `~/.omnigent/config.yaml` `acp.agents`; omnigent's
  `inner.acp_executor` execed and began the ACP handshake. Zero source edits.
- **K4 (RAM forces a box upgrade to idle?)** — **PASS.** 189 MB idle,
  ~390 MB steady with a session, coexists with t3code, 0 swap. Reap runners
  between sessions.

## Overall recommendation

**NEEDS-CREDENTIAL-TO-DECIDE**, strongly leaning **MIGRATE-VIABLE.**

Three of four kill criteria — the *architectural* ones (K2 tools, K3 no-patch,
K4 RAM) — are cleared with concrete evidence. The one open criterion (K1) is a
latency stopwatch blocked only by a missing API key, not by any property of
omnigent's design. Recommendation to the coordinator: **do not decide MIGRATE /
DO-NOT-MIGRATE yet.** Provision one model credential to the box (Anthropic key,
Databricks `oss` profile, or install jcode+its subscription auth on the box),
then re-run Task 4's A/B in under 30 minutes to close K1. Everything else that
gates Phase 3 is green.

Reversibility note (§8): nothing here is destructive. omnigent lives entirely
under `~/.local` + `~/.omnigent`; `omnigent uninstall --purge` removes it. The
t3code service was never touched (HTTP 200 verified before, during, and after).

---

### Safety log

- t3code server (`/opt/t3code/bin.mjs`, pid 9865, 229 MB): read-only toward it;
  HTTP 200 confirmed at every phase. Never restarted, never `pkill`ed.
- omnigent bound to `127.0.0.1` only — no public port (§9).
- Stopped omnigent via `omnigent server stop` (its own lifecycle command), not
  by pattern-killing. All heavy work on the box, not the Mac.
- Fake `jcode` shim used for the K3 transport proof was removed immediately.
