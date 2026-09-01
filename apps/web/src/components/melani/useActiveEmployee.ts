/**
 * Read the employee a conversation belongs to, reactively.
 *
 * Wraps the `employeeConversationLink` store in `useSyncExternalStore` so the
 * stage re-renders when a row click records a new link (e.g. the draft the
 * user is already viewing becomes an employee conversation). Returns `null`
 * when the conversation has no employee, which is every classic-surface case
 * and any thread opened outside the roster.
 */
import { useSyncExternalStore } from "react";

import {
  getEmployeeForConversation,
  subscribeEmployeeConversationLinks,
  type ConversationKeys,
  type EmployeeIdentity,
} from "./employeeConversationLink";

export function useActiveEmployee(keys: ConversationKeys): EmployeeIdentity | null {
  return useSyncExternalStore(
    subscribeEmployeeConversationLinks,
    () => getEmployeeForConversation(keys),
    () => null,
  );
}
