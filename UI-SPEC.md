# Melani UI Spec — Grok-Reference Teardown and Face Blueprint

Node N3.0 (UI architect, opus-4.8). This is the blueprint for rebuilding Melani's
face after the owner rejected the current "glorified chat app with a queue pane."
The reference is a reconstructed **Grok Bot 0.18** source tree at
`/Users/aayu/Workspace/developer/asdfasdf 2` (spaces in path — quote it).

Grok Bot is an Anysphere/Cursor-built **multi-agent desktop app**: a roster of
named agents you talk to like people, each with its own avatar, status, computer,
and async work. That is exactly the shape Melani wants (employees = their agents).
The design system ("sand" / `--cursor-*` + `--sand-*` tokens) is the same one we
already ported into `apps/web/src/sand.css`.

---

## 0. LICENSE / PROVENANCE — read this first, it governs everything below

The reference tree is **evidence-reconstructed proprietary xAI/Anysphere UI**.
Every recovered file carries `@evidence` byte-offsets into a shipped minified
bundle and deobfuscated StyleX class strings (`sand-ixxii4`, `sand-78zum5`, …).

**The rule for every node that follows this spec:**

1. We take **structure, layout, information architecture, interaction patterns,
   and state machines** — the _ideas_. These are not copyrightable as expressed
   here and are the actual value.
2. We **rewrite every line** against our own `sand.css` tokens and our own class
   names. **No verbatim copying** of their `.tsx`/`.css` into our repo. In
   particular: never paste a `sand-ixxii4`-style obfuscated class string; those
   are their compiled StyleX atoms and carry no meaning for us.
3. **No asset copying**: their `.woff2`, icons, avatars, images do not enter our
   repo. We use our own icon set (`apps/web/src/components/Icons.tsx`, JetBrains,
   Pierre) and our own persona renderer.
4. When this spec quotes their class names or copy strings, that is **spec
   shorthand** ("the row that behaves like `.sand-agent-item`"), not an
   instruction to reproduce the string.
5. Semantic behavior, DOM shape, ARIA roles, keyboard contracts, and CSS
   _values_ (durations, easings, spacing) are fair to reproduce — they are facts
   about how the interaction feels, and matching them is the whole point of the
   polish bar in §4.

If a node is ever unsure, the safe move is: **describe the behavior in our own
words, implement from the description.**

---

## 1. INFORMATION ARCHITECTURE

### 1.1 Surfaces

From `main.tsx` the app reports these surfaces:
`shell, account, sign-in, conversation, transcript, composer, sidebar, agents,
settings, plugins, updates, deep-links, desktop-bridge`.

Two _kinds_ of surface (`recovered/runtime/entrypoints.ts`):

- **workspace** — occupies the main stage, replaces the conversation. Only one:
  `view:org-chart` ("Org Chart").
- **overlay** — floats over everything as a dialog: `overlay:computer`,
  `overlay:hidden-chats`, `overlay:plugins`, `overlay:settings`.

Everything else (conversation, composer, sidebar, info-pane) is **always-present
shell**, not a routed surface. There is no page router in the SPA sense: the
whole app is one shell whose center swaps between _conversation_ and the _org
chart workspace_, with overlays and a right-hand info-pane layered on top.

### 1.2 Who owns the window

`ProductionRenderer.tsx` (3734 L) is the single root. It owns:

- the desktop `bridge`, coordinator client, account/auth, transport state;
- all the stores (sidebar layout, sections, collapse, drafts, roster selection,
  reply threads, pagination, permissions, computer, teach-recording…);
- every overlay's open/closed boolean and the `workspaceRoute` ("org-chart" | null);
- `WindowChrome` (custom titlebar drag region + min/max/close on Windows/Linux;
  a bare drag strip on macOS — `window-chrome/view.tsx`).

The shell is a **fixed 2-column CSS grid** (`ProductionRenderer` line ~3445):

```
gridTemplateColumns: `${sidebarWidth}px  minmax(0, 1fr)`
```

Left column is itself a 4-row grid: `[list] auto[hidden-bots] auto[plugins]
auto[account]`. Right column is the stage (conversation or org-chart).

### 1.3 Layout regions (ascii)

```
┌───────────────────────────────────────────────────────────────────────┐
│  WindowChrome drag region (transparent, 50px; controls on win/linux)    │
├──────────────────┬────────────────────────────────────────────────────┤
│ SIDEBAR (280px,  │  STAGE  (minmax(0,1fr))                              │
│ 240–400 resize,  │  ┌──────────────────────────────────────────────┐   │
│ 88px collapsed)  │  │ ConversationAgentHeader                       │   │
│                  │  │  [avatar] Name  ·Working    [Channels][info]  │   │
│ ┌ header 50px ─┐ │  ├──────────────────────────────────────────────┤   │
│ │ [⌾][+ New]   │ │  │                                              │   │
│ ├──────────────┤ │  │  ConversationTranscript                       │   │
│ │ [🔎 Search]  │ │  │   (messages, tool cards, media, threads)      │   │
│ ├──────────────┤ │  │                                              │   │  ← INFO PANE
│ │ Pinned       │ │  │                                              │   │    (right aside,
│ │  ▸ agent row │ │  │                                              │   │     320px, 280–480,
│ │ Section ▾    │ │  ├──────────────────────────────────────────────┤   │     data-open,
│ │  ▸ agent row │ │  │ sand-chat-input-dock                          │   │     layered on stage:
│ │  ▸ agent row │ │  │  [permission dock]                            │   │     AgentSettings /
│ │ Unassigned   │ │  │  ConversationComposer  [+][🎤][↑]             │   │     GroupMembers /
│ │  ▸ agent row │ │  └──────────────────────────────────────────────┘   │     Channels /
│ ├──────────────┤ │       (STAGE swaps wholesale to OrgChart workspace   │     Computer /
│ │ Hidden (n)   │ │        when workspaceRoute === "org-chart")          │     Routines)
│ │ [⌾ Plugins]  │ │                                                      │
│ │ [Account ▾]  │ │  Floating movable panels (async-tasks, outline)      │
│ └──────────────┘ │  Overlays (settings/plugins/computer/hidden) as dialogs
└──────────────────┴────────────────────────────────────────────────────┘
```

### 1.4 How you move between surfaces

- **Sidebar agent row click → `onOpenAgent(id)`** swaps the stage to that agent's
  conversation. This is the primary navigation act.
- **New (`+`) → `onNewChat`** creates an agent and opens it.
- **Org-chart button (header `⌾`) → `onOpenNetwork`** sets `workspaceRoute =
"org-chart"`, replacing the conversation stage. Its close button clears it.
- **Account menu / Plugins / Settings** open overlays (dialogs), leaving the
  shell mounted behind.
- **Info-pane** (agent settings, group members, channels, computer, routines,
  async-tasks) opens as a right-hand `aside.sand-info-pane[data-open]` or a
  floating movable panel — the conversation stays visible beside it.

Key insight: **navigation is agent-centric, not page-centric.** You are always
either _in a conversation with an employee_ or _looking at the whole team_
(org-chart). Overlays and info-panes are transient detail on top.

### 1.5 Sidebar organization (sidebar.tsx 508 L, sidebar-sections-state.ts)

The list is composed of, top to bottom:

1. **Header** (`AgentSidebarHeader`): collapsed → a single circular `+`; expanded
   → optional `Broadcast` (megaphone) + `Org chart` (network) icon buttons, then
   a square `+ New`. Below the header, a full-width **Search** button.
2. **Selection mode**: when `selectedAgentIds.length > 0`, the header is replaced
   by `SidebarSelectionActions` — a `Move ▾` menu (to existing/new section),
   `Delete`, `Clear`.
3. **Pinned group** (`sand-agents-pinned`): pinned agents, drag-reorderable
   among themselves (`onReorderPinnedAgents`, before/after by pointer midpoint).
4. **Sections** (`SidebarSection`): named, collapsible, reorderable buckets of
   agents. If `sections == null`, a flat `sand-agents-list__rows` is rendered
   instead. There is always a synthetic terminal section `__agents__` named
   **"Unassigned"** (`SIDEBAR_SYNTHETIC_SECTION_ID`) that cannot be renamed,
   moved, or deleted; deleting a real section moves its agents there.
5. **Footer rows** (owned by `ProductionRenderer`, not sidebar.tsx): a
   `Hidden bots (n)` button when any are hidden, a `Plugins` pill, and the
   `AccountMenu`.

Section state is **host-durable, account-scoped** (`sidebar.last-sections`
slice, schemaVersion 1) with optimistic ordering, stale-generation fencing,
3-try retry with backoff, and a write-failure surface. Membership: assigning an
agent to `__agents__` just removes it from all editable sections (the unassigned
bucket holds no durable membership).

Collapsed rail (`data-sidebar-collapsed`, 88px): avatars only, status corner
preserved, no body/trailing; the New button becomes a centered circle.

### 1.6 Org-chart's role vs the sidebar

They are **two views of the same roster**, for different questions:

- **Sidebar** = "which employee do I open?" — a linear, sectioned, searchable
  **list**, sorted by recency, organized by _you_. It is the workhorse.
- **Org chart** (`org-chart/workspace/*`) = "how does my team relate?" — a
  pan/zoom **force-ish graph** where nodes are agents/groups and edges are real
  agent-to-agent message history (solid) or group membership (dashed). An edge
  **lights up while both endpoints are mid-turn** (`getEdgeActivity` →
  `talking`), giving a live "who's talking to whom right now" picture. Selecting
  a node opens an inspector (`inspector.tsx`) with avatar, activity, about,
  members, last activity, and an **Open chat / Open room** button that routes
  back into the conversation. Footer copy: _"Solid links are real agent-to-agent
  message history; dashed links are group membership. A link lights up while both
  agents are mid-turn. Scroll to zoom, drag to pan, double-click to reset."_

For Melani the org-chart is the **team map** — a natural home for "show me my
whole staff and what they're doing." It is ADAPT (see §5), not core.

---

## 2. THE CONVERSATION EXPERIENCE

The whole reason this feels like _talking to a person_ and not a chat log:

### 2.1 The avatar is a living persona (`agent-avatar.tsx`)

Not initials, not a static image. The dispatcher order is:
**photo dataURL → shared-room glyph → group mosaic → animated persona mark**.
There is _deliberately no initials/CSS fallback_ — every agent has a persona.

- `PersonaMark` renders `OnboardingCharacter` (an animated SVG creature) with a
  `color` and `shape` derived deterministically from the agent id
  (`resolvePersonaColor`/`resolvePersonaShape`), so an agent's look is stable.
- The persona **reacts to what the agent is doing.** `personaStateFromAgent`
  maps live signals to states: `awaitingUserResponse → idle`, activity verbs and
  tool names → `thinking / searching / working / loading / sending / orbit`,
  `isComposingMessage → thinking`, `isRunning → working`. So the avatar visibly
  _thinks, searches, works_ while the agent runs. `emphasis` adds a drop-shadow
  glow. Sizes: xs16 sm22 md28 lg36 xl72.
- **Group** avatars are a 2/3/4-slot mosaic of member persona marks with a
  `+N` overflow chip; **shared-room** is a distinct globe glyph.

This is the single biggest "it's a person" lever. Melani must port the persona
concept (our own creature/renderer), not reduce agents to monograms.

### 2.2 Sidebar row status telegraphs presence (`sidebar-agent-status.ts`)

Each row projects a status machine: a **corner dot** on the avatar
(`running` pulse / `ring` for named activity / `marker` for needs-attention or
unread) and a **trailing marker** in expanded rows. States map to dot colors:
`working` (green), `needs-attention` (amber), `offline`, `error`, `info`. Marker
precedence: `waitingReason → "Needs attention"` beats `hasUnread → "Unread
activity"`. Working agents show a live **activity preview** (last message)
instead of the static last-message line.

### 2.3 The row itself (`AgentSidebarItem`, sidebar.tsx 204–294)

Grid: `34px avatar | 1fr body | auto trailing`, min-height 58px. Body =
`name` + a preview line that is, in priority: `Draft: …` / `Waiting for you: …` /
last message. Trailing = relative time (`now/12m/3h/2d`) + status marker.
Working rows swap the preview for a live activity carrier. Hover paints
`--cursor-bg-secondary`. Everything truncates, never wraps.

### 2.4 Transcript (`transcript.tsx` 799 L, `cards/`, `tool-results/`)

A message list of typed entries (`ConversationTranscriptEntry`): messages,
thinking, tool calls, computer handoffs, timeline events, and rich **cards**.

- **Message delivery states are first-class**: `QueuedSendNotice` ("Waiting to
  send…" / "Will send when reconnected" + Cancel), `FailedSendActions` ("Failed
  to send" + Resend/Delete), `SentWhileOfflineNotice` ("Sent while offline ·
  <time>"). This is what makes an unreliable remote link feel trustworthy —
  Melani's remote story needs exactly this.
- **Message hover actions** (`MessageActionAnchor`): copy, reply, start-thread,
  react. Right-click (context) opens the same menu unless the target is a
  link/image/textbox/selection.
- **Cards** (`cards/transcript-card/views/*`): attachment, cloud-agent,
  connector(s), email-draft, slack-draft, link-card, listener-connect,
  local-tool-permission, secret-request, send-message-text, widget. These are
  interactive tool results (approve, connect, respond) rendered inline. A
  `widget` with options is a keyboard-navigable choice embedded in the stream.
- **Tool results** (`tool-results/view.tsx`) render tool activity as structured
  boundaries, not raw text.
- **Rich media inline**: `media-viewer.tsx` (attachment gallery), `pdf-viewer`,
  `spreadsheet-viewer`, `mermaid.tsx` (diagrams), `math.tsx` (KaTeX). Find-in-
  chat (`find-in-chat.tsx`) uses CSS `::highlight()` for match/current.
- **Reply threads**: a message can start a thread (`ThreadAffordance`,
  `reply-thread-controller`), with a referenced-message preview
  (`referenced-message-preview.tsx`) and reply pill in the composer.
- **Reactions**: emoji reaction pills + picker (`reaction-picker.tsx`,
  `emoji-picker-content`), optimistic updates.

### 2.5 Composer (`composer.tsx`, `voice.tsx`, `rich-text-editor.tsx`)

A TipTap rich-text prompt (`PromptRichTextEditor`) inside a `sand-prompt-shell`
that **expands when it has payload** (`data-expanded`). Features:

- **Drag-drop / paste files** with a full-shell "Drop files to add to chat"
  overlay; attachment chips with size + remove; `COMPOSER_ATTACHMENT_LIMIT`.
- **Voice dictation** (`voice.tsx`, `useVoiceSession`): a mic button that records,
  shows a **waveform** and "Listening…", transcribes, inserts text, refocuses.
  Escape cancels voice then blurs.
- **Reply pill** when replying; placeholder becomes contextual ("Message
  <name>", or reply preview).
- **Send glyph morph**: the trailing button crossfades mic ↔ up-arrow by payload
  presence (opacity+scale, `COMPOSER_GLYPH_VISIBLE/HIDDEN`).
- Header (`chat-header.tsx`): avatar + name + `·Working` small-caps while running;
  clicking the identity opens agent settings; trailing Channels + computer/info
  toggles.

The feel: an assistant you _talk or type or drop files to_, whose face reacts,
whose messages you can reply-to/thread/react-to, whose failures are honest.

---

## 3. INTERACTION INVENTORY (from handlers, not guesses)

| Surface                   | Trigger                                     | Handler → effect                                                                                                                                                                 |
| ------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent row                 | **click**                                   | `onOpen()` → `onOpenAgent(id)`: swap stage to that conversation. `event.detail>1` ignored (lets dblclick win).                                                                   |
| Agent row                 | **⌘/Ctrl-click**                            | `onToggleSelect(id)` → enter multi-select.                                                                                                                                       |
| Agent row                 | **Shift-click**                             | `onRangeSelect(id)` → range select.                                                                                                                                              |
| Agent row                 | **double-click**                            | `setIsRenaming(true)` → inline `AgentNameEditor`.                                                                                                                                |
| Agent row                 | **drag**                                    | pinned → reorder among pinned (before/after by midpoint); sectioned → `setData(text/plain, id)` for section drop.                                                                |
| Agent row                 | **right-click / ⋯**                         | `AgentRowActions` menu: pin/unpin, rename, duplicate, copy id, hide, move-to-section / new-section, open profile, show full conversation, show async tasks, mark unread, delete. |
| Agent row                 | **hover**                                   | `AgentPreviewCompositor` shows a hover preview card (header+content) when host reachable + preview enabled.                                                                      |
| Avatar (row/header)       | —                                           | avatar is `aria-hidden` decorative; the _row/identity button_ carries the click. Avatar editing is via agent settings → `AvatarEditorView`.                                      |
| Section header            | **click**                                   | `onToggleSectionCollapsed(id, !collapsed)`.                                                                                                                                      |
| Section header            | **ContextMenu/Shift-F10 / ⋯**               | `SidebarSectionActions`: Rename, Move up, Move down (bounded by `sidebarSectionActionState`, synthetic disabled), Delete (confirm dialog: agents move to Unassigned).            |
| Section header            | dbl-click name                              | inline `SidebarSectionNameEditor` (Enter commit, Esc cancel).                                                                                                                    |
| Section body              | **drop**                                    | `onMoveAgentToSection([id], section.id)`; hovering paints `__reveal`.                                                                                                            |
| New (`+`)                 | click                                       | `onNewChat` → create + open agent.                                                                                                                                               |
| Broadcast                 | click                                       | `onBroadcast` → message all agents.                                                                                                                                              |
| Org-chart btn             | click                                       | `onOpenNetwork` → `workspaceRoute="org-chart"`.                                                                                                                                  |
| Search                    | click / Enter/Space                         | `onOpenSearch` (command-palette style search trigger).                                                                                                                           |
| Org-chart node            | **click**                                   | `setLocalSelected(id)` + `onSelectAgent(id)` + `onOpenAgent(id)` — selects _and_ opens. Inspector shows alongside.                                                               |
| Org-chart scene           | wheel                                       | zoom to cursor; drag (>4px) → pan; double-click empty → reset viewport.                                                                                                          |
| Inspector                 | Open chat/room                              | `onOpenAgent(id)`.                                                                                                                                                               |
| Chat header identity      | click                                       | `onToggleSettings` → open Agent Settings info-pane.                                                                                                                              |
| Chat header info/computer | click                                       | `onToggleInfo` → computer/group info pane.                                                                                                                                       |
| Chat header Channels      | click                                       | toggle channels info-pane (mutually exclusive with other panes).                                                                                                                 |
| Composer send             | Enter / ↑                                   | `onSubmit` when `canSend` (payload && !disabled && !voiceBusy).                                                                                                                  |
| Composer mic              | click                                       | start/stop voice session.                                                                                                                                                        |
| Composer attach `+`       | click                                       | open file picker (disabled at limit / while voice busy).                                                                                                                         |
| Message                   | hover copy/reply/react, ⋯ menu, right-click | copy / `onReply` / `onStartThread` / reaction picker.                                                                                                                            |
| Message (queued/failed)   | Cancel/Resend/Delete                        | delivery-state actions.                                                                                                                                                          |
| Hidden bots (n)           | click                                       | open `overlay:hidden-chats`.                                                                                                                                                     |
| Plugins pill              | click                                       | open `overlay:plugins`.                                                                                                                                                          |
| Account menu              | items                                       | about/feedback/help/settings/usage/logout/sign-in, update pill.                                                                                                                  |
| Async-tasks panel         | —                                           | movable (drag header via `useMovablePanel`), lists subagent/shell/cloud tasks with live elapsed time; close button.                                                              |
| Notifications             | —                                           | `window-chrome/notification-host` + `app-alert` host render toasts/alerts over the shell.                                                                                        |

Mutual exclusion rule (repeated across ProductionRenderer): opening any info-pane
(settings/group/channels/computer/routines/shared-room) closes the others.

---

## 4. MOTION + POLISH (the bar)

Harvested from `recovered/**/*.css`. These are the concrete values to match.
Reproducing durations/easings is fair (facts about feel); reproduce with our own
class names.

### Durations

- **120ms (.12s)** — the dominant micro-interaction: background/color/opacity/width
  hover transitions on rows, section headers, buttons, chips.
- **140ms (.14s)** — secondary control transitions.
- **90ms (.09s)** — fast opacity (glyph fades, reveal).
- **160ms (.16s)** — opacity settle; card enter (`.16s cubic-bezier(.16,1,.3,1)`).
- **180ms (.18s)** — menu/popover enter (`.18s cubic-bezier(.16,1,.3,1)`).
- **240ms (.24s)** — sidebar **width** transition (`cubic-bezier(.22,1,.36,1)`),
  the collapse/expand feel.
- **280ms (.28s)** — animation-duration for entrance keyframes.
- **420ms (.42s)** — onboarding suggestion enter (`cubic-bezier(.1,.9,.2,1) both`).
- **500ms (.5s)** — large transform settle (`transform .5s cubic-bezier(.19,1,.22,1)`).
- **700ms / 1s / 1.4s** — spinner / status loops (linear infinite).
- Also mapped to tokens: `--cursor-duration-fast`, `--cursor-spinner-sync-duration`.

### Signature easings

- `cubic-bezier(.16, 1, .3, 1)` — **the house ease-out-expo-ish** for cards/menus.
- `cubic-bezier(.22, 1, .36, 1)` — sidebar width.
- `cubic-bezier(.19, 1, .22, 1)` — big transform settle.
- `cubic-bezier(.1, .9, .2, 1)` — onboarding enter.
- `ease` / `ease-out` / `ease-in-out` / `linear` for the humble cases.
- `cubic-bezier(.77,0,.175,1)` and `cubic-bezier(.895,.03,.685,.22)` appear for
  sharper in/out curves.

### Named keyframes (behaviors to recreate, not copy)

`sand-status-spinner` (1s linear infinite), `sand-loading-spin`,
`sand-outline-item-spin`, `sand-onboarding-suggestion-enter`,
`sand-onboarding-step-enter/-exit`, `sand-onboarding-cast-bob` (idle avatar bob),
plus StyleX atoms `sand-18mpaig-B / sand-1wc8ddo-B / sand-9wdec0-B` (generic
enter/fade families).

### Reduced motion

Several transitions are wrapped in `@media (prefers-reduced-motion: reduce)` →
`transition: none` (or reduced to a plain opacity). **Honor this everywhere** —
per the repo's own "no continuously repainting animations" rule, our port must
respect reduced-motion and avoid GPU-pegging loops on high-refresh displays.

### Spacing / hairlines (feel details)

- Row min-height 58px; avatar 34px; sidebar header 50px; section header 30px.
- Hairlines are `1px solid var(--cursor-stroke-tertiary)`.
- Fills are **color-mix translucent layers** over `--sand-base`, never flat
  hexes (our `sand.css` already encodes this — keep it).
- Radii via `--cursor-radius-lg / -full`; sidebar 240–400px (default 280),
  collapsed 88; info-pane 280–480 (default 320).

Polish bar in one line: **120ms `ease` micro-hovers, 240ms
`cubic-bezier(.22,1,.36,1)` layout, `cubic-bezier(.16,1,.3,1)` for anything that
pops in, translucent color-mix fills, 1px hairlines, and a persona avatar that
animates its state — all of it disabled under reduced-motion.**

---

## 5. THE PORT MAP

Legend: **PORT-AS-IS** (structure works for Melani directly) ·
**ADAPT** (rework around our roster / NOW.md / employee concepts) ·
**SKIP** (xAI/Cursor-specific) · **OURS-ALREADY** (we have an equivalent).

Concept mapping:

- Their **agent** = our **employee** (`components/employees/roster.ts`). Ours are
  derived from measured session topics, escalate via NOW.md, and only "exist"
  when they have escalations.
- Their **async-tasks / notifications** ≈ our **Queue** (the pane the owner
  called half-assed). Reframe as per-employee async work + escalations.
- Their **agent status/presence** ≈ our **NOW.md item → owner** join
  (`briefing.ts`, `summarize.ts`).
- **NOW.md briefing** = the opening message we prime a conversation with when you
  click an employee (`buildBriefing`) → maps onto their **conversation open** +
  the sidebar row's `Waiting for you:` / draft preview.

| Grok surface                                                                | Verdict                    | Melani mapping / our code                                                                                                                                                               |
| --------------------------------------------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Shell 2-col grid + resizable sidebar**                                    | PORT-AS-IS (rewrite)       | New shell replacing today's layout. Overlaps `AppSidebarLayout.tsx`, `SidebarChrome.tsx`.                                                                                               |
| **WindowChrome** (custom titlebar)                                          | OURS-ALREADY / ADAPT       | We have desktop chrome (`workspaceTitlebar.ts`, static shell "Melani title"). Keep ours; adopt their drag-region discipline.                                                            |
| **ConversationSidebar** (rows/sections/pinned/collapse/select)              | PORT-AS-IS (rewrite)       | This is the core. Replaces `LegacySidebar.tsx` / `Sidebar.tsx`. Employees become the roster; sections = life-areas.                                                                     |
| **AgentSidebarItem** row + status machine                                   | ADAPT                      | Row shows employee + its top NOW.md ask (`Waiting for you:`), owner join. Reuse `ThreadStatusIndicators.tsx` semantics.                                                                 |
| **AgentAvatar / persona**                                                   | ADAPT                      | Port the _persona-that-reacts_ idea with OUR renderer (no OnboardingCharacter asset). Big lever; do not skip.                                                                           |
| **Sidebar sections state** (durable, account-scoped)                        | ADAPT                      | We have no sections yet. Back with our persistence (`clientPersistenceStorage.ts`), not their host box.                                                                                 |
| **ConversationTranscript** + delivery states                                | ADAPT                      | We have `MessagesTimeline.tsx`, `ChatView.tsx`. Adopt their queued/failed/offline notices + reply threads; keep our provider-message model.                                             |
| **Transcript cards / tool-results**                                         | ADAPT / OURS-PARTLY        | We already render tool results, plans, approvals (`ProposedPlanCard`, `ComposerPendingApprovalPanel`). Adopt inline-card _pattern_; map to our provider events.                         |
| **Composer** (rich text, drop, voice, glyph morph)                          | ADAPT / OURS-ALREADY       | We have a deep composer (`ChatComposer.tsx`, `ComposerPromptEditor.tsx`, banners, stash, command menu). Adopt the _shell expand + send-glyph morph + drop overlay_; voice is new (ADD). |
| **Voice dictation + waveform**                                              | ADAPT (new)                | New capability; gate behind availability like they do.                                                                                                                                  |
| **Chat header** (identity → settings, working badge)                        | ADAPT                      | Replaces `chat/ChatHeader.tsx`. Employee identity opens employee settings.                                                                                                              |
| **Org-chart workspace** (graph/inspector/edges)                             | ADAPT                      | "Team map" — nodes = employees, edges = who-hands-to-whom. High value, second slice. Overlaps `AgentsPanel.tsx`.                                                                        |
| **Async-tasks movable panel**                                               | ADAPT → **our Queue**      | Reframe the rejected Queue as this: per-employee live async work (subagent/shell/cloud), movable panel.                                                                                 |
| **Agent settings / avatar-editor / channels / group-members / shared-room** | ADAPT (later)              | Info-pane pattern. Settings maps to employee config; group/shared-room only if Melani has multi-employee rooms.                                                                         |
| **Roster status** (loading/empty/all-hidden/error)                          | PORT-AS-IS (rewrite)       | Directly reusable copy/states; "Connecting to your computer…" → our env-connect state.                                                                                                  |
| **Reconnect / privacy-blocked / connection-state**                          | OURS-ALREADY / ADAPT       | We have `ConnectionStatusDot`, `ProviderStatusBanner`, `ThreadSyncStatusPill`. Fold their reconnect notices into ours.                                                                  |
| **Automations / routines** (schedule editor, run history)                   | ADAPT (later)              | Maps to Melani scheduled work; overlaps our scheduler. Not first slice.                                                                                                                 |
| **Computer / terminal / VNC webview**                                       | ADAPT / OURS-PARTLY        | We have `terminal/`, `ThreadTerminalDrawer.tsx`. Their "agent has a computer" framing is aspirational; later.                                                                           |
| **Onboarding (signed-in character scene)**                                  | SKIP → OURS                | We have `onboarding/` + `setup/`. Keep ours.                                                                                                                                            |
| **Settings overlay** (updates, auto-review, computer)                       | OURS-ALREADY               | We have `settings/` + `usage/` + desktop update flow. Keep ours; borrow layout.                                                                                                         |
| **Plugins overlay** (github-auth, server-tools, browser)                    | OURS-ALREADY (connections) | Owner note: wizard + connection cards are ours. Map "Plugins" → our `connections/`.                                                                                                     |
| **Account/session/sign-in, billing, usage**                                 | SKIP (xAI)                 | We use Clerk (`clerk/`, `auth/`) + our usage. Do not port their account menu.                                                                                                           |
| **Deep-links / feedback / about / update-required**                         | OURS-ALREADY               | We have desktop update + branding. Keep ours.                                                                                                                                           |
| **Hidden-chats overlay**                                                    | ADAPT                      | Small; maps to hide/unhide employees. Reverse-state for the hide action (repo rule: add the way out).                                                                                   |
| **Command palette**                                                         | OURS-ALREADY               | We have `CommandPalette.tsx`. Wire their search trigger into it.                                                                                                                        |
| **sand UI primitives** (`ui/sand-*`)                                        | ADAPT                      | We already have `sand.css` + `components/ui`. Extend ours to cover their primitives (buttons, menus, status dots, spinners) — do not import theirs.                                     |

---

## 6. BUILD PLAN (ordered vertical slices)

Each node lands alone and is demoable. Their code is _spec_, not source: every
node **rewrites against our `sand.css` + our components**. Sizes are honest.

### N3.1 — Shell + Sidebar + Conversation core (the 80% feel) — **L**

The one that must land first; it is the whole "not a chat app" impression.

- New root shell: fixed 2-col grid, resizable/collapsible sidebar (240–400/88,
  240ms width ease), 4-row left column, `minmax(0,1fr)` stage.
- `MelaniSidebar`: header (+New, Search, Org-chart, Broadcast), roster from
  `employees/roster.ts`, **AgentSidebarItem** rows (34px persona avatar, name,
  NOW.md-ask preview line, relative time, status corner), hover preview,
  row-click → open employee conversation, ⋯ actions menu, inline rename.
- Sections (life-areas) with collapse + synthetic "Unassigned"; durable via our
  persistence. Selection mode + bulk actions.
- Conversation stage: chat header (persona + name + working badge), transcript
  wired to our provider messages (reuse `MessagesTimeline`), composer shell with
  send-glyph morph + drop overlay (reuse `ChatComposer`), input dock.
- Roster status states (loading/empty/all-hidden/error).
- Reduced-motion honored throughout.
  Deliberately deferred here: persona _animation states_, threads, voice, cards.
  Ship it static-but-alive first.

### N3.2 — Persona avatar that reacts — **M**

- Our own creature/mark renderer (no xAI asset), deterministic color/shape from
  employee id, `personaStateFromAgent` mapping to idle/thinking/working/…,
  emphasis glow, group mosaic, sizes xs–xl. Wire live state from running/activity
  signals. This is the second-biggest feel lever.

### N3.3 — Honest delivery + reply threads — **M**

- Queued / failed / sent-while-offline notices in the transcript (critical for
  our remote story), message hover actions (copy/reply/react), reply threads +
  referenced-message preview + composer reply pill. Reactions optional tail.

### N3.4 — Queue → per-employee async work + escalations — **M**

- Reframe the rejected Queue as the async-tasks movable panel: per-employee live
  work (subagent/shell/cloud) with elapsed time, plus NOW.md escalations join.
  Notification host for toasts. Hidden-employees overlay + unhide (reverse state).

### N3.5 — Team map (org-chart) — **M**

- Pan/zoom graph of employees; edges = handoff/relationship, live "talking" glow
  when both mid-turn; inspector with Open chat. Replaces `AgentsPanel.tsx`.

### N3.6 — Employee detail info-pane — **M**

- Right-hand info-pane: employee settings (name/role/description/notifications),
  avatar editor (our persona picker), channels/group only if multi-employee
  rooms exist. Mutual-exclusion pane manager.

### N3.7 — Voice + rich media polish — **S/M**

- Voice dictation + waveform in composer; inline pdf/spreadsheet/mermaid/math
  viewers and attachment gallery if not already covered.

### N3.8 — Automations / computer (aspirational) — **L, later**

- Routines/schedule editor mapped to Melani scheduled work; "employee has a
  computer" terminal/VNC framing. Only after the core lands and proves out.

Ordering rationale: N3.1 delivers the impression the owner is missing; N3.2–N3.3
make it feel _alive and trustworthy_; N3.4 fixes the specific thing he called
half-assed; N3.5+ are breadth.

---

## 7. FILES ACTUALLY READ (provenance of this spec)

Read in full: `main.tsx`, `runtime/entrypoints.ts`, `catalog.ts`,
`window-chrome/view.tsx`, `conversation/workspace/sidebar.tsx` (all 508 L via
three reads), `sidebar-sections-state.ts`, `sidebar-agent-status.ts`,
`sidebar-layout-state.ts`, `composer.tsx`, `agent-avatar.tsx`, `chat-header.tsx`,
`org-chart/workspace/view.tsx` + `model.ts` + `graph.tsx` + `inspector.tsx`,
`roster/status.tsx`, `agent-info/settings/view.tsx`,
`agent-info/avatar-editor/view.tsx` (head), `agent-info/async-tasks/view.tsx`,
`conversation/workspace/view.css` (layout), `ProductionRenderer.tsx` (imports +
shell region 3435–3555). Transcript.tsx read to 240 L (skimmed remainder).
Motion harvested by grepping every `recovered/**/*.css`. Our side:
`employees/roster.ts`, `briefing.ts`, `TeamPanel.tsx`, `TodayPanel.tsx` head,
`sand.css` head, and directory listings of `apps/web/src/components/{chat,
sidebar,employees}`. Skimmed-by-filename: the remaining ~80 recovered files
(automations, computer, plugins, permissions, terminal, settings overlay, cards
views), listed in the full recovered tree.

Not read line-by-line (evidence gap, low risk): full transcript.tsx internals
past 240 L, individual card view files, voice.tsx internals, rich-text-editor
internals, automations. Their _purpose_ is inferred from names + imports +
ProductionRenderer wiring; deep reads belong to the node that ports each.
