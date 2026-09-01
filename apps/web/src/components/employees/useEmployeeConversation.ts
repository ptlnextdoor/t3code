/**
 * The one place that knows how to open a conversation with an employee.
 *
 * Extracted verbatim from TeamPanelConnected so the Melani sidebar rows and the
 * legacy Team rail share ONE open path — the zero-config, self-provisioning one
 * from N2.12: clicking a person always opens a conversation, silently
 * provisioning a workspace project when none exists, and surfacing a notice
 * only on a genuine server failure.
 *
 * N3.9 adds HOST BINDING. An employee may carry a `host` naming a remote
 * environment (a Hetzner box, a second machine). When it does, the thread opens
 * against THAT environment instead of the primary — reusing the exact same
 * environment-scoped ensure/open path, just pointed at a different environment
 * id. If the remote host is unknown to the client or not currently connected,
 * the open resolves to an `offline` outcome so the stage can show a reconnect
 * notice instead of failing silently.
 *
 * Kept as a hook (not a component) so any surface can call it. The briefing is
 * pre-filled into the composer, never auto-sent: the human edits and sends, so
 * a worker is never handed an instruction its manager did not read.
 */
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ScopedProjectRef } from "@t3tools/contracts";
import { useCallback, useMemo, useRef } from "react";

import { useComposerDraftStore } from "../../composerDraftStore";
import { useHandleNewThread } from "../../hooks/useHandleNewThread";
import { newProjectId } from "../../lib/utils";
import { resolveDefaultProviderModelSelection } from "../../providerInstances";
import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import { useProjects } from "../../state/entities";
import { projectEnvironment } from "../../state/projects";
import { primaryServerProvidersAtom } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { buildBriefing } from "./briefing";
import { createEnsureWorkspaceProject, type EnsureCreateInput } from "./ensureWorkspaceProject";
import { resolveEmployeeHost, type EnvironmentLookupEntry } from "./hostBinding";
import type { PanelOpenOutcome } from "./panelOutcome";
import type { EmployeeSummary } from "./summarize";
import {
  recordEmployeeConversation,
  type EmployeeIdentity,
} from "../melani/employeeConversationLink";

/**
 * A stable ensure-workspace-project function per environment, self-provisioning
 * once and reusing thereafter. Returns a resolver that, given a target
 * environment id, yields the project ref to open a thread in: for the primary
 * environment it prefers the existing default; for any environment it otherwise
 * provisions (or reuses) a neutral "Life" workspace. `null` only when
 * provisioning genuinely failed (server unreachable).
 *
 * The ensure function is stateful (it memoises the created ref to dedupe a
 * double-click), so we keep exactly one instance per environment id in a ref-
 * held map rather than rebuilding it on every open.
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
  const defaultProjectRefRef = useRef(defaultProjectRef);
  defaultProjectRefRef.current = defaultProjectRef;

  // One ensure fn per environment id, built lazily and kept for the component's
  // life so its dedupe memo survives across clicks.
  const ensureByEnvRef = useRef(new Map<EnvironmentId, () => Promise<ScopedProjectRef | null>>());

  const getEnsure = useMemo(
    () => (environmentId: EnvironmentId) => {
      const existing = ensureByEnvRef.current.get(environmentId);
      if (existing) return existing;
      const ensure = createEnsureWorkspaceProject({
        environmentId,
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
              defaultModelSelection: resolveDefaultProviderModelSelection(
                providersRef.current,
                null,
              ),
            },
          });
          return result._tag === "Success";
        },
      });
      ensureByEnvRef.current.set(environmentId, ensure);
      return ensure;
    },
    [createProject],
  );

  return useCallback(
    async (environmentId: EnvironmentId): Promise<ScopedProjectRef | null> => {
      // Only the PRIMARY environment has a meaningful "default project" from the
      // new-thread machinery. A remote host must never inherit the local default,
      // so it always resolves through its own environment-scoped ensure.
      if (environmentId === primaryEnvironmentId && defaultProjectRefRef.current) {
        return defaultProjectRefRef.current;
      }
      return getEnsure(environmentId)();
    },
    [getEnsure, primaryEnvironmentId],
  );
}

/**
 * Returns `openBriefing(host, briefing)`: resolves the employee's host to a
 * target environment, then opens (or self-provisions then opens) a conversation
 * there, pre-filling the composer with an arbitrary briefing string. The
 * primitive under `useEmployeeConversation`, exposed so the Queue's per-item
 * actions share the exact same zero-config, host-aware open path.
 */
export function useOpenBriefingConversation(): (
  host: string | undefined,
  briefing: string,
  identity?: EmployeeIdentity,
) => Promise<PanelOpenOutcome> {
  const { handleNewThread } = useHandleNewThread();
  const setPrompt = useComposerDraftStore((store) => store.setPrompt);
  const ensureProjectRef = useEnsureProjectRef();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const { environments } = useEnvironments();

  // Snapshot the environment list into a lookup the callback can read without
  // re-subscribing. Recomputed only when the environments change.
  const lookup = useMemo<ReadonlyArray<EnvironmentLookupEntry>>(
    () =>
      environments.map((environment) => ({
        environmentId: environment.environmentId,
        label: environment.label,
        phase: environment.connection.phase,
      })),
    [environments],
  );
  const lookupRef = useRef(lookup);
  lookupRef.current = lookup;
  const primaryRef = useRef(primaryEnvironmentId);
  primaryRef.current = primaryEnvironmentId;

  return useCallback(
    async (
      host: string | undefined,
      briefing: string,
      identity?: EmployeeIdentity,
    ): Promise<PanelOpenOutcome> => {
      const resolution = resolveEmployeeHost({
        host,
        primaryEnvironmentId: primaryRef.current,
        environments: lookupRef.current,
      });

      if (resolution.kind === "offline") {
        // A bound remote (or unknown) host that is not connected. Recoverable:
        // the stage names the environment and offers a retry. We never touch the
        // primary here, so a laptop asleep behind Tailscale reads as "reconnect?"
        // rather than "could not reach the server".
        return {
          reason: `${resolution.environmentLabel} is offline`,
          offline: {
            environmentId: resolution.environmentId,
            environmentLabel: resolution.environmentLabel,
          },
        };
      }

      const projectRef = await ensureProjectRef(resolution.environmentId);
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
 * conversation with the employee against its bound host, pre-filling its
 * briefing. Resolves to `null` on success, or a `PanelOpenOutcome` describing
 * the genuine failure (including a recoverable offline-remote-host outcome).
 */
export function useEmployeeConversation(): (summary: EmployeeSummary) => Promise<PanelOpenOutcome> {
  const openBriefing = useOpenBriefingConversation();
  return useCallback(
    (summary: EmployeeSummary) =>
      openBriefing(summary.employee.host, buildBriefing(summary), {
        id: summary.employee.id,
        name: summary.employee.name,
        role: summary.employee.role,
      }),
    [openBriefing],
  );
}
