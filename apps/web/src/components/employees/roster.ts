/**
 * The employee layer: named workers that own a life-area, hide their sessions,
 * and escalate the things that need a human.
 *
 * Design constraints, arrived at by first principles rather than by analogy:
 *
 *  - NO new database. Threads already live in sqlite and escalations already
 *    live in NOW.md. An employee is a *mapping*, not a new store. The moment
 *    this needs a migration, it has failed its own test.
 *  - An employee only exists if it has escalations. Roshni (177 threads),
 *    LinkedIn (84), printing (20), reelmind (18) all have ZERO items in
 *    NOW.md, so they are archives, not workers. Hiring them would be pure
 *    overhead. They stay searchable and unstaffed.
 *  - Roster is derived from measured topic labels over 1,518 real sessions,
 *    not from a plausible-sounding org chart.
 *
 * The whole product is the join: NOW.md item -> the employee who owns it.
 */

/**
 * Stable identifiers. A string, not a closed union, because the roster is a
 * per-instance config: the built-in default below staffs Paper/Outreach/etc.,
 * but a stranger's instance supplies its own ids via roster.json (see
 * parseRoster). Config ids are validated at the parse boundary, not by the type.
 */
export type EmployeeId = string;

export interface Employee {
  readonly id: EmployeeId;
  readonly name: string;
  /** One line, written as the employee's own job description. */
  readonly role: string;
  /** Topic labels (from the session manifest) this employee owns. */
  readonly topics: ReadonlyArray<string>;
  /**
   * Lowercase keywords matched against NOW.md items to route escalations.
   * Order matters: the first employee with a hit owns the item.
   */
  readonly keywords: ReadonlyArray<string>;
  /**
   * Which environment this employee's conversations open in. Absent means This
   * Mac (the primary/local environment) — the only host that existed before
   * N3.9, so an old roster.json without this field keeps opening threads
   * locally. A value is an EnvironmentId naming a remote T3 server (a Hetzner
   * box, a second machine) the client already knows how to connect to; the open
   * path binds the thread to it instead of the primary. Validated as an opaque
   * string at the parse boundary, never trusted to be reachable.
   */
  readonly host?: string;
}

/**
 * The built-in default roster, ordered by how much of the critical path each
 * one carries. Paper is first because every measurement says it is the
 * bottleneck. This is the DEFAULT: a stranger's instance overrides it with a
 * roster.json (parsed by parseRoster, served in the TODAY payload). When no
 * config file exists, this ships unchanged, so the original instance is
 * byte-for-byte identical.
 */
export const ROSTER: ReadonlyArray<Employee> = [
  {
    id: "paper",
    keywords: [
      "iecbes",
      "zaidi",
      "manuscript",
      "arxiv",
      "preprint",
      "co-author",
      "ieee",
      "v8",
      "conference deadline",
      "the conference",
    ],
    name: "Paper",
    role: "Gets the EEG manuscript submitted and keeps co-authors aligned.",
    topics: ["zaidi-paper"],
  },
  {
    id: "outreach",
    keywords: [
      "linderman",
      "coleman",
      "zare",
      "fisher",
      "bueno",
      "jaramillo",
      "stanford",
      "nextsense",
      "lab seat",
    ],
    name: "Outreach",
    role: "Runs the lab-seat campaign: drafts, sends, and chases replies.",
    topics: ["stanford-outreach"],
  },
  {
    id: "apps",
    keywords: [
      "boom",
      "recruiter",
      "megan",
      "sat",
      "scholarship",
      "college",
      "resume",
      "rocketride",
      "internship",
      "hackathon",
      "nithya",
    ],
    name: "Apps",
    role: "Owns applications and deadlines: Boom, college, scholarships, SAT.",
    topics: ["college-apps"],
  },
  {
    id: "bench",
    keywords: ["plasma", "gate 1", "hardware", "kahlus", "urtc", "poster", "genome", "parol"],
    name: "Bench",
    role: "Keeps the hardware and the Kahlus benchmark honest and moving.",
    topics: ["kahlus"],
  },
  {
    id: "ops",
    keywords: ["disk", "calendar", "gmail", "neurologist", "melani", "routing", "resend", "brevo"],
    name: "Ops",
    role: "Handles the machine, the inbox, the calendar, and your health admin.",
    topics: ["melani", "t3code"],
  },
];

/** Topics that are deliberately unstaffed: real history, no live escalations. */
export const ARCHIVED_TOPICS: ReadonlyArray<string> = [
  "roshni",
  "linkedin",
  "printing",
  "reelmind",
  "misc",
];

/**
 * Route one NOW.md item to its owner. Returns null when nothing matches, which
 * is deliberate: an unrouted item is a visible signal that the roster is wrong,
 * not something to silently dump on a catch-all employee.
 *
 * `roster` defaults to the built-in so existing callers are unchanged; a
 * config-loaded roster is passed through by the panels that fetch one.
 */
export function ownerOf(
  itemText: string,
  roster: ReadonlyArray<Employee> = ROSTER,
): EmployeeId | null {
  const haystack = itemText.toLowerCase();
  for (const employee of roster) {
    if (employee.keywords.some((keyword) => haystack.includes(keyword))) {
      return employee.id;
    }
  }
  return null;
}

export function employeeById(
  id: EmployeeId,
  roster: ReadonlyArray<Employee> = ROSTER,
): Employee | undefined {
  return roster.find((employee) => employee.id === id);
}

/**
 * Parse a roster.json into a validated roster, or throw with a precise reason.
 * The whole point of the config boundary: a stranger's file is untrusted, so
 * every field is checked here rather than trusted by the `Employee` type. On
 * any failure the caller falls back to the built-in ROSTER, so a broken config
 * degrades to the default instead of an empty team.
 */
export function parseRoster(raw: unknown): ReadonlyArray<Employee> {
  if (!Array.isArray(raw)) throw new Error("roster must be a JSON array");
  const ids = new Set<string>();
  return raw.map((entry, index) => {
    if (typeof entry !== "object" || entry === null) {
      throw new Error(`roster[${index}] must be an object`);
    }
    const e = entry as Record<string, unknown>;
    const strArray = (v: unknown, field: string): ReadonlyArray<string> => {
      if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) {
        throw new Error(`roster[${index}].${field} must be an array of strings`);
      }
      return v;
    };
    if (typeof e.id !== "string" || e.id.length === 0) {
      throw new Error(`roster[${index}].id must be a non-empty string`);
    }
    if (ids.has(e.id)) throw new Error(`roster[${index}].id "${e.id}" is duplicated`);
    ids.add(e.id);
    if (typeof e.name !== "string" || e.name.length === 0) {
      throw new Error(`roster[${index}].name must be a non-empty string`);
    }
    if (typeof e.role !== "string" || e.role.length === 0) {
      throw new Error(`roster[${index}].role must be a non-empty string`);
    }
    // `host` is optional and backward compatible: absent means This Mac. When
    // present it must be a non-empty string (an environment id); an empty string
    // is a malformed binding, not a valid "local", so reject it rather than
    // silently treating it as local.
    if (e.host !== undefined && (typeof e.host !== "string" || e.host.length === 0)) {
      throw new Error(`roster[${index}].host must be a non-empty string when present`);
    }
    return {
      id: e.id,
      keywords: strArray(e.keywords, "keywords"),
      name: e.name,
      role: e.role,
      topics: strArray(e.topics, "topics"),
      ...(e.host !== undefined ? { host: e.host } : {}),
    };
  });
}

/**
 * Resolve the active roster from the raw JSON the server read off disk. A
 * missing file (rosterJson null) or a malformed one both fall back to the
 * built-in ROSTER, so the panels always render a team: a stranger's typo
 * degrades to the default rather than an empty rail. Returns the same ROSTER
 * reference when there is no override, keeping the original instance identical.
 */
export function resolveRoster(rosterJson: string | null | undefined): ReadonlyArray<Employee> {
  if (!rosterJson) return ROSTER;
  try {
    const parsed = parseRoster(JSON.parse(rosterJson));
    return parsed.length > 0 ? parsed : ROSTER;
  } catch {
    return ROSTER;
  }
}
