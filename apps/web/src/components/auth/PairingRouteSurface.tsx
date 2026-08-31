import type { AuthSessionState } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import React, { startTransition, useEffect, useRef, useState, useCallback } from "react";

import { APP_DISPLAY_NAME, APP_TAGLINE } from "../../branding";
import { connectPairing } from "../../connection/onboarding";
import {
  peekPairingTokenFromUrl,
  stripPairingTokenFromUrl,
  submitServerAuthCredential,
} from "../../environments/primary";
import { isLoopbackHostname } from "../../environments/primary/target";
import { readHostedPairingRequest } from "../../hostedPairing";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { useAtomCommand } from "../../state/use-atom-command";

/**
 * Same-origin loopback means the server that minted the link is this machine's
 * own server, reachable at this very origin. A one-time link opened twice (or
 * after the app consumed it) burns the token; the honest recovery is a fresh
 * link from the app that launched it, not a retry of the dead token. We show
 * that guidance rather than leaving the user on a dead-end error.
 */
function isSameOriginLoopback(): boolean {
  try {
    return isLoopbackHostname(window.location.hostname);
  } catch {
    return false;
  }
}

/** Shared card chrome for every pairing state, so a new state can't drift. */
function PairingShell({
  title,
  intro,
  children,
}: {
  title: string;
  intro: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-10 text-foreground sm:px-6">
      <div className="pointer-events-none absolute inset-0 opacity-80">
        <div className="absolute inset-x-0 top-0 h-44 bg-[radial-gradient(44rem_16rem_at_top,color-mix(in_srgb,var(--color-emerald-500)_14%,transparent),transparent)]" />
        <div className="absolute inset-y-0 left-0 w-72 bg-[radial-gradient(28rem_18rem_at_left,color-mix(in_srgb,var(--color-sky-500)_10%,transparent),transparent)]" />
        <div className="absolute inset-0 bg-[linear-gradient(145deg,color-mix(in_srgb,var(--background)_90%,var(--color-black))_0%,var(--background)_55%)]" />
      </div>

      <section className="relative w-full max-w-xl rounded-2xl border border-border/80 bg-card/90 p-6 shadow-2xl shadow-black/20 backdrop-blur-md sm:p-8">
        <p className="text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
          {APP_DISPLAY_NAME}
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{intro}</p>
        {children}
      </section>
    </div>
  );
}

export function PairingPendingSurface() {
  return (
    <div
      className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10 sm:px-6"
      style={{ background: "var(--sand-chrome)", color: "var(--sand-text-primary)" }}
    >
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute inset-x-0 top-0 h-56 bg-[radial-gradient(48rem_18rem_at_top,rgba(255,255,255,0.05),transparent)]" />
      </div>

      <section className="sand-surface sand-rise relative w-full max-w-xl p-6 sm:p-8">
        <p
          className="text-[11px] font-semibold uppercase"
          style={{ letterSpacing: "0.18em", color: "var(--sand-text-tertiary)" }}
        >
          {APP_DISPLAY_NAME}
        </p>
        <h1
          className="mt-3 text-2xl font-semibold sm:text-3xl"
          style={{ letterSpacing: "var(--sand-tracking-lg)" }}
        >
          Pairing with this environment
        </h1>
        <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--sand-text-secondary)" }}>
          Validating the pairing link and preparing your session.
        </p>
      </section>
    </div>
  );
}

export function PairingRouteSurface({
  auth,
  initialErrorMessage,
  onAuthenticated,
}: {
  auth: AuthSessionState["auth"];
  initialErrorMessage?: string;
  onAuthenticated: () => void;
}) {
  const autoPairTokenRef = useRef<string | null>(peekPairingTokenFromUrl());
  const [credential, setCredential] = useState(() => autoPairTokenRef.current ?? "");
  const [errorMessage, setErrorMessage] = useState(initialErrorMessage ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  // A link that failed is the burned-token case: the URL carried a one-time
  // token and the server rejected it. Retrying the same dead token is a dead
  // end, so we swap the error for recovery guidance instead.
  const [linkTokenFailed, setLinkTokenFailed] = useState(false);
  const autoSubmitAttemptedRef = useRef(false);

  const submitCredential = useCallback(
    async (nextCredential: string, fromLink: boolean) => {
      setIsSubmitting(true);
      setErrorMessage("");
      setLinkTokenFailed(false);

      const submitError = await submitServerAuthCredential(nextCredential).then(
        () => null,
        (error) => errorMessageFromUnknown(error),
      );

      setIsSubmitting(false);

      if (submitError) {
        if (fromLink) {
          setLinkTokenFailed(true);
        } else {
          setErrorMessage(submitError);
        }
        return;
      }

      startTransition(() => {
        onAuthenticated();
      });
    },
    [onAuthenticated],
  );

  const handleSubmit = useCallback(
    async (event?: React.SubmitEvent<HTMLFormElement>) => {
      event?.preventDefault();
      await submitCredential(credential, false);
    },
    [submitCredential, credential],
  );

  useEffect(() => {
    const token = autoPairTokenRef.current;
    if (!token || autoSubmitAttemptedRef.current) {
      return;
    }

    autoSubmitAttemptedRef.current = true;
    stripPairingTokenFromUrl();
    void submitCredential(token, true);
  }, [submitCredential]);

  // The link this browser opened carried a token the backend refused — almost
  // always a one-time link that was already used. Give a working path forward
  // rather than a dead error: on a loopback origin the launching app is right
  // here on this machine and can mint a fresh link; otherwise point back to
  // whatever issued the link.
  if (linkTokenFailed) {
    const sameOrigin = isSameOriginLoopback();
    return (
      <PairingShell
        title="This pairing link was already used"
        intro="One-time pairing links work exactly once. This one has already been spent, so it can't open a session again."
      >
        <div className="rounded-lg border border-border/70 bg-background/55 px-3 py-3 text-sm leading-relaxed text-muted-foreground">
          {sameOrigin ? (
            <>
              This server is running on this machine, so a fresh link is one command away: run{" "}
              <span className="font-mono text-foreground/80">npx t3 pair</span> (or reopen the app
              that launched this window) and open the new link. You can also paste a fresh token
              below.
            </>
          ) : (
            <>
              Get a fresh one-time link from the app that launched this one, then open it. You can
              also paste a fresh token below.
            </>
          )}
        </div>

        <form className="mt-5 space-y-4" onSubmit={(event) => void handleSubmit(event)}>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="pairing-token">
              Pairing token
            </label>
            <Input
              id="pairing-token"
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect="off"
              disabled={isSubmitting}
              nativeInput
              onChange={(event) => setCredential(event.currentTarget.value)}
              placeholder="Paste a fresh one-time token"
              spellCheck={false}
              value={credential}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button disabled={isSubmitting || credential.trim().length === 0} size="sm" type="submit">
              {isSubmitting ? "Pairing..." : "Pair with token"}
            </Button>
            <Button
              disabled={isSubmitting}
              onClick={() => window.location.reload()}
              size="sm"
              variant="outline"
            >
              Reload app
            </Button>
          </div>
        </form>
      </PairingShell>
    );
  }

  return (
    <div
      className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10 sm:px-6"
      style={{ background: "var(--sand-chrome)", color: "var(--sand-text-primary)" }}
    >
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute inset-x-0 top-0 h-56 bg-[radial-gradient(48rem_18rem_at_top,rgba(255,255,255,0.05),transparent)]" />
      </div>

      <section className="sand-surface sand-rise relative w-full max-w-xl p-6 sm:p-8">
        <p
          className="text-[11px] font-semibold uppercase"
          style={{ letterSpacing: "0.18em", color: "var(--sand-text-tertiary)" }}
        >
          {APP_DISPLAY_NAME}
        </p>
        <h1
          className="mt-3 text-2xl font-semibold sm:text-3xl"
          style={{ letterSpacing: "var(--sand-tracking-lg)" }}
        >
          {APP_TAGLINE}
        </h1>
        <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--sand-text-secondary)" }}>
          {describeAuthGate(auth.bootstrapMethods)}
        </p>

        <form className="mt-6 space-y-4" onSubmit={(event) => void handleSubmit(event)}>
          <div className="space-y-2">
            <label
              className="text-sm font-medium"
              htmlFor="pairing-token"
              style={{ color: "var(--sand-text-secondary)" }}
            >
              Pairing token
            </label>
            <Input
              id="pairing-token"
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect="off"
              disabled={isSubmitting}
              nativeInput
              onChange={(event) => setCredential(event.currentTarget.value)}
              placeholder="Paste a one-time token or pairing secret"
              spellCheck={false}
              value={credential}
            />
          </div>

          {errorMessage ? (
            <div
              className="rounded-lg px-3 py-2 text-sm"
              style={{
                border: "1px solid color-mix(in srgb, var(--sand-red) 30%, transparent)",
                background: "color-mix(in srgb, var(--sand-red) 8%, transparent)",
                color: "var(--sand-red)",
              }}
            >
              {errorMessage}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button disabled={isSubmitting} size="sm" type="submit">
              {isSubmitting ? "Pairing..." : "Continue"}
            </Button>
            <Button
              disabled={isSubmitting}
              onClick={() => window.location.reload()}
              size="sm"
              variant="outline"
            >
              Reload app
            </Button>
          </div>
        </form>

        <div
          className="mt-6 rounded-lg px-3 py-3 text-xs leading-relaxed"
          style={{
            border: "1px solid var(--sand-stroke-tertiary)",
            background: "var(--sand-fill-quinary)",
            color: "var(--sand-text-tertiary)",
          }}
        >
          {describeSupportedMethods(auth.bootstrapMethods)}
        </div>
      </section>
    </div>
  );
}

export function HostedPairingRouteSurface() {
  const connectPairingEnvironment = useAtomCommand(connectPairing, {
    reportFailure: false,
  });
  const hostedPairingRequestRef = useRef(readHostedPairingRequest());
  const [status, setStatus] = useState<"pairing" | "paired" | "error">(() =>
    hostedPairingRequestRef.current ? "pairing" : "error",
  );
  const [message, setMessage] = useState(() =>
    hostedPairingRequestRef.current
      ? "Connecting to this backend."
      : "This pairing link is missing its backend host or token.",
  );
  const [canRetry, setCanRetry] = useState(false);
  const submitAttemptedRef = useRef(false);
  const tokenSubmittedRef = useRef(false);

  const submitHostedPairingRequest = useCallback(async () => {
    const request = hostedPairingRequestRef.current;

    if (!request) {
      setStatus("error");
      setMessage("This pairing link is missing its backend host or token.");
      setCanRetry(false);
      return;
    }

    if (tokenSubmittedRef.current) {
      setStatus("error");
      setMessage("This one-time pairing token was already submitted. Request a new pairing link.");
      setCanRetry(false);
      return;
    }

    setStatus("pairing");
    setMessage("Connecting to this backend.");
    setCanRetry(false);
    tokenSubmittedRef.current = true;

    const result = await connectPairingEnvironment({
      host: request.host,
      pairingCode: request.token,
    });
    if (result._tag === "Success") {
      setStatus("paired");
      setMessage(`${request.label || "The environment"} is saved in this browser.`);
      return;
    }

    tokenSubmittedRef.current = false;
    setStatus("error");
    setCanRetry(true);
    setMessage(
      `${errorMessageFromUnknown(squashAtomCommandFailure(result))} If the backend accepted this one-time token, request a new pairing link before retrying.`,
    );
  }, [connectPairingEnvironment]);

  useEffect(() => {
    if (submitAttemptedRef.current) {
      return;
    }
    submitAttemptedRef.current = true;

    stripPairingTokenFromUrl();
    void submitHostedPairingRequest();
  }, [submitHostedPairingRequest]);

  const request = hostedPairingRequestRef.current;

  return (
    <div
      className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10 sm:px-6"
      style={{ background: "var(--sand-chrome)", color: "var(--sand-text-primary)" }}
    >
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute inset-x-0 top-0 h-56 bg-[radial-gradient(48rem_18rem_at_top,rgba(255,255,255,0.05),transparent)]" />
      </div>

      <section className="sand-surface sand-rise relative w-full max-w-xl p-6 sm:p-8">
        <p
          className="text-[11px] font-semibold uppercase"
          style={{ letterSpacing: "0.18em", color: "var(--sand-text-tertiary)" }}
        >
          {APP_DISPLAY_NAME}
        </p>
        <h1
          className="mt-3 text-2xl font-semibold sm:text-3xl"
          style={{ letterSpacing: "var(--sand-tracking-lg)" }}
        >
          {status === "paired"
            ? "Backend paired"
            : status === "error"
              ? "Pairing failed"
              : "Pairing backend"}
        </h1>
        <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--sand-text-secondary)" }}>
          {message}
        </p>

        {request ? (
          <div
            className="mt-5 rounded-lg px-3 py-3 text-xs leading-relaxed"
            style={{
              border: "1px solid var(--sand-stroke-tertiary)",
              background: "var(--sand-fill-quinary)",
              color: "var(--sand-text-tertiary)",
            }}
          >
            Host:{" "}
            <span className="font-mono" style={{ color: "var(--sand-text-secondary)" }}>
              {request.host}
            </span>
          </div>
        ) : null}

        {status === "error" ? (
          <div
            className="mt-5 rounded-lg px-3 py-2 text-sm"
            style={{
              border: "1px solid color-mix(in srgb, var(--sand-red) 30%, transparent)",
              background: "color-mix(in srgb, var(--sand-red) 8%, transparent)",
              color: "var(--sand-red)",
            }}
          >
            Verify the backend is reachable from this browser, supports CORS for hosted clients, and
            is served over HTTPS when opening this page from HTTPS.
          </div>
        ) : null}

        <div className="mt-6 flex flex-wrap gap-2">
          {status === "pairing" ? (
            <Button disabled size="sm">
              Pairing...
            </Button>
          ) : canRetry ? (
            <Button size="sm" onClick={() => void submitHostedPairingRequest()}>
              Try again
            </Button>
          ) : null}
          {status === "paired" ? (
            <Button size="sm" variant="outline" onClick={() => (window.location.href = "/")}>
              Open app
            </Button>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function errorMessageFromUnknown(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }

  return "Authentication failed.";
}

function describeAuthGate(bootstrapMethods: ReadonlyArray<string>): string {
  if (bootstrapMethods.includes("desktop-bootstrap")) {
    return "This environment expects a trusted pairing credential before the app can connect.";
  }

  return "Enter a pairing token to start a session with this environment.";
}

function describeSupportedMethods(bootstrapMethods: ReadonlyArray<string>): string {
  if (
    bootstrapMethods.includes("desktop-bootstrap") &&
    bootstrapMethods.includes("one-time-token")
  ) {
    return "Desktop-managed pairing and one-time pairing tokens are both accepted for this environment.";
  }

  if (bootstrapMethods.includes("desktop-bootstrap")) {
    return "This environment is desktop-managed. Open it from the desktop app or paste a bootstrap credential if one was issued explicitly.";
  }

  return "This environment accepts one-time pairing tokens. Pairing links can open this page directly, or you can paste the token here.";
}
