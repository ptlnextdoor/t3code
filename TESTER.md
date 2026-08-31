# Testing Melani (thanks for trying it)

You're looking at an early build of a personal "superapp" called **Melani**: you
tell it what's on your plate, and it staffs a little team of employees that watch
your fronts and surface what actually needs you right now. This is a rough first
cut — you are one of the first people outside the build to touch it. Honest
feedback is the whole point.

> Note: the repo is named `t3code` (it's built on the open-source t3code
> harness); the app you'll see and use is **Melani**. Same thing, two names.

## Run it (one command)

You need a Mac with **Node 24+**, **pnpm**, and **git**. Then:

```bash
git clone https://github.com/ptlnextdoor/t3code.git
cd t3code
node scripts/friend-setup.mjs
```

That checks your setup, installs everything (a few minutes the first time), and
starts the app. When it prints **Open http://localhost:PORT**, open that in your
browser. The setup wizard greets you on the first run.

Re-running the command is safe. Stop the app with Ctrl-C.

## What to expect in the wizard

Five short steps: welcome → connections → remote server → brain-dump → done.
**Every step is skippable.** Skip anything that asks for something you don't have
and keep going. You can reach the end with zero connections configured.

The payoff is the last step: describe everything on your plate, and the app turns
it into a team with real things to escalate. Then poke around.

## Known limits (please read — these are not bugs)

- **Mac only for now.** Windows/Linux aren't wired up yet.
- **Google (Gmail/Calendar) won't connect unless I whitelist your email first.**
  The Google app is in test mode. **Send Aayu the Gmail address you'll use** and
  wait for a thumbs-up before trying the Gmail or Calendar step. Until then, just
  skip it — nothing else depends on it.
- **The AI brain-dump needs a logged-in `claude` (Claude Code) or `jcode` on
  your machine.** If you don't have one, the brain-dump step notices and switches
  to **"build your team by hand"** — you type a few life-areas and their items,
  and you get the same result. No AI required.
- **Remote server step needs a Hetzner token you won't have.** Skip it; it shows
  a "set this up later" path and moves on.
- Your data stays on your machine. This build talks to no server of ours.

## Telling me what broke

Open an issue on the fork — https://github.com/ptlnextdoor/t3code/issues — with:

1. what you were doing, 2. what you expected, 3. what happened (a screenshot of
   the terminal or the browser helps a lot). Rough notes are fine. Blunt is better
   than polite. Thank you for kicking the tires.
