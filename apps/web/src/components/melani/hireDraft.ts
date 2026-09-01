/**
 * Pure form logic for the "hire an employee" dialog (N3.9), kept framework-free
 * so the id derivation and validation are unit-tested without the DOM.
 *
 * The dialog collects a name, a one-line role, keyword chips, and an optional
 * host. The server owns the real validation (RosterRoute.validateEmployeePayload),
 * but the dialog derives a stable id from the name and does a light local check
 * so the owner sees "give it a name" inline rather than a round-trip 400.
 */

/** The payload the dialog POSTs to /api/roster/employee. */
export interface HireDraft {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly keywords: ReadonlyArray<string>;
  /** Absent = This Mac. An environment id when a remote host was picked. */
  readonly host?: string;
}

/**
 * Turn a display name into a stable, url-safe id: lowercase, non-alphanumerics
 * collapsed to single hyphens, trimmed. "Melani's Server" -> "melani-s-server".
 * Empty when the name has no usable characters, which the caller treats as
 * "not ready yet".
 */
export function slugifyEmployeeId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Split a chip input into deduped, lowercased, non-empty keywords. */
export function parseKeywordInput(raw: string): ReadonlyArray<string> {
  const seen = new Set<string>();
  const out: Array<string> = [];
  for (const part of raw.split(/[,\n]/)) {
    const keyword = part.trim().toLowerCase();
    if (keyword.length > 0 && !seen.has(keyword)) {
      seen.add(keyword);
      out.push(keyword);
    }
  }
  return out;
}

export type HireValidation =
  | { readonly ok: true; readonly draft: HireDraft }
  | { readonly ok: false; readonly reason: string };

/**
 * Validate the dialog's fields into a POST-ready draft, or a human reason.
 * `host` is passed through only when it names a real remote (not "" / "local"),
 * so the wire and the roster file both stay clean for This-Mac employees.
 * `existingIds` guards the one failure the owner can fix inline: a name whose
 * derived id collides with an employee already on the roster.
 */
export function validateHireDraft(input: {
  readonly name: string;
  readonly role: string;
  readonly keywords: ReadonlyArray<string>;
  readonly host: string | undefined;
  readonly existingIds: ReadonlyArray<string>;
}): HireValidation {
  const name = input.name.trim();
  const role = input.role.trim();
  if (name.length === 0) return { ok: false, reason: "Give your employee a name." };
  const id = slugifyEmployeeId(name);
  if (id.length === 0) {
    return { ok: false, reason: "That name has no letters or numbers to make an id from." };
  }
  if (input.existingIds.includes(id)) {
    return { ok: false, reason: `You already have an employee named “${name}”.` };
  }
  if (role.length === 0) return { ok: false, reason: "Say in one line what they own." };
  const host = input.host?.trim();
  const remoteHost = host && host.length > 0 && host.toLowerCase() !== "local" ? host : undefined;
  return {
    ok: true,
    draft: {
      id,
      name,
      role,
      keywords: input.keywords,
      ...(remoteHost ? { host: remoteHost } : {}),
    },
  };
}
