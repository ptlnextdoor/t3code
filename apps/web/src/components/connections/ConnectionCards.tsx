/**
 * Connection cards — the surface where the user connects accounts.
 *
 * The spec is one sentence: a button that connects an account, no consoles, no
 * tokens. Each connection is one grouped-card row: a status dot, the label, a
 * one-line human detail, and exactly one control — Connect when nothing is set
 * up, Reconnect when the grant lapsed, and a quiet "Connected" state otherwise.
 * The word "token" never appears. Clicking Connect opens Google in the user's
 * browser; connecting Calendar on an account that already has Gmail is an
 * incremental grant, so Gmail stays connected throughout.
 */
import { useState } from "react";

import { useConnections, type ConnectionHealth } from "./useConnections";

const DOT_COLOR: Record<string, string> = {
  connected: "var(--sand-green)",
  "needs-reconnect": "var(--sand-red)",
  "not-set-up": "var(--sand-text-quaternary)",
  reconnecting: "var(--sand-yellow)",
};

function ConnectionCardRow({
  conn,
  connecting,
  onConnect,
}: {
  conn: ConnectionHealth;
  connecting: boolean;
  onConnect: () => void;
}) {
  const actionLabel = conn.status === "not-set-up" ? "Connect" : "Reconnect";
  const showAction = conn.status === "not-set-up" || conn.status === "needs-reconnect";

  return (
    <div className="conn-card__row" data-testid={`connection-card-${conn.id}`}>
      <span className="conn-card__dot" style={{ "--conn-dot": DOT_COLOR[conn.status] } as never} />
      <div className="conn-card__body">
        <div className="conn-card__label">{conn.label}</div>
        <div className="conn-card__detail">{conn.detail}</div>
      </div>
      {conn.status === "connected" ? (
        <span className="conn-card__connected">Connected</span>
      ) : conn.status === "reconnecting" ? (
        <span className="conn-card__connected">Reconnecting…</span>
      ) : showAction ? (
        <button
          type="button"
          className="conn-card__action"
          disabled={connecting}
          onClick={onConnect}
          data-testid={`connection-connect-${conn.id}`}
        >
          {connecting ? "Opening…" : actionLabel}
        </button>
      ) : null}
    </div>
  );
}

export function ConnectionCards() {
  const { connections, connect, connecting } = useConnections();
  const [notice, setNotice] = useState<string | null>(null);

  if (connections.length === 0) return null;

  const onConnect = (id: string) => {
    setNotice(null);
    void connect(id).then((result) => {
      if (!result.ok) setNotice(result.detail);
    });
  };

  return (
    <div className="conn-card sand-rise" data-testid="connection-cards">
      <div className="conn-card__head">Connections</div>
      <div className="conn-card__rows">
        {connections.map((conn) => (
          <ConnectionCardRow
            key={conn.id}
            conn={conn}
            connecting={connecting === conn.id}
            onConnect={() => onConnect(conn.id)}
          />
        ))}
      </div>
      {notice ? <div className="conn-card__notice">{notice}</div> : null}
    </div>
  );
}
