---
paths:
  - "**/providers/**"
  - "**/provider*"
  - "**/contracts/**"
  - "**/*Provider*"
  - "**/*Driver*"
---

# Provider + router merge

## Existing jcode provider (branch `feat/jcode-provider`)

Already built and live-tested. Files follow t3code's Driver/Adapter/Provider seam:

- `JcodeDriver`, `JcodeAdapter`, `JcodeProvider`, `JcodeAcpSupport`, `JcodeTextGeneration`
- Wired into `contracts` (`JcodeSettings`, `model.ts`) and `builtInDrivers.ts`
- Uses `jcode acp` (ACP CLI). `authMethodId` omitted (jcode rejects authenticate).
- **Resume works** via `session/load` — proven on an 843-msg session.

## grokbot router (to merge)

Source: `~/Downloads/asdfasdf/source/host` and `source/node-agent-coordinator`.
Router targets: Cursor, Claude Code, Codex, OpenRouter + usage tracking.

**Rule:** map grokbot's router to t3code's _existing_ provider contracts. Do not import grokbot's Electron shell or gateway server wholesale. Extract the routing + usage-metering logic, express it as t3code providers. Reuse `JcodeProvider` as the reference implementation.

## Never

- Never rewrite the jcode provider seam; extend it.
- Never send large payloads over the websocket (t3code perf rule in AGENTS.md).
