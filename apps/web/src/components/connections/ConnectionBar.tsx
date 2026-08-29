/**
 * Connection status bar.
 *
 * Only appears when it has something to say. A healthy connection is silent;
 * a broken one is loud and offers a one-click fix. The user never sees the
 * word "token" or a file path.
 */
import { useConnections } from "./useConnections";

const DOT_COLOR: Record<string, string> = {
  connected: "var(--sand-green)",
  "needs-reconnect": "var(--sand-red)",
  "not-set-up": "var(--sand-text-quaternary)",
  reconnecting: "var(--sand-yellow)",
};

export function ConnectionBar() {
  const { gmail } = useConnections();

  // Silence is the correct state for a healthy connection. Showing a green
  // "everything is fine" row forever is noise the user learns to ignore.
  if (!gmail || gmail.status === "connected") return null;

  const actionLabel = gmail.status === "not-set-up" ? "Connect" : "Reconnect";

  return (
    <div className="conn-bar sand-rise" data-testid="connection-bar">
      <span className="conn-bar__dot" style={{ "--conn-dot": DOT_COLOR[gmail.status] } as never} />
      <span className="conn-bar__text">
        {gmail.label} · {gmail.detail}
      </span>
      {gmail.status === "reconnecting" ? null : (
        <button type="button" className="conn-bar__action">
          {actionLabel}
        </button>
      )}
    </div>
  );
}
