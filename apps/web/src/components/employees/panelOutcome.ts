/**
 * The result of trying to open a conversation from a panel row.
 *
 * `null` means it opened. Otherwise a human `reason` is shown on screen, with
 * an optional `action` the user can take to fix it right there — so a blocked
 * click is never a dead end. The one real blocker on a fresh install is "no
 * project yet"; the action then opens the add-project flow inline.
 */
export type PanelOpenOutcome = {
  readonly reason: string;
  readonly action?: { readonly label: string; readonly run: () => void };
} | null;
