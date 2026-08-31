/**
 * Front-door flag for the Melani shell. UI-SPEC §6 N3.1: Melani is THE primary
 * surface, with the old chat UI reachable but not primary.
 *
 * Gated on a client-scoped localStorage flag (default ON) rather than a
 * server/contracts setting, so the switch is zero-payload and instance-local:
 * setting `melani.shell.enabled=false` drops back to the classic
 * AppSidebarLayout + floating Team/Queue rail with no rebuild. Settings routes
 * always use the classic layout (the settings nav lives inside it), regardless
 * of this flag.
 */
import * as Schema from "effect/Schema";

import { useLocalStorage } from "../../hooks/useLocalStorage";

const FLAG_KEY = "melani.shell.enabled";
const FlagSchema = Schema.Boolean;

export function useMelaniShellEnabled(): boolean {
  const [enabled] = useLocalStorage<boolean, boolean>(FLAG_KEY, true, FlagSchema);
  return enabled;
}
