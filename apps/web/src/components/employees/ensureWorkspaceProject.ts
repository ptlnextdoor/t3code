/**
 * Zero-config self-provisioning for the employee layer.
 *
 * The employee HIDES sessions and projects — clicking a person must ALWAYS
 * open a conversation, never ask the user to do infrastructure. But a thread
 * still needs a project to live in. On a fresh install there is none, so
 * rather than surfacing "add a project first", the panel silently ensures a
 * neutral workspace project exists, then opens the thread exactly as it would
 * when a project already existed. The user never learns the word "project".
 *
 * The logic here is deliberately framework-free so it can be unit-tested: the
 * React wrapper injects the live project list, the create command, and an id
 * factory. Two invariants matter and are tested:
 *   - idempotent by name: a second call reuses the workspace project instead of
 *     minting a duplicate (survives a refresh where the projection re-hydrates).
 *   - single create under concurrency: two clicks in the same tick share one
 *     in-flight create, so a double-click never spawns two projects.
 */
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ProjectId, ScopedProjectRef } from "@t3tools/contracts";

/**
 * The neutral name a self-provisioned workspace carries. Chosen to read as a
 * place the user's life happens, not as developer machinery. It doubles as the
 * idempotency key: one "Life" project per environment.
 */
export const WORKSPACE_PROJECT_TITLE = "Life";

/**
 * Home directory. Always exists, so the create never fails on a missing path,
 * and the employee's threads get a sane default working directory without the
 * user ever picking a folder.
 */
export const WORKSPACE_PROJECT_ROOT = "~/";

/** The minimal project shape the finder needs — a subset of EnvironmentProject. */
export interface WorkspaceProjectCandidate {
  readonly environmentId: EnvironmentId;
  readonly id: ProjectId;
  readonly title: string;
}

/** The create the wrapper performs; returns whether it succeeded. */
export interface EnsureCreateInput {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly workspaceRoot: string;
}

export interface EnsureWorkspaceProjectDeps {
  readonly environmentId: EnvironmentId;
  /** Read the current project list (called fresh on every ensure). */
  readonly listProjects: () => ReadonlyArray<WorkspaceProjectCandidate>;
  /** Dispatch the create; resolve true on success, false on failure. */
  readonly createProject: (input: EnsureCreateInput) => Promise<boolean>;
  /** Mint a fresh project id. */
  readonly newProjectId: () => ProjectId;
}

/**
 * Find the self-provisioned workspace project for this environment, if any.
 * Matched by title so it survives a projection re-hydrate (the generated id is
 * not stable across a reload, the name is).
 */
export function findWorkspaceProject(
  projects: ReadonlyArray<WorkspaceProjectCandidate>,
  environmentId: EnvironmentId,
): ScopedProjectRef | null {
  const match = projects.find(
    (project) =>
      project.environmentId === environmentId && project.title === WORKSPACE_PROJECT_TITLE,
  );
  return match ? scopeProjectRef(match.environmentId, match.id) : null;
}

/**
 * Build an ensure function that returns a workspace project ref, creating one
 * exactly once if needed. The returned function is stateful (holds the in-flight
 * create and the created ref), so keep ONE instance per environment alive — the
 * React wrapper memoises it per environmentId.
 */
export function createEnsureWorkspaceProject(
  deps: EnsureWorkspaceProjectDeps,
): () => Promise<ScopedProjectRef | null> {
  // The create is async and the projection lags it. Between "create resolved"
  // and "list shows the new project" we must still answer with the same ref, or
  // a fast second click would create a duplicate. `created` is that memo;
  // `inFlight` dedupes clicks that race the very first create.
  let inFlight: Promise<ScopedProjectRef | null> | null = null;
  let created: ScopedProjectRef | null = null;

  return () => {
    const existing = findWorkspaceProject(deps.listProjects(), deps.environmentId);
    if (existing) return Promise.resolve(existing);
    if (created) return Promise.resolve(created);
    if (inFlight) return inFlight;

    inFlight = (async () => {
      const projectId = deps.newProjectId();
      const ref = scopeProjectRef(deps.environmentId, projectId);
      const ok = await deps.createProject({
        environmentId: deps.environmentId,
        projectId,
        title: WORKSPACE_PROJECT_TITLE,
        workspaceRoot: WORKSPACE_PROJECT_ROOT,
      });
      inFlight = null;
      if (!ok) return null;
      created = ref;
      return ref;
    })();
    return inFlight;
  };
}
