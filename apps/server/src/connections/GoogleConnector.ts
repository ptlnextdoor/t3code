// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalFetch:off
/**
 * Google connector: keeps the Gmail connection alive without the user ever
 * learning that access tokens exist.
 *
 * The defect this fixes is a product defect, not an auth bug. The underlying
 * refresh works fine; it simply only ran while a jcode session was open, so a
 * 12-hour gap silently expired the connection and the user's only recovery was
 * to know about a JSON file. For anything sold to people, that is a churn
 * event: a dead button with no explanation.
 *
 * Rules encoded here:
 *  - Refresh PROACTIVELY at 80% of token life, never lazily after expiry.
 *  - Never surface the words "token", "OAuth", or a file path. The only
 *    vocabulary is connected / reconnecting / needs-reconnect.
 *  - A failed refresh degrades to a visible, actionable state rather than
 *    throwing at the call site.
 */
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

/*
 * Overridable for remote execution: on a VPS the credential lives wherever the
 * operator mounts it (a secret file, a bind mount), not under a Mac homedir.
 */
const CREDENTIALS_PATH =
  process.env.T3CODE_GOOGLE_CREDENTIALS ??
  NodePath.join(NodeOS.homedir(), ".jcode/google_credentials.json");
const TOKEN_PATH =
  process.env.T3CODE_GOOGLE_TOKEN ?? NodePath.join(NodeOS.homedir(), ".jcode/google_oauth.json");
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

/** Refresh once this fraction of the token's lifetime has elapsed. */
const REFRESH_AT_LIFETIME_FRACTION = 0.8;
/** Assume a standard Google access-token lifetime when none is recorded. */
const ASSUMED_LIFETIME_MS = 3600_000;

/**
 * What the user is allowed to see. Deliberately free of protocol vocabulary:
 * these map to "Connected", "Reconnecting", and a "Reconnect" button.
 */
export type ConnectionStatus = "connected" | "reconnecting" | "needs-reconnect" | "not-set-up";

/**
 * The connections this instance can surface. Both ride the SAME Google account
 * and the SAME stored credential: adding Calendar is one extra scope on the
 * existing grant, never a second login for the same person.
 */
export type ConnectionId = "gmail" | "calendar";

export interface ConnectionHealth {
  readonly id: ConnectionId;
  readonly label: string;
  readonly status: ConnectionStatus;
  /** Account the connection belongs to, shown as reassurance. */
  readonly account: string | null;
  /** Human sentence for the UI. Never mentions tokens. */
  readonly detail: string;
  /** Capabilities the user actually cares about. */
  readonly canSend: boolean;
}

/** OAuth scopes, kept in one place so the login flow and health checks agree. */
export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
/** Read-only is enough for deadlines; write comes later behind approval gates. */
export const CALENDAR_READONLY_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
/** openid + email let the flow capture the account address for reassurance. */
export const IDENTITY_SCOPES = ["openid", "email"] as const;

interface StoredToken {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  email?: string;
  scope?: string;
  [key: string]: unknown;
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(NodeFS.readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

/** True when the stored credential is close enough to expiry to renew now. */
export function shouldRefresh(expiresAt: number | undefined, now: number): boolean {
  if (!expiresAt) return true;
  const remaining = expiresAt - now;
  if (remaining <= 0) return true;
  // Renew once 80% of the assumed lifetime has burned down.
  return remaining < ASSUMED_LIFETIME_MS * (1 - REFRESH_AT_LIFETIME_FRACTION);
}

/** Exchange the long-lived grant for a fresh access credential. */
async function renew(stored: StoredToken): Promise<StoredToken | null> {
  const creds = readJson<{ client_id: string; client_secret: string }>(CREDENTIALS_PATH);
  if (!creds || !stored.refresh_token) return null;

  const body = new URLSearchParams({
    client_id: creds.client_id,
    client_secret: creds.client_secret,
    grant_type: "refresh_token",
    refresh_token: stored.refresh_token,
  });

  try {
    const response = await fetch(TOKEN_ENDPOINT, {
      body,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      method: "POST",
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { access_token: string; expires_in: number };
    const next: StoredToken = {
      ...stored,
      access_token: payload.access_token,
      expires_at: Date.now() + payload.expires_in * 1000,
    };
    // Write atomically-ish: the file is small and read-mostly.
    NodeFS.writeFileSync(TOKEN_PATH, JSON.stringify(next, null, 2));
    return next;
  } catch {
    return null;
  }
}

/**
 * Return a usable access credential, renewing first when it is close to
 * expiring. Returns null when the user genuinely has to reconnect.
 */
export async function getAccessToken(): Promise<string | null> {
  const stored = readJson<StoredToken>(TOKEN_PATH);
  if (!stored?.refresh_token) return null;
  if (!shouldRefresh(stored.expires_at, Date.now())) return stored.access_token;
  const renewed = await renew(stored);
  return renewed?.access_token ?? null;
}

/** Whether the granted scopes actually allow sending mail on the user's behalf. */
function grantsSend(scope: string | undefined): boolean {
  return typeof scope === "string" ? scope.includes("gmail.send") : true;
}

/** Whether the stored grant includes read access to the calendar. */
export function grantsCalendar(scope: string | undefined): boolean {
  return typeof scope === "string" ? scope.includes("calendar.readonly") : false;
}

/**
 * Describe the connection in the user's language. This never throws, because a
 * status surface that can fail is worse than useless.
 */
export async function gmailHealth(): Promise<ConnectionHealth> {
  const stored = readJson<StoredToken>(TOKEN_PATH);
  const base = { id: "gmail", label: "Gmail" } as const;

  if (!stored?.refresh_token) {
    return {
      ...base,
      account: null,
      canSend: false,
      detail: "Not connected yet.",
      status: "not-set-up",
    };
  }

  const account = stored.email ?? null;
  const token = await getAccessToken();
  if (!token) {
    return {
      ...base,
      account,
      canSend: false,
      detail: "Sign in again to keep sending mail.",
      status: "needs-reconnect",
    };
  }

  return {
    ...base,
    account,
    canSend: grantsSend(stored.scope),
    detail: account ? `Connected as ${account}.` : "Connected.",
    status: "connected",
  };
}

/**
 * Describe the Calendar connection in the user's language.
 *
 * Calendar shares Gmail's stored credential, so its states are subtler than a
 * separate login. A grant that has a refresh token but no calendar scope is a
 * real, common state: the user connected Gmail before Calendar existed. That
 * reads as "not-set-up" so the card shows a Connect button, and clicking it
 * runs an INCREMENTAL grant (include_granted_scopes) that leaves Gmail intact.
 */
export async function calendarHealth(): Promise<ConnectionHealth> {
  const stored = readJson<StoredToken>(TOKEN_PATH);
  const base = { id: "calendar", label: "Calendar" } as const;

  // No grant at all, or a grant that never included calendar: offer Connect.
  if (!stored?.refresh_token || !grantsCalendar(stored.scope)) {
    return {
      ...base,
      account: null,
      canSend: false,
      detail: "Not connected yet.",
      status: "not-set-up",
    };
  }

  const account = stored.email ?? null;
  const token = await getAccessToken();
  if (!token) {
    return {
      ...base,
      account,
      canSend: false,
      detail: "Sign in again to keep reading your calendar.",
      status: "needs-reconnect",
    };
  }

  return {
    ...base,
    account,
    canSend: false,
    detail: account ? `Connected as ${account}.` : "Connected.",
    status: "connected",
  };
}
