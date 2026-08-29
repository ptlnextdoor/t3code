# Phase 1 findings — jcode ACP contract (verified against jcode 0.75.5)

## THE decision (kills the 15% risk)
jcode **rejects** ACP `authenticate` → `-32601 Unsupported ACP method`, but needs no auth.
`session/new` + `session/prompt` work immediately after `initialize`.

**Fix chosen (ponytail, spec-correct, minimal blast):** make `authMethodId` optional in
`AcpSessionRuntime` and skip the `authenticate` call when absent. jcode provider omits it;
Cursor/Grok/Cursor pass their string unchanged. 1 field + 1 guard in `AcpSessionRuntime.ts`.
Done in this commit. No `effect-acp` schema change, no per-agent auth strings.

## Round-trip proven end to end
`initialize → session/new → session/prompt("reply PONG") → agent_message_chunk "P","ONG" → stopReason end_turn`.
Streaming uses standard `session/update` / `agent_message_chunk`, which T3's `AcpRuntimeModel`
already consumes. Fixture: `testFixtures/jcode/handshake.ndjson`.

## AcpRuntimeModel expectation → jcode reality
| T3 expects | jcode does | gap? |
|---|---|---|
| `initialize` handshake | ✅ protocolVersion 1, agentInfo{name:jcode} | none |
| `authenticate(methodId)` | ❌ errors -32601 | **skip auth (fixed)** |
| `session/new{cwd,mcpServers}` | ✅ returns sessionId + configOptions(model list) | none |
| `session/prompt` streaming | ✅ agent_message_chunk + stopReason | none |
| `loadSession`/`resume` | ✅ advertised true | verify in Phase 5 |
| model selection | configOptions `model` + `/model` command | map to T3 model picker later, not blocking |
| MCP http/sse | ✅ false (jcode runs its own MCP) | T3 can pass `mcpServers: []` |
| permission prompts | not exercised yet | verify in Phase 5, T3 path already handles |

## Scope correction vs original plan
- **Template = Cursor, not Grok** (jcode = local agent binary + `acp` subcommand, no OAuth/API key).
  Grok's XAI extension (686 LOC) is NOT copied.
- Auth is the only shared-runtime change. Everything else is additive provider files.
- Model picker parity deferred (T3 shows configOptions; not blocking a working chat).
