/**
 * The join that lets the STAGE know *who* a conversation belongs to.
 *
 * The Melani shell opens every employee conversation through the shared
 * zero-config path (`useEmployeeConversation`), which returns a `{ draftId,
 * threadId }`. That is the only moment the employee's identity and the
 * conversation's ids are both in hand, so we record the mapping here. The
 * stage (ChatView) then reads it back to render a person-shaped header and
 * empty state instead of t3code's project/git chrome.
 *
 * Design notes, first-principles:
 *  - NO new server store. This is a per-instance UI mapping keyed by
 *    already-existing draft/thread ids, mirrored to localStorage so a reload
 *    inside a conversation still knows the employee.
 *  - We store only the identity the header needs (id, name, role), not the
 *    whole roster summary — the summary is a live projection over NOW.md and
 *    would go stale, whereas name/role are stable.
 *  - Bounded: a conversation maps to exactly one employee, and the map is
 *    capped so a long-lived instance cannot grow it without limit.
 */

/** The minimal, stable identity the stage renders. */
export interface EmployeeIdentity {
  readonly id: string;
  readonly name: string;
  readonly role: string;
}

/** Keys a conversation is addressable by. Either may be absent. */
export interface ConversationKeys {
  readonly draftId?: string | null | undefined;
  readonly threadId?: string | null | undefined;
}

const STORAGE_KEY = "melani.employee-conversations";
const CHANGE_EVENT = "melani:employee-conversation-link-change";
/** Cap the map so an instance that opens thousands of chats stays bounded. */
const MAX_ENTRIES = 500;

/** conversation id (draftId or threadId) -> employee identity. */
const links = new Map<string, EmployeeIdentity>();
let hydrated = false;

function hydrate(): void {
  if (hydrated) return;
  hydrated = true;
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, EmployeeIdentity>;
    for (const [key, value] of Object.entries(parsed)) {
      if (
        value &&
        typeof value.id === "string" &&
        typeof value.name === "string" &&
        typeof value.role === "string"
      ) {
        links.set(key, value);
      }
    }
  } catch {
    // A corrupt blob just means the stage falls back to no-employee; ignore.
  }
}

function persist(): void {
  if (typeof window === "undefined") return;
  try {
    // Trim oldest insertions first (Map preserves insertion order).
    while (links.size > MAX_ENTRIES) {
      const oldest = links.keys().next().value;
      if (oldest === undefined) break;
      links.delete(oldest);
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(links)));
  } catch {
    // Non-fatal: the in-memory map still serves this session.
  }
}

function notify(): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    // Ignore: subscribers just won't refresh until the next render.
  }
}

/**
 * Record that a conversation belongs to an employee. Called once, at open
 * time, with whichever ids the open path produced.
 */
export function recordEmployeeConversation(
  keys: ConversationKeys,
  identity: EmployeeIdentity,
): void {
  hydrate();
  let changed = false;
  for (const key of [keys.draftId, keys.threadId]) {
    if (!key) continue;
    const existing = links.get(key);
    if (
      existing &&
      existing.id === identity.id &&
      existing.name === identity.name &&
      existing.role === identity.role
    ) {
      continue;
    }
    links.set(key, identity);
    changed = true;
  }
  if (!changed) return;
  persist();
  notify();
}

/** Resolve the employee for a conversation, preferring the draft key. */
export function getEmployeeForConversation(keys: ConversationKeys): EmployeeIdentity | null {
  hydrate();
  const byDraft = keys.draftId ? links.get(keys.draftId) : undefined;
  if (byDraft) return byDraft;
  const byThread = keys.threadId ? links.get(keys.threadId) : undefined;
  return byThread ?? null;
}

/** Subscribe to link changes (for useSyncExternalStore). */
export function subscribeEmployeeConversationLinks(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => onChange();
  window.addEventListener(CHANGE_EVENT, handler);
  // Cross-tab writes land as a native storage event.
  const storageHandler = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) {
      hydrated = false;
      links.clear();
      hydrate();
      onChange();
    }
  };
  window.addEventListener("storage", storageHandler);
  return () => {
    window.removeEventListener(CHANGE_EVENT, handler);
    window.removeEventListener("storage", storageHandler);
  };
}
