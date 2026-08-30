/**
 * Router-aware wiring for the Team surface.
 *
 * TeamPanel itself stays free of router and draft-store context so it can
 * render anywhere (including a design harness). This wrapper is the only place
 * that knows how to actually open a conversation, and it is mounted only where
 * that context exists.
 */
import { useCallback } from "react";

import { useComposerDraftStore } from "../../composerDraftStore";
import { useHandleNewThread } from "../../hooks/useHandleNewThread";
import { TodayPanel } from "../TodayPanel";
import { buildBriefing } from "./briefing";
import type { EmployeeSummary } from "./summarize";
import { TeamPanel } from "./TeamPanel";

export function TeamPanelConnected() {
  const { handleNewThread, defaultProjectRef } = useHandleNewThread();
  const setPrompt = useComposerDraftStore((store) => store.setPrompt);

  /**
   * Open a conversation with an employee, pre-filling the composer with its
   * briefing. Deliberately NOT auto-sent: the human edits and sends, so the
   * worker is never given an instruction its manager did not read.
   */
  const openConversation = useCallback(
    async (summary: EmployeeSummary): Promise<string | null> => {
      // No project means there is nowhere to open a thread. Say so rather than
      // dying on the click, which read as "the buttons don't work".
      if (!defaultProjectRef) return "Add a project first, then employees can open a chat.";
      const opened = await handleNewThread(defaultProjectRef);
      if (!opened?.draftId) return "Could not open a conversation.";
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
    async (briefing: string): Promise<string | null> => {
      if (!defaultProjectRef) return "Add a project first, then the queue can open a chat.";
      const opened = await handleNewThread(defaultProjectRef);
      if (!opened?.draftId) return "Could not open a conversation.";
      setPrompt(opened.draftId, briefing);
      return null;
    },
    [defaultProjectRef, handleNewThread, setPrompt],
  );

  return <TodayPanel onOpenItem={openItem} />;
}
