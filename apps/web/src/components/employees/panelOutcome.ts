/**
 * The result of trying to open a conversation from a panel row.
 *
 * `null` means it opened. Otherwise the outcome describes a real failure the
 * caller renders on screen. The employee layer self-provisions its workspace,
 * so "no project yet" is no longer a blocker a user can see — the reasons that
 * reach here are REAL failures:
 *
 *   - a plain `{ reason }` — server unreachable, or a matched Gmail draft is
 *     missing. No recovery action, because there is no infrastructure step to
 *     hand back to the user.
 *   - an `offline` outcome — the employee is bound to a REMOTE host (N3.9) that
 *     the client is not currently connected to. Unlike the plain failure this
 *     one IS recoverable: the stage shows a sand notice naming the environment
 *     and offers a retry, so a Hetzner box that is merely asleep reconnects
 *     rather than reading as a dead end.
 */
export type PanelOpenOutcome = {
  readonly reason: string;
  /** Present only when the failure is a disconnected remote host. */
  readonly offline?: {
    readonly environmentId: string;
    readonly environmentLabel: string;
  };
} | null;
