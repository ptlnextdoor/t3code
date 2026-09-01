/**
 * MelaniChatHeader — the person-shaped stage header. UI-SPEC §2.5, §6 N3.1.
 *
 * The reference `chat-header.tsx` is: [persona avatar] Name, with a small
 * "Working" badge while the agent runs, and clicking the identity opens the
 * agent's details. NO project breadcrumb, NO git buttons, NO "Add action" —
 * a chief of staff never says "Initialize Git".
 *
 * This replaces t3code's `ChatHeader` (project favicon + breadcrumb + git +
 * scripts + open-in) ONLY when the conversation is rendered inside the Melani
 * shell. Deferred to later nodes: the identity click opening a real details
 * pane (N3.6) and the persona's live animation states (N3.2). Here the avatar
 * is the static-but-alive N3.1 stand-in, and the working badge is driven by
 * the same turn signal the composer already computes.
 */
import { MelaniAvatar } from "./MelaniAvatar";
import type { EmployeeIdentity } from "./employeeConversationLink";

export function MelaniChatHeader({
  employee,
  isWorking,
}: {
  readonly employee: EmployeeIdentity;
  readonly isWorking: boolean;
}) {
  return (
    <div
      className="melani-chat-header"
      data-testid="melani-chat-header"
      role="group"
      aria-label={`Conversation with ${employee.name}`}
    >
      <MelaniAvatar
        id={employee.id}
        name={employee.name}
        size="md"
        status={isWorking ? "working" : "calm"}
      />
      <div className="melani-chat-header__identity">
        <span className="melani-chat-header__name" data-testid="melani-chat-header-name">
          {employee.name}
        </span>
        <span className="melani-chat-header__role" data-testid="melani-chat-header-role">
          {employee.role}
        </span>
      </div>
      {isWorking ? (
        <span className="melani-chat-header__badge" data-testid="melani-chat-header-working">
          Working
        </span>
      ) : null}
    </div>
  );
}
