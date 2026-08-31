// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalFetch:off globalTimers:off globalRandom:off
/**
 * One-button Google sign-in.
 *
 * The whole product spec for this file is a sentence: "there just needs to be a
 * button in the UI that lets me connect my account." No consoles, no tokens
 * visible, ever. So the button hits a route, the route opens the user's browser
 * on Google's consent screen, Google redirects back to a tiny loopback server
 * this module owns, and the credential lands on disk. The user sees a Google
 * page and then a "you can close this tab" page. Nothing else.
 *
 * INCREMENTAL AUTH is the load-bearing detail. Adding Calendar to an account
 * that already connected Gmail must not drop Gmail. Every authorize request
 * sets include_granted_scopes=true, so Google returns a credential carrying the
 * UNION of old and new scopes, and the merge below keeps the refresh token even
 * when Google declines to reissue one. Gmail stays connected throughout.
 *
 * Zero npm dependencies: Node's http server, URL, and the platform browser
 * opener, matching the style of the other dependency-free scripts here.
 */
import { spawn } from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeHttp from "node:http";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import {
  CALENDAR_READONLY_SCOPE,
  GMAIL_SEND_SCOPE,
  IDENTITY_SCOPES,
  type ConnectionId,
} from "./GoogleConnector.ts";

const CREDENTIALS_PATH =
  process.env.T3CODE_GOOGLE_CREDENTIALS ??
  NodePath.join(NodeOS.homedir(), ".jcode/google_credentials.json");
const TOKEN_PATH =
  process.env.T3CODE_GOOGLE_TOKEN ?? NodePath.join(NodeOS.homedir(), ".jcode/google_oauth.json");

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";

/**
 * Fixed loopback port so the redirect URI is a constant the operator registers
 * once in the Google console. Overridable for the rare port clash. The path is
 * also fixed for the same reason.
 */
const LOOPBACK_PORT = Number(process.env.T3CODE_GOOGLE_LOOPBACK_PORT ?? 4773);
const CALLBACK_PATH = "/oauth/callback";
const REDIRECT_URI = `http://127.0.0.1:${LOOPBACK_PORT}${CALLBACK_PATH}`;

/** Abandon a half-finished login rather than hold the port open forever. */
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

interface StoredToken {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  email?: string;
  scope?: string;
  [key: string]: unknown;
}

interface Credentials {
  client_id: string;
  client_secret: string;
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(NodeFS.readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

/** The scopes a given connection needs, always including whatever Gmail has. */
export function scopesFor(id: ConnectionId, existingScope: string | undefined): Array<string> {
  const scopes = new Set<string>(IDENTITY_SCOPES);
  // Preserve everything already granted so an incremental login is strictly
  // additive: connecting Calendar must never ask the user to drop Gmail.
  for (const s of (existingScope ?? "").split(/\s+/).filter(Boolean)) scopes.add(s);
  if (id === "gmail") scopes.add(GMAIL_SEND_SCOPE);
  if (id === "calendar") scopes.add(CALENDAR_READONLY_SCOPE);
  return [...scopes];
}

/** Open the user's default browser without stealing terminal focus. */
function openBrowser(url: string): void {
  const platform = process.platform;
  const [cmd, args] =
    platform === "darwin"
      ? (["open", [url]] as const)
      : platform === "win32"
        ? (["cmd", ["/c", "start", "", url]] as const)
        : (["xdg-open", [url]] as const);
  try {
    const child = spawn(cmd, [...args], { stdio: "ignore", detached: true });
    child.unref();
    child.on("error", () => {
      // A missing opener is not fatal: the authorize URL is returned to the
      // caller, which can present it as a fallback link.
    });
  } catch {
    // Same rationale as above; never throw out of a UI-triggered login.
  }
}

const COMPLETE_HTML = `<!doctype html><meta charset="utf-8"><title>Connected</title>
<body style="font:15px -apple-system,system-ui,sans-serif;background:#141414;color:#F0F0F0;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center"><div style="font-size:22px;margin-bottom:8px">You're connected</div>
<div style="color:#F0F0F099">You can close this tab and return to the app.</div></div>`;

export interface LoginResult {
  readonly ok: boolean;
  /** Human sentence, safe to show directly. Never mentions tokens. */
  readonly detail: string;
  /** The account that got connected, when known. */
  readonly account: string | null;
}

/**
 * Merge a freshly returned credential into whatever is on disk. Google omits
 * the refresh token on an incremental grant, so the old one is preserved; the
 * scope becomes the union Google reports. Written with restrictive perms since
 * it is a credential, and never logged.
 */
function persist(next: {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  email?: string;
}): StoredToken {
  const prior = readJson<StoredToken>(TOKEN_PATH);
  const scope = next.scope ?? prior?.scope;
  const email = next.email ?? prior?.email;
  const merged: StoredToken = {
    ...(prior ?? {}),
    access_token: next.access_token,
    // Keep the durable grant when Google declines to reissue one.
    refresh_token: next.refresh_token ?? prior?.refresh_token ?? "",
    expires_at: Date.now() + next.expires_in * 1000,
    // Only set these when known: exactOptionalPropertyTypes forbids an explicit
    // undefined, and a merged credential should not clobber a prior value.
    ...(scope !== undefined ? { scope } : {}),
    ...(email !== undefined ? { email } : {}),
  };
  NodeFS.writeFileSync(TOKEN_PATH, JSON.stringify(merged, null, 2), { mode: 0o600 });
  return merged;
}

async function exchangeCode(creds: Credentials, code: string): Promise<StoredToken | null> {
  try {
    const response = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: creds.client_id,
        client_secret: creds.client_secret,
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
      }),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      scope?: string;
    };
    let email: string | undefined;
    try {
      const info = await fetch(USERINFO_ENDPOINT, {
        headers: { Authorization: `Bearer ${payload.access_token}` },
      });
      if (info.ok) email = ((await info.json()) as { email?: string }).email;
    } catch {
      // Email is reassurance only; a missing one degrades the card copy, not
      // the connection.
    }
    return persist({ ...payload, ...(email !== undefined ? { email } : {}) });
  } catch {
    return null;
  }
}

/**
 * Run one browser-based sign-in for the given connection and resolve once the
 * credential is stored (or the attempt fails or times out). Only one login runs
 * at a time because they share the loopback port; a second concurrent call
 * fails fast rather than colliding.
 */
export async function beginLogin(id: ConnectionId): Promise<LoginResult> {
  const creds = readJson<Credentials>(CREDENTIALS_PATH);
  if (!creds?.client_id || !creds.client_secret) {
    return { ok: false, account: null, detail: "Sign-in is not configured on this instance." };
  }

  const prior = readJson<StoredToken>(TOKEN_PATH);
  const state = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const authorizeUrl = `${AUTH_ENDPOINT}?${new URLSearchParams({
    client_id: creds.client_id,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: scopesFor(id, prior?.scope).join(" "),
    access_type: "offline",
    include_granted_scopes: "true",
    // Force the consent screen so a new scope is actually granted, not silently
    // skipped, and so a refresh token is reliably issued.
    prompt: "consent",
    state,
  }).toString()}`;

  return await new Promise<LoginResult>((resolve) => {
    let settled = false;
    const finish = (result: LoginResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close();
      resolve(result);
    };

    const server = NodeHttp.createServer((req, res) => {
      const url = new URL(req.url ?? "/", REDIRECT_URI);
      if (url.pathname !== CALLBACK_PATH) {
        res.writeHead(404).end();
        return;
      }
      const code = url.searchParams.get("code");
      if (url.searchParams.get("state") !== state || !code) {
        res.writeHead(400, { "Content-Type": "text/plain" }).end("Invalid sign-in callback.");
        finish({ ok: false, account: null, detail: "Sign-in could not be verified." });
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(COMPLETE_HTML);
      void exchangeCode(creds, code).then((stored) => {
        finish(
          stored?.refresh_token
            ? { ok: true, account: stored.email ?? null, detail: "Connected." }
            : { ok: false, account: null, detail: "Sign-in did not complete. Try again." },
        );
      });
    });

    const timer = setTimeout(
      () => finish({ ok: false, account: null, detail: "Sign-in timed out. Try again." }),
      LOGIN_TIMEOUT_MS,
    );
    timer.unref?.();

    server.on("error", () => {
      // Most often the port is busy because another sign-in is mid-flight.
      finish({ ok: false, account: null, detail: "A sign-in is already in progress." });
    });
    server.listen(LOOPBACK_PORT, "127.0.0.1", () => {
      openBrowser(authorizeUrl);
    });
  });
}
