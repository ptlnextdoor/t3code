/**
 * Pure host-binding resolver for the employee layer (N3.9).
 *
 * An employee's optional `host` names the environment its conversations open
 * in. This turns that raw string plus the client's known environments into a
 * decision the open path can act on, WITHOUT touching React or the connection
 * runtime — so the rule is unit-tested directly:
 *
 *   - no host / "local"            -> open on the PRIMARY (This Mac) environment.
 *   - host === primary id          -> same as local (the binding is redundant).
 *   - host names a CONNECTED env   -> open on that remote environment.
 *   - host names a KNOWN but not-
 *     connected env                -> offline: the stage shows a reconnect notice.
 *   - host names an UNKNOWN env    -> offline: the client can't reach a server it
 *                                     has never heard of, so it is, from the
 *                                     user's chair, an offline remote — never a
 *                                     silent no-op.
 *
 * "Connected" is the only phase a new thread can actually be created in; every
 * other phase (available, connecting, reconnecting, offline, error) means the
 * remote is not ready, so they all route to the recoverable offline outcome.
 */
import type { EnvironmentId } from "@t3tools/contracts";

import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";

/** The minimal environment shape the resolver reads. */
export interface EnvironmentLookupEntry {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly phase: EnvironmentConnectionPhase;
}

export type HostResolution =
  | { readonly kind: "local"; readonly environmentId: EnvironmentId }
  | { readonly kind: "remote"; readonly environmentId: EnvironmentId }
  | {
      readonly kind: "offline";
      readonly environmentId: string;
      readonly environmentLabel: string;
    };

/** A host value that means "This Mac" rather than a remote environment. */
function isLocalHost(host: string | undefined): boolean {
  const trimmed = host?.trim().toLowerCase();
  return !trimmed || trimmed === "local";
}

export function resolveEmployeeHost(input: {
  readonly host: string | undefined;
  readonly primaryEnvironmentId: EnvironmentId | null;
  readonly environments: ReadonlyArray<EnvironmentLookupEntry>;
}): HostResolution {
  const { host, primaryEnvironmentId, environments } = input;

  // Local binding (or none). Falls back to primary; when there is no primary at
  // all (nothing connected yet) that is itself an offline situation, but the
  // existing self-provision path already surfaces "could not reach the server"
  // for the primary, so we keep local resolving to the primary id here and let
  // that path own the null-primary case.
  if (isLocalHost(host) || (primaryEnvironmentId && host === primaryEnvironmentId)) {
    if (primaryEnvironmentId) return { kind: "local", environmentId: primaryEnvironmentId };
    // No primary environment known yet: treat as an offline local host so the
    // caller shows a reconnect notice rather than opening into the void.
    return { kind: "offline", environmentId: "local", environmentLabel: "This Mac" };
  }

  const match = environments.find((environment) => environment.environmentId === host);
  if (!match) {
    // The roster names a host this client has never connected to. It is a remote
    // the user must reconnect, not a silent failure.
    return { kind: "offline", environmentId: host as string, environmentLabel: host as string };
  }
  if (match.phase === "connected") {
    return { kind: "remote", environmentId: match.environmentId };
  }
  return {
    kind: "offline",
    environmentId: match.environmentId,
    environmentLabel: match.label,
  };
}
