/**
 * Shell context: the one bit the STAGE needs to know to shed its coding-app
 * chrome. UI-SPEC §1.2 (ProductionRenderer owns the shell), §6 N3.1.
 *
 * `insideMelaniShell` is true whenever the conversation stage is rendered
 * beneath the MelaniShell (the front door), false on the classic
 * AppSidebarLayout surfaces and settings. ChatView branches on it to swap the
 * project/git ChatHeader for a person-shaped one and the "build in X" empty
 * state for an employee-seeded one — WITHOUT touching those surfaces when the
 * shell is off.
 */
import { createContext, useContext } from "react";

export interface MelaniShellContextValue {
  readonly insideMelaniShell: boolean;
}

const MelaniShellContext = createContext<MelaniShellContextValue>({
  insideMelaniShell: false,
});

export const MelaniShellProvider = MelaniShellContext.Provider;

/** True only when rendered inside the Melani shell stage. */
export function useInsideMelaniShell(): boolean {
  return useContext(MelaniShellContext).insideMelaniShell;
}
