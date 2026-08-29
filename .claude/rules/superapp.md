# Superapp architecture

t3code is the shell for a personal productivity super-app. Three sources merge here:

| Source      | Stack                       | Contributes                                                                    | Location                                            |
| ----------- | --------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------- |
| **t3code**  | Electron 41 + React 19 + TS | The shell: projects, threads, provider system, web/desktop/mobile surfaces     | this repo                                           |
| **jcode**   | ACP CLI (`jcode acp`)       | The engine layer. Already wired as a provider on branch `feat/jcode-provider`  | `~/.jcode`                                          |
| **grokbot** | Electron 42 + React 19 + TS | Inference router (Cursor/Claude/Codex/OpenRouter) + usage tracking             | `~/Downloads/asdfasdf/source`                       |
| **Melani**  | Swift (NOT ported)          | ONE concept only: a "Today" panel reading Dayflow activity + an approval queue | `~/Workspace/developer/roshni-cloud/desktop/melani` |

## Hard rules

- **Never port Melani's Swift.** It is 12.5k lines, mostly memo-generators and a mascot. Port only the _concept_ of the Today panel (~200 lines of React reading `~/Library/Application Support/Dayflow/chunks.sqlite` + `~/.jcode/knowledge-org/NOW.md`).
- **grokbot and t3code share React 19 + Electron.** The router bolts into t3code's existing provider contracts (`packages/contracts`), it does not get its own shell.
- **jcode is the default engine.** The jcode provider already exists; extend, do not rewrite.
- **Timebox.** Dayflow data shows the user spends 2x more time building agent tooling than on their #1 deliverable (the IECBES paper). This super-app IS tooling. Ship the smallest useful slice, do not gold-plate.

## Slices (smallest-first)

1. **TODAY panel** — Dayflow SQLite (read-only) + NOW.md at top of window. Highest value, smallest lift.
2. **grokbot router** — as a selectable provider alongside jcode.
3. **usage meter + approval queue** — port last.

See `SUPERAPP-PLAN.md` at repo root for the full durable plan.
