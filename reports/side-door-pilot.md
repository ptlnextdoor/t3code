# Side-door pilot — omnigent as a background heavy-lifting appliance (N1.4)

The N0.2 spike killed omnigent on the **hot path** (K1: +475% per-turn latency).
This pilot tests the _other_ use: omnigent as a fire-and-forget **background
appliance** on the Hetzner box, where a 5.7× latency tax is irrelevant because
nobody is waiting on a keystroke. One overnight-style research job, dispatched
through omnigent's `acp:jcode` harness, producing real value for node N2.2
(`capturer-vendor`).

Run 2026-08-30 on `ssh t3code` (Hetzner, Ubuntu 24.04, 3.8 GB RAM, swap 0),
omnigent 0.11.0, jcode v0.81.3, under jcode's Claude subscription OAuth (parrot's
setup from N0.2). t3code service must stay healthy; the job gets **no** access to
personal data — pure public-web research.

---

## TL;DR verdict: **APPLIANCE-VIABLE**

A real, multi-tool web-research job completed in **2m 35s wall-clock**, cost
**~115 MB** of RAM over idle (peak `used` 1311 MB, `available` never below
**2507 MB**, **swap 0** throughout), and **t3code stayed `active` before, during,
and after** — never signalled, never restarted. Output is a 98-line,
source-grounded markdown brief that reads its target repo down to individual
Swift files. The latency that disqualified the hot path is a non-issue here: for
background jobs you dispatch and walk away. Recommend adopting this as the
"side door" for overnight heavy lifting, with the one operational caveat below
(reap runners after each job).

---

## What ran (exact mechanics — copy/paste to automate)

Everything lives under `/opt/t3code/side-door/` on the box. An employee can
reproduce this by uploading and running one driver script.

### 1. One-time preconditions (already true on the box)

```bash
# omnigent + jcode on PATH, jcode auth healthy (parrot's N0.2 setup)
ssh t3code 'export PATH=/root/.local/bin:$PATH
  omnigent --version          # omnigent 0.11.0
  jcode --version             # jcode v0.81.3
  jcode auth status | head -1 # claude available OAuth ... refresh: automatic'

# ~/.omnigent/config.yaml registers jcode as the acp:jcode harness:
#   acp:
#     agents:
#     - command: jcode acp
#       name: jcode
#       omnigent_mcp: false
```

> Non-interactive SSH does **not** load `/root/.local/bin` into PATH. Every
> command that calls `omnigent`/`jcode` must `export PATH=/root/.local/bin:$PATH`
> first, or use absolute paths. This bit us on the first probe.

### 2. The trivial confirmation (Task 1 — do this before any real job)

```bash
ssh t3code 'export PATH=/root/.local/bin:$PATH
  omnigent run --harness acp:jcode -p "Reply with exactly: PONG" --server local'
# -> prints startup lines then: PONG   (~16 s; raw jcode alone ~3.4 s)
```

If that returns `PONG`, the seam is live: omnigent's `inner.acp_executor` spawned
`jcode acp`, completed the ACP handshake, ran a real model turn, and streamed the
answer back.

### 3. The real job (Task 2) — driver script

The job is dispatched by `/root/side-door-driver.sh` (committed context below).
It: writes the research prompt to a file, launches omnigent **detached** with
`nohup ... &` capturing the child **PID**, then samples `free -m` every 5 s into
`ram-samples.log` while enforcing a **400 MB `available` kill floor** (kills the
captured PID only — never by pattern), and records start/end/peak/health into
`run-meta.log`. Launch and forget:

```bash
scp side-door-driver.sh t3code:/root/side-door-driver.sh
ssh t3code 'chmod +x /root/side-door-driver.sh
  nohup /root/side-door-driver.sh > /opt/t3code/side-door/driver.log 2>&1 & echo pid=$!'
```

Core of the dispatch (the one line that matters):

```bash
nohup omnigent run --harness acp:jcode -p "$(cat "$PROMPT_FILE")" --server local \
  > "$RAW" 2>&1 &
OMNI_PID=$!          # captured — the ONLY pid we ever signal
```

The full research prompt is pinned in `/opt/t3code/side-door/prompt.txt`. It is
explicitly public-web-only ("Do NOT access any personal/local data") and asks for
a ≤200-line brief with five fixed H2 sections.

### 4. Harvest the output (Task 3)

omnigent prints the agent's final message to stdout, wrapped in a
` ```markdown ` fence. Strip the fence to get the clean brief:

```bash
ssh t3code 'awk "/^\`\`\`markdown/{f=1;next} /^\`\`\`[[:space:]]*\$/{if(f)f=0} f{print}" \
  /opt/t3code/side-door/omnigent-raw.log > /opt/t3code/side-door/screen-capture-brief.md'
scp t3code:/opt/t3code/side-door/screen-capture-brief.md reports/screen-capture-brief.md
```

### 5. Reap (mandatory — the one operational caveat)

omnigent leaves runner/host-daemon processes alive after a job (proc count for
`omnigent|jcode` was 11 at job end). On a 3.8 GB box these erode headroom if they
accumulate across jobs. Reap between jobs:

```bash
ssh t3code 'export PATH=/root/.local/bin:$PATH; omnigent server stop'
# -> "Stopped the background server." ; recovered ~185 MB, t3code untouched
```

---

## Measurements (Task 4)

Recorded by the driver (`run-meta.log`) and the 5 s RAM sampler
(`ram-samples.log`), plus before/after `systemctl is-active t3code`.

| Metric                  | Value                                                                                                                                                                                                                                                          | Source                                                                        |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **Wall-clock**          | **155 s (2m 35s)**                                                                                                                                                                                                                                             | `end_epoch - start_epoch` = 1788116896 − 1788116741                           |
| Job exit code           | **0** (clean)                                                                                                                                                                                                                                                  | `exit_code=0`                                                                 |
| **Peak RAM `used`**     | **1311 MB**                                                                                                                                                                                                                                                    | `peak_used_mb`, sampled every 5 s                                             |
| **Min RAM `available`** | **2507 MB**                                                                                                                                                                                                                                                    | `min_avail_mb` — never near the 400 MB floor                                  |
| Cost over idle          | **~115 MB** used (avail 2792→2507→back to 2705)                                                                                                                                                                                                                | before/min/after                                                              |
| **Swap used**           | **0** throughout                                                                                                                                                                                                                                               | box has 0-sized swap; any real pressure would OOM, none did                   |
| **t3code health**       | `active` before / during / after                                                                                                                                                                                                                               | `t3code_before=active`, sampler `t3=active` every tick, `t3code_after=active` |
| Kill-floor triggered    | **No**                                                                                                                                                                                                                                                         | no `KILL_FLOOR_HIT` line in meta                                              |
| Token/cost note         | **omnigent did not surface usage in acp mode.** Raw `jcode run` prints `[Tokens] upload/download/cache_read`; the omnigent `acp:jcode` path did not echo a token line. Meter via jcode/usage-meter (N2.6), not omnigent, if per-job cost accounting is needed. |

RAM was flat and boring the entire run — `used` hovered ~1160–1311 MB, `available`
~2507–2705 MB. This is the K4 result from the spike (≥1.78 GB headroom under an
_interactive_ session) confirmed again for a _background_ job, with even more
slack because the box was otherwise quiet.

---

## The output is real, not a toy (Task 2 value check)

`reports/screen-capture-brief.md` (98 lines, all five required H2 sections):
`## Viable approaches` / `## Battery + privacy tradeoffs` /
`## What to vendor vs build` / `## Risks` / `## Sources`. Spot-checks that prove
the agent actually did the research rather than hallucinating:

- Names the correct current macOS API split: `SCStream` vs
  `SCScreenshotManager.captureImage` (macOS 14+), flags `CGWindowList`/
  `CGDisplayStream` as **deprecated in macOS 14**.
- Reads Dayflow to the file level: cites
  `Core/Recording/ScreenRecorder.swift`, `StorageManager+Maintenance.swift`,
  `Dayflow.entitlements` (`app-sandbox = false`), the 10 GB default purge caps,
  and its **direct-DMG-not-MAS** distribution. That is the exact input N2.2 needs.
- Windows section correctly ranks WGC vs Desktop Duplication (DXGI) vs GDI
  `BitBlt`, and flags `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` as a
  capture-exclusion signal to honor.
- 20+ primary sources (Apple + Microsoft docs, screenpipe, Dayflow repo).

This directly feeds N2.2 `capturer-vendor`: it is a build-vs-vendor brief with a
named reference implementation (`mediar-ai/screenpipe` for the SCK+WGC
abstraction, Dayflow for macOS capture _policy_).

---

## Why this is the right shape (and where it must NOT go)

- **Background only.** The +475% latency (N0.2 K1) is fatal for the interactive
  C4 path and this pilot changes nothing there — t3code keeps its own server.
  The side door is strictly for jobs where wall-clock doesn't touch a human:
  overnight research, batch summarization, upstream-diff digests (N3.4).
- **Fire-and-forget, PID-tracked.** Dispatch detached, capture the PID, sample
  health, enforce a RAM floor, kill only the captured PID. Never `pkill -f`.
- **No personal data.** This job was public-web research by construction. Any
  side-door job that would touch `~/.t3/userdata` or local files is out of scope
  for this appliance and belongs on a different, gated path (N2.7 shuttle).
- **Reap after every job.** The only real operational cost. Wrap dispatch +
  `omnigent server stop` in one script so orphans can't accumulate.

## Gotchas (grows with observed failures)

1. Non-interactive SSH has no `/root/.local/bin` in PATH — export it or the
   commands are "command not found" and silently look like a broken install.
2. omnigent's `acp:jcode` path does **not** echo token usage; don't expect
   per-job cost from omnigent. Use the jcode token line (raw runs) or N2.6.
3. omnigent prints startup chatter (`Starting the local server…` etc.) and wraps
   the final answer in a ` ```markdown ` fence — parse it out, don't ship raw.
4. Runner processes outlive the job. Always `omnigent server stop` to reclaim RAM.
5. `--server local` re-spawns a server per invocation (part of the latency tax);
   fine for background, and keeps each job isolated.

---

## Verdict

**APPLIANCE-VIABLE.** omnigent is a poor hot-path substrate (N0.2 stands) but a
perfectly good background appliance: one real research job ran clean in 2.5 min,
cost ~115 MB, never threatened the 400 MB floor or swapped, and left t3code
untouched. Adopt as the "side door" for non-interactive heavy lifting, wrapped in
a dispatch-and-reap script, public-data jobs only. The RAM is worth it because
the RAM is barely touched.
