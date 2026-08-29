# Remote execution

Run the agent server on another machine so this laptop stops being the worker.

## Why

Measured on the Mac before building this: **15.2 GB RSS of 24 GB, 5.6 GB
swapped, 67 stray `jcode` processes** (56 older than three days, 30+ of them
duplicate resumes of the same session).

Note the order of operations. The leak was fixed _first_
(`scripts/reap-sessions.mjs`, hourly launchd agent, 67 processes -> 4).
Renting a box to host a leak would have relocated the problem and added a
monthly bill. Only then is moving execution off the laptop worth paying for.

## What runs where

|                              | Laptop          | Remote box    |
| ---------------------------- | --------------- | ------------- |
| Desktop UI, rail, Team/Queue | yes             | no            |
| Agent sessions, bash, builds | no              | yes           |
| Dayflow screen data          | yes (Mac-only)  | not available |
| NOW.md, Gmail credential     | source of truth | synced copy   |

Dayflow is macOS-only, so the remote server has no screen context. The TODAY
panel degrades to NOW.md alone rather than failing. That is deliberate:
`dayflowAvailable: false` is a supported state.

## Host sizing (Hetzner)

Agent work is memory- and IO-hungry, not GPU work. Hetzner Cloud is a good fit:

- **CPX31** (4 vCPU, 8 GB) — fine for one busy box, ~€14/mo.
- **CPX41** (8 vCPU, 16 GB) — headroom for parallel agents, ~€27/mo.
- **CAX31** (8 vCPU ARM, 16 GB) — cheapest per GB, and ARM matches the Mac's
  architecture, so native modules behave the same way.

Start at CPX31. Two boxes for different task classes (one for builds, one for
long-running research) is the natural scale-out, and each is an independent
server the app pairs with.

## Deploy

```bash
scripts/deploy-remote.sh root@your-box        # build, ship, install service
scripts/deploy-remote.sh root@your-box --sync # refresh NOW.md + credentials
```

The script builds `apps/server/dist/bin.mjs`, ships it to `/opt/t3code`,
pushes NOW.md and Google credentials to `/var/lib/t3code` (mode 600), installs
a systemd unit, and prints the pairing token.

## Security

**Do not open the port to the internet.** The server's only credential is a
pairing token, and it runs shell commands by design. Exposing it publicly is
handing out a root shell.

Reach it either way:

```bash
# SSH tunnel, works immediately
ssh -N -L 3773:127.0.0.1:3773 root@your-box

# or Tailscale (preferred: survives reboots and IP changes)
tailscale up   # on both machines, then use the tailnet IP
```

The server also supports `--tailscale-serve` for HTTPS on the tailnet.

## Path overrides

The server reads host-specific inputs through env vars so it can run anywhere:

| Variable                    | Default                            | Purpose                   |
| --------------------------- | ---------------------------------- | ------------------------- |
| `T3CODE_HOME`               | `~/.t3`                            | runtime state, sqlite     |
| `T3CODE_NOW_MD`             | `~/.jcode/knowledge-org/NOW.md`    | command-centre input      |
| `T3CODE_DAYFLOW_DB`         | Mac Dayflow path                   | screen context (Mac only) |
| `T3CODE_GOOGLE_CREDENTIALS` | `~/.jcode/google_credentials.json` | Gmail OAuth client        |
| `T3CODE_GOOGLE_TOKEN`       | `~/.jcode/google_oauth.json`       | Gmail refresh token       |

Before these existed the paths were hardcoded to `homedir()`, so a remote
server silently served an empty command centre and a disconnected Gmail.

## Verified

Locally, simulating a remote box:

- binds `0.0.0.0`, reachable over the LAN interface (not just loopback)
- prints a pairing URL with the routable IP
- `T3CODE_NOW_MD` override loads a NOW.md from an arbitrary path
- a missing Dayflow DB yields `dayflowAvailable: false` instead of an error
