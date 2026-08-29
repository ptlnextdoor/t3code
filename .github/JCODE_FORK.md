# jcode support in this T3 Code fork

This fork (`ptlnextdoor/t3code`) tracks Theo's upstream `pingdotgg/t3code` and adds a
**jcode provider** so T3 Code can drive jcode with its full memory + skills.

## Why it works
jcode ships an ACP adapter (`jcode acp`) that handshakes cleanly and reports
`sessionCapabilities.resume = true` and `loadSession = true`. T3 Code already drives
**Cursor** and **Grok** over ACP (`provider/acp/*AcpSupport.ts`, `packages/effect-acp`).
So jcode plugs into the existing ACP path rather than needing a bespoke wire protocol.

## Architecture: what a provider is here
Each provider is a trio plus registration, all Effect-TS:
- `Drivers/<Name>Driver.ts` — lifecycle, snapshot, maintenance (template: `GrokDriver.ts`, 164 LOC).
- `Layers/<Name>Adapter.ts` + `Layers/<Name>Provider.ts` — status probe + snapshot enrichment.
- `provider/acp/<Name>AcpSupport.ts` — ACP launch args + capability probe (template: `GrokAcpSupport.ts`).
- Registration: `builtInDrivers.ts`, `builtInProviderCatalog.ts`, `ProviderDriverKind`, `model-manifest.json`.
- UI: `apps/web/src/components/settings/providerDriverMeta.ts`, `providerModels.ts`,
  `components/chat/providerIconUtils.ts` (icon), settings form.
- Contracts: a `JcodeSettings` schema in `packages/contracts/src`.
- Tests alongside each (the repo gates on them).

Surface area ≈ the ~42 files that touch `grok` today. This is a multi-session build.

## Plan (tracked in issues/branch `feat/jcode-provider`)
1. **Probe** — confirm `jcode acp` launch args, auth model, and session-resume semantics
   against T3's `AcpSessionRuntime`. Capture a fixture of the initialize + session/new + prompt.
2. **Contracts** — add `JcodeSettings` + `ProviderDriverKind.make("jcode")`.
3. **ACP support** — `JcodeAcpSupport.ts` cloned from `GrokAcpSupport.ts`: command
   `jcode`, args `["acp"]`, executable discovery (`~/.local/bin/jcode`), CLI probe.
4. **Driver/Adapter/Provider** — clone the Grok trio, swap identity + status probe
   (`jcode version --json`).
5. **Register** — catalog, drivers, models manifest (pull jcode model list), icon, settings UI.
6. **Tests** — adapter + acp-support + registry, matching the Grok test set.
7. **Green** — `vp i` then the repo's typecheck + test; fix until clean.

## Keeping in sync with Theo
`.github/workflows/sync-upstream.yml` runs daily: fast-forwards a `upstream-main`
mirror and opens/updates a PR merging upstream into `main`. Your jcode changes live on
`main`; upstream lands via reviewed merge so conflicts (mostly in the registration files
above) never silently clobber the provider. Manual: `git fetch upstream && git merge upstream/main`.

## Status
- [x] Fork created, `upstream` remote wired, daily sync workflow added.
- [ ] Steps 1-7 above (the provider itself). Not started; each is a reviewable commit.
