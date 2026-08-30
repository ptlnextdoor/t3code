/** Type declarations for the runnable .mjs sync script (see sync-knowledge.mjs). */
export const ARTIFACTS: string[];
export interface SyncSource {
  readonly name: string;
  readonly path: string;
}
export function buildSources(
  artifacts: string[],
  localDir: string,
  exists?: (path: string) => boolean,
): { present: SyncSource[]; missing: SyncSource[] };
export function isUnreachable(code: number | null): boolean;
