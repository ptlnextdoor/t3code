/**
 * A tiny bus to open the Melani settings overlay from anywhere (N3.11).
 *
 * The gear lives in the sidebar footer, but the overlay is hosted at the shell
 * level (so it floats over the whole shell, people-list included). Those two
 * are far apart in the tree and must not share React state, so — exactly like
 * commandPaletteBus / employeeOfflineBus — the trigger publishes an event and
 * the shell-level host subscribes. Cmd+, also publishes here.
 */
const SETTINGS_OPEN_EVENT = "t3code:melani-open-settings";

export interface OpenSettingsDetail {
  /** Section to land on: "providers" | "machines" | "team" | "about". */
  readonly section?: string;
}

/** Publish an open request for the shell-level overlay host to render. */
export function openMelaniSettings(detail?: OpenSettingsDetail): void {
  window.dispatchEvent(new CustomEvent(SETTINGS_OPEN_EVENT, detail ? { detail } : undefined));
}

/** Subscribe to open requests. Returns an unsubscribe fn. */
export function onOpenMelaniSettings(listener: (detail: OpenSettingsDetail) => void): () => void {
  const handler = (event: Event) => {
    listener((event as CustomEvent<OpenSettingsDetail>).detail ?? {});
  };
  window.addEventListener(SETTINGS_OPEN_EVENT, handler);
  return () => window.removeEventListener(SETTINGS_OPEN_EVENT, handler);
}
