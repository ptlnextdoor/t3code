/**
 * Router-aware wiring for the Team surface.
 *
 * TeamPanel itself stays free of router and draft-store context so it can
 * render anywhere (including a design harness). This wrapper is the only place
 * that knows how to actually open a conversation, and it is mounted only where
 * that context exists.
 */
import { useCallback } from "react";

import { openCommandPalette } from "../../commandPaletteBus";
import { useComposerDraftStore } from "../../composerDraftStore";
import { useHandleNewThread } from "../../hooks/useHandleNewThread";
import { TodayPanel } from "../TodayPanel";
import { buildBriefing } from "./briefing";
import type { PanelOpenOutcome } from "./panelOutcome";
import type { EmployeeSummary } from "./summarize";
import { TeamPanel } from "./TeamPanel";

// The one real blocker on a fresh install is "no project yet". Rather than a
// dead click or a bare notice, the outcome carries an action that opens the
// add-project flow inline, so the user recovers without leaving the rail.
const addProjectOutcome = (subject: string): PanelOpenOutcome => ({
  reason: `Add a project first, then ${subject} can open a chat.`,
  action: { label: "Add project", run: () => openCommandPalette({ open: "add-project" }) },
});

export function TeamPanelConnected() {
  const { handleNewThread, defaultProjectRef } = useHandleNewThread();
  const setPrompt = useComposerDraftStore((store) => store.setPrompt);

  /**
   * Open a conversation with an employee, pre-filling the composer with its
   * briefing. Deliberately NOT auto-sent: the human edits and sends, so the
   * worker is never given an instruction its manager did not read.
   */
  const openConversation = useCallback(
    async (summary: EmployeeSummary): Promise<PanelOpenOutcome> => {
      // No project means there is nowhere to open a thread. Say so and offer
      // the fix, rather than dying on the click, which read as "the buttons
      // don't work".
      if (!defaultProjectRef) return addProjectOutcome("employees");
      const opened = await handleNewThread(defaultProjectRef);
      if (!opened?.draftId) return { reason: "Could not open a conversation." };
      setPrompt(opened.draftId, buildBriefing(summary));
      return null;
    },
    [defaultProjectRef, handleNewThread, setPrompt],
  );

  return <TeamPanel onOpenEmployee={openConversation} />;
}

/**
 * Queue with its row actions wired: Review / Reply / Draft / Decide open a
 * conversation with the item's owning employee, briefed on that one item.
 */
export function TodayPanelConnected() {
  const { handleNewThread, defaultProjectRef } = useHandleNewThread();
  const setPrompt = useComposerDraftStore((store) => store.setPrompt);

  const openItem = useCallback(
    async (briefing: string): Promise<PanelOpenOutcome> => {
      if (!defaultProjectRef) return addProjectOutcome("the queue");
      const opened = await handleNewThread(defaultProjectRef);
      if (!opened?.draftId) return { reason: "Could not open a conversation." };
      setPrompt(opened.draftId, briefing);
      return null;
    },
    [defaultProjectRef, handleNewThread, setPrompt],
  );

  return <TodayPanel onOpenItem={openItem} />;
}
