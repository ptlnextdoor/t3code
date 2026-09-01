/**
 * A tiny bus for the employee-offline notice (N3.9).
 *
 * When a click opens a conversation for an employee bound to a REMOTE host that
 * is not connected, the open path returns an `offline` outcome instead of a
 * thread. That has to become something the owner SEES in the stage — a sand
 * notice naming the environment with a reconnect action — rather than a click
 * that quietly does nothing.
 *
 * The sidebar row (where the click originates) and the stage overlay (where the
 * notice lives) are far apart in the tree and must not share React state, so
 * this bus carries the request across, mirroring commandPaletteBus. The overlay
 * host owns rendering; the sidebar just publishes.
 */
const EMPLOYEE_OFFLINE_EVENT = "t3code:melani-employee-offline";

export interface EmployeeOfflineDetail {
  /** Environment id of the disconnected remote host. */
  readonly environmentId: string;
  /** Human label to name it in the notice ("Melani's server"). */
  readonly environmentLabel: string;
  /** Employee whose conversation could not open, for the notice copy. */
  readonly employeeName: string;
}

/** Publish an offline notice for the stage overlay to render. */
export function showEmployeeOffline(detail: EmployeeOfflineDetail): void {
  window.dispatchEvent(new CustomEvent(EMPLOYEE_OFFLINE_EVENT, { detail }));
}

/** Subscribe to offline-notice requests. Returns an unsubscribe fn. */
export function onEmployeeOffline(listener: (detail: EmployeeOfflineDetail) => void): () => void {
  const handler = (event: Event) => {
    listener((event as CustomEvent<EmployeeOfflineDetail>).detail);
  };
  window.addEventListener(EMPLOYEE_OFFLINE_EVENT, handler);
  return () => window.removeEventListener(EMPLOYEE_OFFLINE_EVENT, handler);
}
