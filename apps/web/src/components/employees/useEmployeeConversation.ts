/**
 * The one place that knows how to open a conversation with an employee.
 *
 * Extracted verbatim from TeamPanelConnected so the Melani sidebar rows and the
 * legacy Team rail share ONE open path — the zero-config, self-provisioning one
 * from N2.12: clicking a person always opens a conversation, silently
 * provisioning a workspace project when none exists, and surfacing a notice
 * only on a genuine server failure.
 *
 * Kept as a hook (not a component) so any surface can call it. The briefing is
 * pre-filled into the composer, never auto-sent: the human edits and sends, so
 * a worker is never handed an instruction its manager did not read.
 */
import { useAtomValue } from "@effect/atom-react";
import type { ScopedProjectRef } from "@t3tools/contracts";
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
import { buildBriefing } from "./briefing";
import { createEnsureWorkspaceProject, type EnsureCreateInput } from "./ensureWorkspaceProject";
import type { PanelOpenOutcome } from "./panelOutcome";
import type { EmployeeSummary } from "./summarize";
import {
  recordEmployeeConversation,
  type EmployeeIdentity,
} from "../melani/employeeConversationLink";

/**
 * A stable ensure-workspace-project function that self-provisions once and
 * reuses thereafter. Returns a resolver that yields the project ref to open a
 * thread in: the existing default when there is one, otherwise a freshly (or
 * previously) provisioned workspace. `null` only when provisioning genuinely
 * failed (server unreachable).
 */
function useEnsureProjectRef() {
  const { defaultProjectRef } = useHandleNewThread();
  const projects = useProjects();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const providers = useAtomValue(primaryServerProvidersAtom);
  const createProject = useAtomCommand(projectEnvironment.create, { reportFailure: false });

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

/**
 * Returns `openBriefing(briefing)`: opens (or self-provisions then opens) a
 * conversation, pre-filling the composer with an arbitrary briefing string.
 * The primitive under `useEmployeeConversation`, exposed so the Queue's
 * per-item actions share the exact same zero-config open path.
 */
export function useOpenBriefingConversation(): (
  briefing: string,
  identity?: EmployeeIdentity,
) => Promise<PanelOpenOutcome> {
  const { handleNewThread } = useHandleNewThread();
  const setPrompt = useComposerDraftStore((store) => store.setPrompt);
  const ensureProjectRef = useEnsureProjectRef();

  return useCallback(
    async (briefing: string, identity?: EmployeeIdentity): Promise<PanelOpenOutcome> => {
      const projectRef = await ensureProjectRef();
      if (!projectRef) return { reason: "Could not reach the server. Try again in a moment." };
      const opened = await handleNewThread(projectRef);
      if (!opened?.draftId) return { reason: "Could not open a conversation." };
      setPrompt(opened.draftId, briefing);
      // The one place both the employee's identity and the conversation's ids
      // are in hand: record the join so the stage can render a person-shaped
      // header + empty state (UI-SPEC §6 N3.1) instead of project/git chrome.
      if (identity) {
        recordEmployeeConversation(
          { draftId: opened.draftId, threadId: opened.threadId },
          identity,
        );
      }
      return null;
    },
    [ensureProjectRef, handleNewThread, setPrompt],
  );
}

/**
 * Returns `openConversation(summary)`: opens (or self-provisions then opens) a
 * conversation with the employee, pre-filling its briefing. Resolves to `null`
 * on success, or a `PanelOpenOutcome` describing the genuine failure.
 */
export function useEmployeeConversation(): (summary: EmployeeSummary) => Promise<PanelOpenOutcome> {
  const openBriefing = useOpenBriefingConversation();
  return useCallback(
    (summary: EmployeeSummary) =>
      openBriefing(buildBriefing(summary), {
        id: summary.employee.id,
        name: summary.employee.name,
        role: summary.employee.role,
      }),
    [openBriefing],
  );
}
