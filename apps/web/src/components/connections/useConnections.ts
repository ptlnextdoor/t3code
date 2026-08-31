/**
 * Connection state for the UI.
 *
 * The product rule this encodes: a user never learns the word "token". They
 * see Connected, Reconnecting, or a Reconnect button. Anything that cannot
 * currently work is disabled with a reason, never dead on click.
 */
import { useCallback, useEffect, useState } from "react";

import { resolvePrimaryEnvironmentHttpUrl } from "../../environments/primary/target";

export type ConnectionStatus = "connected" | "reconnecting" | "needs-reconnect" | "not-set-up";

export interface ConnectionHealth {
  readonly id: string;
  readonly label: string;
  readonly status: ConnectionStatus;
  readonly account: string | null;
  readonly detail: string;
  readonly canSend: boolean;
}

/** Poll often enough that a lapse surfaces quickly, rarely enough to be free. */
const POLL_MS = 60_000;

export function useConnections(): {
  connections: ReadonlyArray<ConnectionHealth>;
  gmail: ConnectionHealth | null;
  calendar: ConnectionHealth | null;
  /** Kick off a browser sign-in for one connection, then refresh status. */
  connect: (id: string) => Promise<{ ok: boolean; detail: string }>;
  /** True while a sign-in for this connection is in flight. */
  connecting: string | null;
  /** Force an immediate status refetch (used right after a sign-in). */
  refresh: () => void;
} {
  const [connections, setConnections] = useState<ReadonlyArray<ConnectionHealth>>([]);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch(resolvePrimaryEnvironmentHttpUrl("/api/connections"));
        if (!response.ok) return;
        const data = (await response.json()) as { connections: ReadonlyArray<ConnectionHealth> };
        if (!cancelled) setConnections(data.connections ?? []);
      } catch {
        // A status surface that throws is worse than useless.
      }
    };
    void load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [nonce]);

  const connect = useCallback(
    async (id: string) => {
      setConnecting(id);
      try {
        const response = await fetch(resolvePrimaryEnvironmentHttpUrl("/api/connections/connect"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
        const result = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          detail?: string;
        };
        return { ok: result.ok === true, detail: result.detail ?? "Sign-in did not complete." };
      } catch {
        return { ok: false, detail: "Could not reach the sign-in service." };
      } finally {
        setConnecting(null);
        refresh();
      }
    },
    [refresh],
  );

  return {
    connections,
    gmail: connections.find((c) => c.id === "gmail") ?? null,
    calendar: connections.find((c) => c.id === "calendar") ?? null,
    connect,
    connecting,
    refresh,
  };
}

/** True when mail actions should be offered at all. */
export function canSendMail(gmail: ConnectionHealth | null): boolean {
  return gmail?.status === "connected" && gmail.canSend;
}

/**
 * Why an action is unavailable, phrased for a person. Returns null when the
 * action is available, so the caller can use it directly as a tooltip.
 */
export function unavailableReason(gmail: ConnectionHealth | null): string | null {
  if (!gmail) return "Checking your connection…";
  switch (gmail.status) {
    case "connected":
      return gmail.canSend ? null : "This account cannot send mail.";
    case "reconnecting":
      return "Reconnecting to Gmail…";
    case "needs-reconnect":
      return "Sign in again to send mail.";
    case "not-set-up":
      return "Connect Gmail to send mail.";
  }
}
