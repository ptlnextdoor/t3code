// @effect-diagnostics globalDate:off
/**
 * Zero-config self-provisioning (N2.12).
 *
 * The employee layer must never ask the user to "add a project first". When
 * there is no project, the connected opener silently ensures a neutral
 * workspace project exists, then opens the thread. This proves the three
 * invariants that make that safe:
 *
 *   1. absent  -> creates exactly one workspace project, returns its ref.
 *   2. present -> reuses the existing workspace (matched by name, so it
 *      survives a projection re-hydrate that changes ids), no second create.
 *   3. concurrent clicks -> a single create, one ref, no duplicate projects
 *      from a double-click.
 */
import { assert, describe, it } from "@effect/vitest";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";

import {
  createEnsureWorkspaceProject,
  findWorkspaceProject,
  WORKSPACE_PROJECT_ROOT,
  WORKSPACE_PROJECT_TITLE,
  type EnsureCreateInput,
  type WorkspaceProjectCandidate,
} from "./ensureWorkspaceProject";

const ENV = "env-primary" as EnvironmentId;

const project = (id: string, title: string): WorkspaceProjectCandidate => ({
  environmentId: ENV,
  id: id as ProjectId,
  title,
});

/** A controllable fake create that records calls and can defer resolution. */
function makeFakeCreate() {
  const calls: EnsureCreateInput[] = [];
  let resolveNext: ((ok: boolean) => void) | null = null;
  const create = (input: EnsureCreateInput): Promise<boolean> => {
    calls.push(input);
    return new Promise<boolean>((resolve) => {
      resolveNext = resolve;
    });
  };
  return {
    calls,
    create,
    settle: (ok = true) => {
      resolveNext?.(ok);
      resolveNext = null;
    },
  };
}

let idCounter = 0;
const nextId = () => `proj-${++idCounter}` as ProjectId;

describe("findWorkspaceProject", () => {
  it("matches by the neutral workspace title within the environment", () => {
    const ref = findWorkspaceProject(
      [project("a", "Some Repo"), project("b", WORKSPACE_PROJECT_TITLE)],
      ENV,
    );
    assert.deepEqual(ref, { environmentId: ENV, projectId: "b" as ProjectId });
  });

  it("returns null when no workspace project exists", () => {
    assert.equal(findWorkspaceProject([project("a", "Some Repo")], ENV), null);
  });

  it("ignores a same-named project in a different environment", () => {
    const other = {
      environmentId: "env-other" as EnvironmentId,
      id: "z" as ProjectId,
      title: WORKSPACE_PROJECT_TITLE,
    };
    assert.equal(findWorkspaceProject([other], ENV), null);
  });
});

describe("createEnsureWorkspaceProject", () => {
  it("absent -> creates exactly one workspace project with a home root", async () => {
    idCounter = 0;
    const fake = makeFakeCreate();
    const ensure = createEnsureWorkspaceProject({
      environmentId: ENV,
      listProjects: () => [],
      newProjectId: nextId,
      createProject: fake.create,
    });

    const pending = ensure();
    fake.settle(true);
    const ref = await pending;

    assert.equal(fake.calls.length, 1);
    assert.equal(fake.calls[0]!.title, WORKSPACE_PROJECT_TITLE);
    assert.equal(fake.calls[0]!.workspaceRoot, WORKSPACE_PROJECT_ROOT);
    assert.deepEqual(ref, { environmentId: ENV, projectId: "proj-1" as ProjectId });
  });

  it("present -> reuses the existing workspace, never creating a second", async () => {
    const fake = makeFakeCreate();
    const ensure = createEnsureWorkspaceProject({
      environmentId: ENV,
      listProjects: () => [project("existing", WORKSPACE_PROJECT_TITLE)],
      newProjectId: nextId,
      createProject: fake.create,
    });

    const ref = await ensure();

    assert.equal(fake.calls.length, 0);
    assert.deepEqual(ref, { environmentId: ENV, projectId: "existing" as ProjectId });
  });

  it("reuses its own creation after the fact even before the list re-hydrates", async () => {
    idCounter = 100;
    const fake = makeFakeCreate();
    // The list stays empty the whole time: the projection lags the create. The
    // ensure must still answer with the same ref on a later call, or a second
    // click would create a duplicate.
    const ensure = createEnsureWorkspaceProject({
      environmentId: ENV,
      listProjects: () => [],
      newProjectId: nextId,
      createProject: fake.create,
    });

    const first = ensure();
    fake.settle(true);
    const firstRef = await first;
    const secondRef = await ensure();

    assert.equal(fake.calls.length, 1);
    assert.deepEqual(secondRef, firstRef);
  });

  it("concurrent clicks -> a single create and one shared ref", async () => {
    idCounter = 200;
    const fake = makeFakeCreate();
    const ensure = createEnsureWorkspaceProject({
      environmentId: ENV,
      listProjects: () => [],
      newProjectId: nextId,
      createProject: fake.create,
    });

    // Two clicks in the same tick, before the first create resolves.
    const a = ensure();
    const b = ensure();
    fake.settle(true);
    const [refA, refB] = await Promise.all([a, b]);

    assert.equal(fake.calls.length, 1);
    assert.deepEqual(refA, refB);
  });

  it("failed create -> returns null and stays retryable", async () => {
    idCounter = 300;
    const fake = makeFakeCreate();
    const ensure = createEnsureWorkspaceProject({
      environmentId: ENV,
      listProjects: () => [],
      newProjectId: nextId,
      createProject: fake.create,
    });

    const first = ensure();
    fake.settle(false);
    const failed = await first;
    assert.equal(failed, null);

    // A later click retries rather than caching the failure.
    const second = ensure();
    fake.settle(true);
    const ref = await second;
    assert.equal(fake.calls.length, 2);
    assert.notEqual(ref, null);
  });
});
