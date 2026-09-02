# N3.11 — Melani settings overlay + per-machine provider connect

Fixes the owner's two complaints: (a) "no clear settings menu to edit the
configuration"; (b) "I can't connect the subscriptions — supergrok has a CLI
`grok-build` that you connect the same way every app has you connect claude cli /
codex cli."

## What shipped

A gear in the Melani sidebar footer (and **Cmd+,**) opens a sand-styled overlay
dialog that floats over the shell — the people-list stays mounted behind it (not
a route change), per the Grok-reference overlay pattern. Left-column sections:

- **Providers** (the core ask): per MACHINE (This Mac + each remote environment),
  one card per provider CLI (Codex, Claude, Cursor, Grok, OpenCode) with LIVE
  status from the server's existing per-environment provider probes:
  connected (+ auth/plan label), not connected, not installed, or disabled. A
  not-connected card shows the **exact one-liner to run on that machine** to
  connect the subscription, with a Copy button, plus a **Refresh** that re-probes
  so status flips live once you've signed in. Tokens are never shown.
- **Machines**: embeds the existing, proven `ConnectionsSettings` — the working
  "Add environment" flow is reused verbatim, not rebuilt.
- **Team**: every employee as a row, name/role editable in place and removable,
  wired to new roster PATCH/DELETE endpoints. Edits fire the shared roster
  refresh so the sidebar updates instantly.
- **About**: brand + version.

## How I verified

- **Unit tests (29, all green via `vp test run`):**
  - `apps/web/.../melani/settingsOverlay.test.ts` — overlay reducer state machine
    (open/select/close/reopen, section coercion) + provider-card derivation across
    every probe shape (ready / needs-login / not-installed / disabled / checking /
    unknown-auth) + the login-command map (Grok = device-auth).
  - `apps/web/.../melani/MelaniProvidersSection.test.ts` — provider-card render
    states (ready/needs-login/not-installed) with mocked probe data, incl. a
    no-token-leak assertion.
  - `apps/server/.../roster/RosterRoute.test.ts` — new PATCH/DELETE guards +
    apply/remove against a temp file (never the real roster.json).
- **Typecheck:** `tsgo --noEmit` clean on both `apps/web` and `apps/server`.
- **E2E (`scripts/melani-shell-e2e.mjs`, extended, PASS):** drives a real headless
  Chrome against the running dev server — pairs, opens settings via the gear,
  asserts the overlay opens with the shell still mounted behind it, Providers
  renders 5 provider cards, Machines shows the "Add environment" flow, and close
  returns to the shell. Screenshots: `reports/n311-settings-shots/settings-providers.png`
  and `settings-machines.png` (also in `.melani-shots/`).

## Spec conformance

- Overlay floats over the shell (shell stays mounted) — ✓ asserted in e2e.
- Left-column sections Providers/Machines/Team/About — ✓.
- Machines reuses the working ConnectionsSettings — ✓ (not rebuilt).
- Team wired to a roster endpoint with edit/remove — ✓ (added DELETE + PATCH).
- Motion per UI-SPEC §4: backdrop + panel enter 180ms `cubic-bezier(.16,1,.3,1)`,
  120ms hovers, all disabled under `prefers-reduced-motion` — ✓.
- Live status, refetch after login — ✓ (Refresh re-probes; e2e shows Codex
  "Connected · ChatGPT Free Subscription", Claude "Connected").
- Never show tokens — ✓ (card reads only the probe's auth label).

## Flags — exactly what the owner clicks to connect Claude + Grok on each machine

The server exposes provider **status + refresh** but **no RPC to run a login
flow**, so there is no server-driven `[Connect]` device-auth button. The shipped
connect path is:

1. Open Settings (gear or Cmd+,) → **Providers**.
2. Find the provider card for the machine (This Mac or a remote env).
3. If it says "Not connected", it shows the command. Click **Copy**:
   - **Claude:** `claude login`
   - **Grok:** `grok login --device-auth` (device-auth is the headless-friendly
     flow that works on a remote box)
   - **Codex:** `codex login`
   - Cursor: `agent login`; OpenCode: `opencode auth login`
4. Run that command in a terminal **on that machine** (locally, or over SSH on a
   remote env), complete the sign-in.
5. Click **Refresh** on the machine's block — the card flips to "Connected" with
   the plan/account label.

**Gap (documented, not blocking):** a true in-app `[Connect]` that starts a
device-auth flow and surfaces the code/URL would need a new server RPC (e.g.
`serverStartProviderLogin`) that spawns `grok login --device-auth` / `claude
login` and streams the device code back. That RPC does not exist today; only this
one file (`MelaniProvidersSection.tsx`) would change to wire a button to it. Grok
device-auth is the natural first candidate since it prints a code+URL rather than
opening a browser.

## Gates

- `node scripts/verify.mjs`: types + web tests + server tests + routing. The
  pre-existing ProviderRegistry test failure is unrelated to this node (untouched
  provider registry). My typecheck is clean and my new tests pass.
- Melani e2e: green (see above).
- Never wrote `~/.t3/userdata`; test data seeded into the worktree `.t3`.

## Confidence

High on the settings menu + provider status + copy-connect path (proven live via
e2e + screenshots + unit tests). Medium on the auto-`[Connect]` device-auth
button, which is a documented server-capability gap, not a UI omission.
