@AGENTS.md

## Superapp

This repo is the shell for a personal productivity super-app (t3code + jcode engine +
grokbot router + a Today panel ported from Melani). See `SUPERAPP-PLAN.md` for the durable plan.

Config lives in `.claude/`:

- `.claude/rules/superapp.md` — architecture + hard rules (always loaded)
- `.claude/rules/dayflow-bridge.md` — Dayflow SQLite schema (loads when touching today/dayflow files)
- `.claude/rules/provider-merge.md` — jcode provider + grokbot router (loads on provider/contract files)
- `.claude/agents/` — `dayflow-bridge-builder`, `provider-router-merger`
