/**
 * Providers section of the Melani settings overlay (N3.11).
 *
 * The core ask: the owner opens settings and sees, per MACHINE (this Mac plus
 * every remote environment they've added), one card per provider CLI — Claude,
 * Grok, Codex, and any other driver the server knows — showing LIVE status from
 * the server's own provider probes: connected (with the plan / account label),
 * not connected, or not installed. For a not-connected provider the card shows
 * the exact one-liner to run on that machine to connect the subscription
 * (`grok login --device-auth`, `claude login`, …) with a copy button, and a
 * Refresh that re-probes so the status flips to connected the moment they've
 * signed in. Tokens are NEVER shown — only the auth label the probe reports.
 *
 * Connect gap: the server exposes provider STATUS + REFRESH but no RPC to run
 * a login flow, so [Connect] is the copy-the-command-then-Refresh path. If a
 * server later gains a device-auth exec RPC, only this file changes.
 */
import { useAtomValue } from "@effect/atom-react";
import { CheckIcon, CopyIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import type { EnvironmentId, ProviderDriverKind } from "@t3tools/contracts";

import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { useEnvironments } from "../../state/environments";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { PROVIDER_CLIENT_DEFINITIONS } from "../settings/providerDriverMeta";
import { deriveProviderCardState, type ProviderCardState } from "./settingsOverlay";

/** One provider card: icon + name, live status, and (for needs-login) the command. */
function ProviderCard({
  driver,
  label,
  card,
}: {
  readonly driver: ProviderDriverKind;
  readonly label: string;
  readonly card: ProviderCardState;
}) {
  const { copyToClipboard, isCopied } = useCopyToClipboard({ target: `${label} login command` });
  return (
    <div
      className="melani-provider-card"
      data-status={card.status}
      data-testid="melani-provider-card"
      data-driver={driver}
    >
      <span className="melani-provider-card__icon" aria-hidden="true">
        <ProviderInstanceIcon driverKind={driver} displayName={label} showBadge={false} />
      </span>
      <span className="melani-provider-card__body">
        <span className="melani-provider-card__name">{label}</span>
        <span className="melani-provider-card__status" data-testid="melani-provider-status">
          <span className="melani-provider-card__dot" data-tone={card.tone} aria-hidden="true" />
          {card.headline}
        </span>
        {card.detail ? <span className="melani-provider-card__detail">{card.detail}</span> : null}
        {card.loginCommand ? (
          <span className="melani-provider-card__command">
            <code data-testid="melani-provider-command">{card.loginCommand}</code>
            <button
              type="button"
              className="melani-provider-card__copy"
              data-testid="melani-provider-copy"
              aria-label={`Copy: ${card.loginCommand}`}
              onClick={() => copyToClipboard(card.loginCommand ?? "", undefined)}
            >
              {isCopied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
              {isCopied ? "Copied" : "Copy"}
            </button>
          </span>
        ) : null}
      </span>
    </div>
  );
}

/** One machine block: its provider cards + a Refresh that re-probes live. */
function MachineProviders({
  environmentId,
  label,
}: {
  readonly environmentId: EnvironmentId;
  readonly label: string;
}) {
  const providers =
    useAtomValue(serverEnvironment.providersValueAtom(environmentId)) ?? EMPTY_SERVER_PROVIDERS;
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const [refreshing, setRefreshing] = useState(false);
  const refreshingRef = useRef(false);

  const onRefresh = useCallback(() => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    void (async () => {
      await refreshProviders({ environmentId, input: {} });
      refreshingRef.current = false;
      setRefreshing(false);
    })();
  }, [environmentId, refreshProviders]);

  return (
    <div className="melani-provider-machine" data-testid="melani-provider-machine">
      <div className="melani-provider-machine__head">
        <span className="melani-provider-machine__label">{label}</span>
        <button
          type="button"
          className="melani-provider-machine__refresh"
          data-testid="melani-provider-refresh"
          aria-label={`Refresh provider status on ${label}`}
          data-refreshing={refreshing ? "" : undefined}
          onClick={onRefresh}
        >
          <RefreshCwIcon className="size-3.5" />
          {refreshing ? "Checking…" : "Refresh"}
        </button>
      </div>
      <div className="melani-provider-cards">
        {PROVIDER_CLIENT_DEFINITIONS.map((definition) => {
          const snapshot = providers.find((provider) => provider.driver === definition.value);
          const card = deriveProviderCardState(definition.value, snapshot);
          return (
            <ProviderCard
              key={definition.value}
              driver={definition.value}
              label={definition.label}
              card={card}
            />
          );
        })}
      </div>
    </div>
  );
}

/**
 * The Providers section body: every known machine, each with its provider
 * cards. The primary (This Mac) environment sorts first; remote machines
 * follow in their catalog order.
 */
export function MelaniProvidersSection() {
  const { environments } = useEnvironments();
  const ordered = [...environments].sort((a, b) => {
    const aPrimary = a.entry.target._tag === "PrimaryConnectionTarget" ? 0 : 1;
    const bPrimary = b.entry.target._tag === "PrimaryConnectionTarget" ? 0 : 1;
    return aPrimary - bPrimary;
  });

  return (
    <div className="melani-settings-body" data-testid="melani-providers-section">
      <p className="melani-settings-lead">
        Connect each AI subscription on every machine. Status is live — sign in on the machine, then
        Refresh.
      </p>
      {ordered.length === 0 ? (
        <div className="melani-settings-empty">No machines yet. Add one under Machines.</div>
      ) : (
        ordered.map((environment) => (
          <MachineProviders
            key={environment.environmentId}
            environmentId={environment.environmentId}
            label={environment.label}
          />
        ))
      )}
    </div>
  );
}
