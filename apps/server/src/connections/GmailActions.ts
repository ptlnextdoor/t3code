// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalFetch:off
/**
 * Gmail actions available to the employee layer.
 *
 * Safety posture: reading and listing are free, but SENDING IS IRREVERSIBLE.
 * Every send therefore requires an explicit confirm flag from the caller, so a
 * mis-click or a stray agent call cannot put mail in someone's inbox. The UI
 * is expected to show the draft and require a deliberate confirmation.
 */
import { getAccessToken } from "./GoogleConnector.ts";

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

export interface DraftSummary {
  readonly id: string;
  readonly to: string;
  readonly subject: string;
  readonly snippet: string;
}

export interface SendResult {
  readonly ok: boolean;
  /** Human sentence, safe to show directly. */
  readonly detail: string;
  readonly messageId?: string;
}

async function authorizedFetch(path: string, init?: RequestInit): Promise<Response | null> {
  const token = await getAccessToken();
  if (!token) return null;
  return fetch(`${GMAIL_BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
  });
}

function headerValue(headers: Array<{ name: string; value: string }>, name: string): string {
  return headers.find((h) => h.name.toLowerCase() === name)?.value ?? "";
}

/** List drafts with enough detail to recognise them, newest first. */
export async function listDrafts(limit = 20): Promise<Array<DraftSummary>> {
  const listed = await authorizedFetch(`/drafts?maxResults=${limit}`);
  if (!listed?.ok) return [];
  const { drafts } = (await listed.json()) as { drafts?: Array<{ id: string }> };
  if (!drafts?.length) return [];

  const summaries = await Promise.all(
    drafts.map(async (draft) => {
      const detail = await authorizedFetch(`/drafts/${draft.id}?format=metadata`);
      if (!detail?.ok) return null;
      const body = (await detail.json()) as {
        message?: {
          snippet?: string;
          payload?: { headers?: Array<{ name: string; value: string }> };
        };
      };
      const headers = body.message?.payload?.headers ?? [];
      return {
        id: draft.id,
        snippet: body.message?.snippet ?? "",
        subject: headerValue(headers, "subject"),
        to: headerValue(headers, "to"),
      } satisfies DraftSummary;
    }),
  );
  return summaries.filter((s): s is DraftSummary => s !== null);
}

/** Fetch one draft so the user can read exactly what they are about to send. */
export async function getDraft(draftId: string): Promise<DraftSummary | null> {
  const response = await authorizedFetch(`/drafts/${draftId}?format=metadata`);
  if (!response?.ok) return null;
  const body = (await response.json()) as {
    message?: { snippet?: string; payload?: { headers?: Array<{ name: string; value: string }> } };
  };
  const headers = body.message?.payload?.headers ?? [];
  return {
    id: draftId,
    snippet: body.message?.snippet ?? "",
    subject: headerValue(headers, "subject"),
    to: headerValue(headers, "to"),
  };
}

/**
 * Send an existing draft.
 *
 * `confirm` must be true. This is not ceremony: sending mail cannot be undone,
 * and the whole point of the approval queue is that a human deliberately said
 * yes to this specific message.
 */
export async function sendDraft(draftId: string, confirm: boolean): Promise<SendResult> {
  if (!confirm) {
    return { detail: "Send was not confirmed, so nothing was sent.", ok: false };
  }
  const response = await authorizedFetch("/drafts/send", {
    body: JSON.stringify({ id: draftId }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  if (!response) {
    return { detail: "Gmail is not connected. Reconnect to send.", ok: false };
  }
  if (!response.ok) {
    return { detail: "Gmail refused the send. The draft was left untouched.", ok: false };
  }
  const sent = (await response.json()) as { id?: string };
  return { detail: "Sent.", ok: true, ...(sent.id ? { messageId: sent.id } : {}) };
}
