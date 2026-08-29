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

/** Stable identifiers. Kept short because they appear in URLs and storage. */
export type EmployeeId = "paper" | "outreach" | "apps" | "bench" | "ops";

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
}

/**
 * The roster, ordered by how much of the critical path each one carries.
 * Paper is first because every measurement says it is the bottleneck.
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
 */
export function ownerOf(itemText: string): EmployeeId | null {
  const haystack = itemText.toLowerCase();
  for (const employee of ROSTER) {
    if (employee.keywords.some((keyword) => haystack.includes(keyword))) {
      return employee.id;
    }
  }
  return null;
}

export function employeeById(id: EmployeeId): Employee | undefined {
  return ROSTER.find((employee) => employee.id === id);
}
