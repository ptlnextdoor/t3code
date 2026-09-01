/**
 * MelaniEmployeeOfflineNotice — the stage overlay that catches a click on a
 * REMOTE-hosted employee whose server is not connected (N3.9).
 *
 * Rather than a click that quietly does nothing, the owner sees a sand notice
 * naming the environment ("Melani's server is offline") with a Reconnect
 * action that re-triggers the connection. It lives in the stage (mounted by
 * MelaniShell) so it never touches the ChatHeader/DraftHero area. It dismisses
 * itself the moment the named environment reports connected, so a successful
 * reconnect clears the notice without the user closing it — then the owner can
 * click the employee again to open the conversation on the now-live host.
 *
 * One-signal rule: only ever one notice at a time (the latest request wins),
 * and it is a passive banner, not a modal, so it never blocks the stage.
 */
import { useCallback, useEffect, useState } from "react";

import { environmentCatalog } from "../../connection/catalog";
import { useEnvironments } from "../../state/environments";
import { useAtomCommand } from "../../state/use-atom-command";
import type { EnvironmentId } from "@t3tools/contracts";
import { onEmployeeOffline, type EmployeeOfflineDetail } from "./employeeOfflineBus";

export function MelaniEmployeeOfflineNotice() {
  const [notice, setNotice] = useState<EmployeeOfflineDetail | null>(null);
  const { environments } = useEnvironments();
  const retryNow = useAtomCommand(environmentCatalog.retryNow, { reportFailure: false });

  useEffect(() => onEmployeeOffline((detail) => setNotice(detail)), []);

  // Auto-dismiss once the named host comes online: the reconnect worked, so the
  // notice has done its job and lingering would be stale state.
  useEffect(() => {
    if (!notice) return;
    const match = environments.find(
      (environment) => environment.environmentId === notice.environmentId,
    );
    if (match && match.connection.phase === "connected") setNotice(null);
  }, [environments, notice]);

  const onReconnect = useCallback(() => {
    if (!notice) return;
    // The unknown-host case has no reachable environment id to retry; the retry
    // is a no-op there, but the button still reads as the honest next step
    // (the user must add/connect that environment). For a known host this kicks
    // the supervisor to reconnect immediately.
    void retryNow(notice.environmentId as EnvironmentId);
  }, [notice, retryNow]);

  if (!notice) return null;

  return (
    <div className="melani-offline" role="status" data-testid="melani-offline-notice">
      <div className="melani-offline__body">
        <span className="melani-offline__glyph" aria-hidden="true">
          ⛅
        </span>
        <div className="melani-offline__text">
          <span className="melani-offline__title">{notice.environmentLabel} is offline</span>
          <span className="melani-offline__detail">
            {notice.employeeName} runs on {notice.environmentLabel}. Reconnect to open this
            conversation.
          </span>
        </div>
      </div>
      <div className="melani-offline__actions">
        <button
          type="button"
          className="melani-offline__retry"
          data-testid="melani-offline-retry"
          onClick={onReconnect}
        >
          Reconnect
        </button>
        <button
          type="button"
          className="melani-offline__dismiss"
          aria-label="Dismiss"
          onClick={() => setNotice(null)}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
