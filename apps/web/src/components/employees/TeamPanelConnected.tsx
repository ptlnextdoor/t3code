/**
 * Router-aware wiring for the Team surface.
 *
 * TeamPanel itself stays free of router and draft-store context so it can
 * render anywhere (including a design harness). This wrapper is the only place
 * that knows how to actually open a conversation, and it is mounted only where
 * that context exists.
 *
 * Zero-config rule (SUPERAPP-PLAN employee layer): clicking a person ALWAYS
 * opens a conversation. The employee hides sessions AND projects — we never ask
 * the user to "add a project first". When none exists, we silently provision a
 * neutral workspace project ("Life") and open the thread in it. The notice slot
 * survives only for REAL failures (server unreachable), never for missing
 * infrastructure.
 */
import { useAtomValue } from "@effect/atom-react";
import { type ScopedProjectRef } from "@t3tools/client-runtime/environment";
import { useCallback, useMemo, useRef } from "react";

import { useComposerDraftStore } from "../../composerDraftStore";
import { useHandleNewThread } from "../../hooks/useHandleNewThread";
import { newProjectId } from "../../lib/utils";
import { resolveDefaultProviderModelSelection } from "../../providerInstances";
import { useProjects } from "../../state/entities";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { projectEnvironment } from "../../state/projects";
import { primaryServerProvidersAtom } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { TodayPanel } from "../TodayPanel";
import { buildBriefing } from "./briefing";
import { createEnsureWorkspaceProject, type EnsureCreateInput } from "./ensureWorkspaceProject";
import type { PanelOpenOutcome } from "./panelOutcome";
import type { EmployeeSummary } from "./summarize";
import { TeamPanel } from "./TeamPanel";

/**
 * A stable ensure-workspace-project function that self-provisions once and
 * reuses thereafter. Shared by both connected panels so a click in either
 * surface, on a projectless instance, silently creates the workspace and opens
 * a thread — never a "no project" dead end.
 *
 * Returns a resolver that yields the project ref to open a thread in: the
 * existing default when there is one, otherwise a freshly (or previously)
 * provisioned workspace. `null` only when provisioning genuinely failed (server
 * unreachable), which is the sole case the caller surfaces as a notice.
 */
function useEnsureProjectRef() {
  const { defaultProjectRef } = useHandleNewThread();
  const projects = useProjects();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const providers = useAtomValue(primaryServerProvidersAtom);
  const createProject = useAtomCommand(projectEnvironment.create, { reportFailure: false });

  // Latest-value refs so the memoised ensure closure always reads current data
  // without being recreated (recreating it would drop its in-flight/created
  // memo and reopen the double-create window).
  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  const providersRef = useRef(providers);
  providersRef.current = providers;

  const ensure = useMemo(() => {
    if (!primaryEnvironmentId) return null;
    return createEnsureWorkspaceProject({
      environmentId: primaryEnvironmentId,
      listProjects: () => projectsRef.current,
      newProjectId,
      createProject: async (input: EnsureCreateInput) => {
        const result = await createProject({
          environmentId: input.environmentId,
          input: {
            projectId: input.projectId,
            title: input.title,
            workspaceRoot: input.workspaceRoot,
            createWorkspaceRootIfMissing: true,
            defaultModelSelection: resolveDefaultProviderModelSelection(providersRef.current, null),
          },
        });
        return result._tag === "Success";
      },
    });
  }, [primaryEnvironmentId, createProject]);

  return useCallback(async (): Promise<ScopedProjectRef | null> => {
    if (defaultProjectRef) return defaultProjectRef;
    if (!ensure) return null;
    return ensure();
  }, [defaultProjectRef, ensure]);
}

export function TeamPanelConnected() {
  const { handleNewThread } = useHandleNewThread();
  const setPrompt = useComposerDraftStore((store) => store.setPrompt);
  const ensureProjectRef = useEnsureProjectRef();

  /**
   * Open a conversation with an employee, pre-filling the composer with its
   * briefing. Deliberately NOT auto-sent: the human edits and sends, so the
   * worker is never given an instruction its manager did not read.
   *
   * No project yet is NOT a blocker: we provision one silently, then open. The
   * only notice a click can raise is a genuine failure (couldn't provision, or
   * couldn't open) — the plumbing never leaks into the product.
   */
  const openConversation = useCallback(
    async (summary: EmployeeSummary): Promise<PanelOpenOutcome> => {
      const projectRef = await ensureProjectRef();
      if (!projectRef) return { reason: "Could not reach the server. Try again in a moment." };
      const opened = await handleNewThread(projectRef);
      if (!opened?.draftId) return { reason: "Could not open a conversation." };
      setPrompt(opened.draftId, buildBriefing(summary));
      return null;
    },
    [ensureProjectRef, handleNewThread, setPrompt],
  );

  return <TeamPanel onOpenEmployee={openConversation} />;
}

/**
 * Queue with its row actions wired: Review / Reply / Draft / Decide open a
 * conversation with the item's owning employee, briefed on that one item.
 * Same zero-config guarantee as the Team surface: no project yet self-provisions.
 */
export function TodayPanelConnected() {
  const { handleNewThread } = useHandleNewThread();
  const setPrompt = useComposerDraftStore((store) => store.setPrompt);
  const ensureProjectRef = useEnsureProjectRef();

  const openItem = useCallback(
    async (briefing: string): Promise<PanelOpenOutcome> => {
      const projectRef = await ensureProjectRef();
      if (!projectRef) return { reason: "Could not reach the server. Try again in a moment." };
      const opened = await handleNewThread(projectRef);
      if (!opened?.draftId) return { reason: "Could not open a conversation." };
      setPrompt(opened.draftId, briefing);
      return null;
    },
    [ensureProjectRef, handleNewThread, setPrompt],
  );

  return <TodayPanel onOpenItem={openItem} />;
}
