/**
 * Pure resolver from an employee's `host` string to a display label for the
 * sidebar's remote-host indicator (N3.9).
 *
 * Returns null for the local case (no host, "local", or the primary id), so the
 * row shows NO indicator for This-Mac employees and the cloud glyph only for
 * genuinely remote ones. A remote host the client knows gets its friendly
 * environment label; a remote host it does not yet know falls back to the raw
 * id, which is still a truthful "this runs somewhere else" signal.
 */
export interface HostLabelEntry {
  readonly environmentId: string;
  readonly label: string;
}

export function buildHostLabelResolver(input: {
  readonly primaryEnvironmentId: string | null;
  readonly environments: ReadonlyArray<HostLabelEntry>;
}): (host: string | undefined) => string | null {
  const { primaryEnvironmentId, environments } = input;
  return (host: string | undefined): string | null => {
    const trimmed = host?.trim();
    if (!trimmed || trimmed.toLowerCase() === "local") return null;
    if (primaryEnvironmentId && trimmed === primaryEnvironmentId) return null;
    const match = environments.find((environment) => environment.environmentId === trimmed);
    return match ? match.label : trimmed;
  };
}
