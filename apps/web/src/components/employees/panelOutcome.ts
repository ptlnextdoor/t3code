/**
 * The result of trying to open a conversation from a panel row.
 *
 * `null` means it opened. Otherwise a human `reason` is shown on screen. The
 * employee layer self-provisions its workspace, so "no project yet" is no
 * longer a blocker a user can see — the only reasons that reach here are REAL
 * failures (server unreachable, or a matched Gmail draft is missing). There is
 * no recovery action, because there is no infrastructure step to hand back to
 * the user: clicking a person always tries to open a conversation.
 */
export type PanelOpenOutcome = {
  readonly reason: string;
} | null;
