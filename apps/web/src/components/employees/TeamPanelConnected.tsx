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
    async (summary: EmployeeSummary) => {
      if (!defaultProjectRef) return;
      const opened = await handleNewThread(defaultProjectRef);
      if (!opened?.draftId) return;
      setPrompt(opened.draftId, buildBriefing(summary));
    },
    [defaultProjectRef, handleNewThread, setPrompt],
  );

  return <TeamPanel onOpenEmployee={(summary) => void openConversation(summary)} />;
}
