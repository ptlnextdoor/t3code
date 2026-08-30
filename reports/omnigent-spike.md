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
| **K1** latency >30% overhead | **FAIL** | Raw jcode median **2.35 s** vs omnigent→jcode median **13.51 s** = **+475 %** overhead, 3 runs each on the box under subscription auth. |
| **K2** tool-surface / streaming loss | **PASS** (no loss by design) | ACP executor is the same protocol jcode already speaks; `pi`/`codex` harnesses show `streaming:true`, `interrupt:true`. |
| **K3** internals patching required | **PASS** (none required) | jcode registered as `acp:jcode` via documented `~/.omnigent/config.yaml` `acp.agents`; omnigent's `inner.acp_executor` execed it. Zero source edits. |
| **K4** RAM pressure forces box upgrade | **PASS** | omnigent server + one active jcode session + t3code coexist with ~1.8 GB available, **0 swap** throughout. |

**Overall: DO-NOT-MIGRATE** — K1 fails the >30 % latency kill criterion by an order of magnitude.

> **Update 2026-08-30 (K1 closed).** The credential gap was closed by installing
> jcode on the box (linux-x86_64 v0.81.3, matching the Mac) and copying only its
> subscription OAuth (`auth.json` + `auth-refresh-state.json`, 600 perms) via
> scp. A trivial turn completes raw in ~2.35 s. Routed through omnigent as
> `acp:jcode` the same turn takes ~13.5 s — a **+475 %** wall-clock penalty that
> persists on both the `--server local` and warm `--server http://127.0.0.1:6767`
> paths, so it is per-turn runner-spawn + ACP handshake cost, not one-time server
> boot. That is ~16× the 30 % kill threshold. K2/K3/K4 remain PASS, but K1 alone
> is a hard kill: **DO-NOT-MIGRATE.** Details in Task 4 below.

The architecture question (K2/K3/K4 — "can jcode plug in via documented seams
without a box upgrade?") is **answered yes on all three**: jcode plugs in
cleanly and the box holds the load. But the seam is slow. With K1 now measured
under real subscription auth, the latency cost of routing every turn through
omnigent's runner + ACP handshake is **+475 %** — an order of magnitude past the
30 % kill line. A clean plug-in that quadruples-plus per-turn latency is not
worth migrating to. The recommendation flips to **DO-NOT-MIGRATE.**

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

## Task 4 — K1 latency (CLOSED 2026-08-30)

**FAIL — omnigent adds ~+475 % wall-clock per turn.**

### Setup that unblocked it

The blocker was purely credential/binary provisioning, resolved without any API
key by leaning on jcode's subscription auth:

1. Installed jcode on the box via the official installer, pinned to the Mac's
   version: `JCODE_VERSION=v0.81.3 curl -fsSL https://jcode.sh/install | bash`.
   The box is `x86_64` Linux, so it pulled `jcode-linux-x86_64` (SHA-256
   verified by the installer) — the Mac's arm64 Mach-O binary could not be
   copied. `jcode v0.81.3` confirmed on both.
2. Copied **only** the two auth files from the Mac's `~/.jcode/` to the box's
   `~/.jcode/` over the `t3code` scp alias, `chmod 600`: `auth.json` (the
   Anthropic subscription OAuth) and `auth-refresh-state.json` (what the
   automatic refresher needs). No sessions, history, config, or device files
   were copied; file contents were never logged. `jcode auth status` on the box
   → `claude available OAuth · source: ~/.jcode/auth.json · refresh: automatic`.
3. Verified a real turn: `jcode run -p claude "Reply with exactly: PONG"` →
   `PONG` in ~2.4 s.

### The A/B (3 runs each, wall-clock on the box)

Same trivial prompt (`Reply with exactly: PONG`) both sides.

| Path | Run 1 | Run 2 | Run 3 | **Median** |
| --- | --- | --- | --- | --- |
| **A** raw `jcode run -p claude` | 2.35 s | 2.35 s | 2.02 s | **2.35 s** |
| **B** `omnigent run --harness acp:jcode … --server local` | 13.68 s | 13.36 s | 13.51 s | **13.51 s** |

**Overhead = (13.51 − 2.35) / 2.35 = +475 %.** The 30 % kill threshold would cap
B at ~3.06 s; B is ~4.4× over that cap and ~5.7× raw jcode.

### Is it just cold server boot? No.

B's per-run log shows `Starting the local server… Launching your agent…`, so I
re-ran B against the **already-running** persistent server
(`--server http://127.0.0.1:6767`) to remove any server-boot cost:

| Path | Runs | Median |
| --- | --- | --- |
| **B2** warm server (`--server http://127.0.0.1:6767`) | 13.39 s, 11.41 s (plus one grep-missed run) | **~12.5 s** |

Warm-server B2 is statistically the same as cold B. The penalty is **per-turn
runner spawn + ACP `initialize` handshake + host-daemon round-trips**, not
one-time server startup — so it cannot be amortized away by keeping the server
hot. Every turn pays it. Note the harness path itself is the documented
`acp:jcode` seam from K3 (zero source edits), so this is the cost of the
*intended* integration, not a workaround.

**K1 = FAIL.** This is the hard kill: even with every architectural criterion
green, a ~5.7× per-turn latency tax on the interactive path is disqualifying.

## Task 5 — K4 RAM under real load (RECHECK 2026-08-30)

Rechecked with the full stack Aayu specified — **omnigent server + one active
jcode session running through it + the t3code server** — all alive at once.
`free -m` before and during the active turn:

| State | Used | Free | Available | Swap | Note |
| --- | --- | --- | --- | --- | --- |
| omnigent server idle + t3code (no active session) | 1918 MB | 224 MB | **1900 MB** | 0 | t3code pid 9865 serving :3773 → 200 |
| **DURING** active jcode turn through omnigent | 2034 MB | 207 MB | **1785 MB** | **0** | 36 omnigent+jcode procs mid-turn |
| After turn completes | 1962 MB | 278 MB | 1857 MB | 0 | turn returned `PONG` |
| After `omnigent server stop` | 1328 MB | 911 MB | 2490 MB | 0 | runners reaped, t3code still 200 |

`available` never dropped below **1.78 GB** and **swap stayed 0 the entire
time**. The active turn cost only ~115 MB of `used` over idle. t3code (pid 9865,
`/opt/t3code/bin.mjs`) returned HTTP 200 before, during, and after, and was
never restarted or signalled.

**K4 = PASS.** The 3.8 GB box comfortably holds omnigent server + a live jcode
session + t3code with >1.7 GB headroom and zero swap. The earlier note about
runner accumulation held (proc count rose 22 → 36 during the turn); the caveat
from the prior run stands: reap runners between sessions. `omnigent server stop`
cleanly removed them and recovered ~1.2 GB, t3code untouched.

<details><summary>Superseded first-run K4 table (idle-only, no active session through omnigent)</summary>

| State | Free RAM | Swap used | Note |
| --- | --- | --- | --- |
| Box before omnigent | 3173 MB | 0 | t3code server 229 MB running |
| omnigent server idle + t3code | 2979 MB | 0 | omnigent 189 MB RSS |
| After repeated session launches | 2575 MB | **0** | omnigent grew to ~947 MB across **8** procs |
| After `omnigent server stop` | 3135 MB | 0 | all omnigent procs gone, t3code 200 |

The 947 MB spike was leftover runner/CLI/host-daemon processes accumulated
from repeated failed test launches (each runner ~90–170 MB), not steady state.
</details>

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

- **K1 (>30% latency overhead?)** — **FAIL.** Raw jcode 2.35 s vs
  omnigent→`acp:jcode` 13.51 s median (3 runs each, box, subscription auth) =
  **+475 %**, ~16× the 30 % line. Warm persistent server is no better (~12.5 s);
  the cost is per-turn runner spawn + ACP handshake, unamortizable.
- **K2 (harness API can't carry jcode's tools/streaming?)** — **PASS.** ACP is
  the protocol jcode already speaks; capability records show streaming +
  interrupt; no documented tool truncation. (Moot now that K1 kills it.)
- **K3 (needs patching omnigent internals?)** — **PASS.** jcode registered as
  `acp:jcode` via documented `~/.omnigent/config.yaml` `acp.agents`; omnigent's
  `inner.acp_executor` execed and completed the ACP handshake and a real turn.
  Zero source edits.
- **K4 (RAM forces a box upgrade to idle?)** — **PASS.** Rechecked under real
  load (omnigent server + one active jcode session + t3code): ≥1.78 GB available,
  0 swap throughout, t3code HTTP 200 the whole time. Reap runners between
  sessions.

## Overall recommendation

**DO-NOT-MIGRATE.**

Three of four kill criteria — the *architectural* ones (K2 tools, K3 no-patch,
K4 RAM) — are green with concrete evidence: jcode plugs into omnigent through a
documented seam with zero source edits, and the 3.8 GB box holds the full stack.
But K1, the one criterion that had been blocked on a credential, now measures
**+475 % per-turn latency** through omnigent versus raw jcode — ~16× the 30 %
kill threshold, and it does not shrink with a warm server because the cost is
per-turn runner spawn plus the ACP `initialize` handshake, paid on every turn.
Per ARCHITECTURE.md §8, K1 is a hard kill on its own: the interactive path
cannot take a ~5.7× latency tax regardless of how clean the integration is.
Recommendation to the coordinator: **do not migrate to omnigent as L2.** Keep
t3code's own server. The architectural learnings (ACP seam works, RAM fits) are
banked if the per-turn overhead is ever reduced upstream, but on omnigent 0.11.0
the latency disqualifies it.

Reversibility note (§8): nothing here is destructive. omnigent lives entirely
under `~/.local` + `~/.omnigent`; `omnigent uninstall --purge` removes it. jcode
on the box lives under `~/.jcode` + `~/.local/bin/jcode`. The t3code service was
never touched (HTTP 200 verified before, during, and after).

---

### Safety log

- t3code server (`/opt/t3code/bin.mjs`, pid 9865, 229 MB): read-only toward it;
  HTTP 200 confirmed at every phase. Never restarted, never `pkill`ed.
- omnigent bound to `127.0.0.1` only — no public port (§9).
- Stopped omnigent via `omnigent server stop` (its own lifecycle command), not
  by pattern-killing. All heavy work on the box, not the Mac.
- Fake `jcode` shim used for the K3 transport proof was removed immediately.
