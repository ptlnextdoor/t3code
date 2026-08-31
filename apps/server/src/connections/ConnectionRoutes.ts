// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalTimers:off
/**
 * Connection routes and the background keeper.
 *
 * The keeper is the real fix for the silent-expiry defect: it renews on a timer
 * for as long as the server is up, so the connection does not quietly die
 * during the hours nobody is using the app.
 *
 * Routes:
 *   GET  /api/connections            health for the status surface
 *   GET  /api/connections/drafts     drafts the user can approve
 *   POST /api/connections/send       send one draft, confirmation required
 */
import * as Effect from "effect/Effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { getAccessToken, gmailHealth, calendarHealth } from "./GoogleConnector.ts";
import { beginLogin } from "./GoogleLogin.ts";
import { listDrafts, sendDraft } from "./GmailActions.ts";

/** Check often enough that a one-hour credential can never lapse unnoticed. */
const KEEPER_INTERVAL_MS = 10 * 60 * 1000;

export const connectionsRouteLayer = HttpRouter.add(
  "GET",
  "/api/connections",
  Effect.promise(async () => {
    // Both share one Google account; report them as sibling cards.
    const [gmail, calendar] = await Promise.all([gmailHealth(), calendarHealth()]);
    return HttpServerResponse.jsonUnsafe({ connections: [gmail, calendar] });
  }),
);

/**
 * Start a browser sign-in for one connection. This is the entire product spec:
 * a button that connects an account. The response resolves once the credential
 * is stored, so the client can refresh its status immediately. include_granted
 * _scopes on the authorize request keeps any existing Gmail grant intact when
 * the user connects Calendar.
 */
export const connectionConnectRouteLayer = HttpRouter.add(
  "POST",
  "/api/connections/connect",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const body = yield* Effect.orElseSucceed(request.json, () => ({}) as unknown);
    const { id } = (body ?? {}) as { id?: string };
    if (id !== "gmail" && id !== "calendar") {
      return HttpServerResponse.jsonUnsafe(
        { ok: false, detail: "Unknown connection." },
        { status: 400 },
      );
    }
    const result = yield* Effect.promise(() => beginLogin(id));
    return HttpServerResponse.jsonUnsafe(result, { status: result.ok ? 200 : 400 });
  }),
);

export const connectionDraftsRouteLayer = HttpRouter.add(
  "GET",
  "/api/connections/drafts",
  Effect.promise(async () => {
    const drafts = await listDrafts(20);
    return HttpServerResponse.jsonUnsafe({ drafts });
  }),
);

export const connectionSendRouteLayer = HttpRouter.add(
  "POST",
  "/api/connections/send",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const body = yield* Effect.orElseSucceed(request.json, () => ({}) as unknown);
    const { draftId, confirm } = (body ?? {}) as { draftId?: string; confirm?: boolean };
    if (!draftId) {
      return HttpServerResponse.jsonUnsafe(
        { detail: "No draft was specified.", ok: false },
        { status: 400 },
      );
    }
    const result = yield* Effect.promise(() => sendDraft(draftId, confirm === true));
    return HttpServerResponse.jsonUnsafe(result, { status: result.ok ? 200 : 400 });
  }),
);

/**
 * Start the background keeper. Renewal happens inside getAccessToken(), which
 * only acts when the credential is near expiry, so this is cheap to call.
 */
export function startConnectionKeeper(): () => void {
  const tick = () => {
    void getAccessToken().catch(() => {
      // Never crash the server over a connection refresh; the status surface
      // is what tells the user something needs attention.
    });
  };
  tick();
  const timer = setInterval(tick, KEEPER_INTERVAL_MS);
  // Do not hold the process open on this timer alone.
  timer.unref?.();
  return () => clearInterval(timer);
}
