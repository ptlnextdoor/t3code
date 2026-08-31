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
import { TodayPanel } from "../TodayPanel";
import {
  useEmployeeConversation,
  useOpenBriefingConversation,
} from "./useEmployeeConversation";
import { TeamPanel } from "./TeamPanel";

export function TeamPanelConnected() {
  // The zero-config, self-provisioning open path now lives in one shared hook
  // (useEmployeeConversation) so the Melani sidebar and this rail can never
  // drift apart. A click always opens a conversation; the only notice it can
  // raise is a genuine server failure.
  const openConversation = useEmployeeConversation();
  return <TeamPanel onOpenEmployee={openConversation} />;
}

/**
 * Queue with its row actions wired: Review / Reply / Draft / Decide open a
 * conversation with the item's owning employee, briefed on that one item.
 * Same zero-config guarantee as the Team surface: no project yet self-provisions.
 */
export function TodayPanelConnected() {
  const openItem = useOpenBriefingConversation();
  return <TodayPanel onOpenItem={openItem} />;
}
