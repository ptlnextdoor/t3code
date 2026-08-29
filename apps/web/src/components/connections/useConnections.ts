/**
 * Connection state for the UI.
 *
 * The product rule this encodes: a user never learns the word "token". They
 * see Connected, Reconnecting, or a Reconnect button. Anything that cannot
 * currently work is disabled with a reason, never dead on click.
 */
import { useEffect, useState } from "react";

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
} {
  const [connections, setConnections] = useState<ReadonlyArray<ConnectionHealth>>([]);

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
  }, []);

  return { connections, gmail: connections.find((c) => c.id === "gmail") ?? null };
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
