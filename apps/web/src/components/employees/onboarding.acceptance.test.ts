// @effect-diagnostics globalDate:off
/**
 * ACCEPTANCE TEST for the whole voice-note onboarding promise (N2.1).
 *
 * This is the test that says "a stranger's rambling brain-dump becomes a team
 * that escalates the right things." It runs the real pipeline end to end:
 *
 *   transcript (messy prose)
 *     -> extraction (fronts)          [authored here; in production the LLM]
 *     -> assembleOnboarding()         [the pure assembler under test]
 *     -> parseNowSections() + ownerOf()  [the REAL parser + router we shipped]
 *
 * The extraction step is an LLM call in production, which is non-deterministic
 * and cannot run in unit tests. So each fixture pairs a transcript with the
 * faithful extraction a good model should produce from it (every concrete item
 * captured, buried deadlines surfaced) — and the test proves the DETERMINISTIC
 * half: that a faithful extraction assembles into artifacts the app's own
 * parser accepts, with the four guarantees that ARE the product:
 *
 *   1. NOW.md parses cleanly through parseNowSections (never a flat blob).
 *   2. ZERO unrouted items: every escalation finds an owner (ownerOf != null).
 *      An unrouted item is a silently-dropped commitment — the failure mode the
 *      bake-off flagged.
 *   3. Every transcript item is present in the output (0 dropped).
 *   4. Deadlines inside 48h are marked blocking and land on the critical path,
 *      so an employee escalates them today (the Finance closing-window lesson).
 *
 * The roster also round-trips through parseRoster so a stranger's generated
 * config is valid by the same boundary a hand-written one is checked at.
 */
import { assert, describe, it } from "@effect/vitest";
import { assembleOnboarding, type OnboardingExtraction } from "@t3tools/shared/onboarding";

import { parseNowSections } from "../todayPanel.logic";
import { ownerOf, parseRoster } from "./roster";

/** Fixed clock so deadlineLabel countdowns are deterministic. A Sunday. */
const NOW = new Date("2026-08-30T09:00:00Z");

/**
 * A fixture: the messy thing the person said, the faithful extraction, and the
 * substrings we insist survive to the output. `transcript` is documentation of
 * what the extraction is faithful TO; the test asserts against `extraction`.
 */
interface Fixture {
  readonly who: string;
  readonly transcript: string;
  readonly extraction: OnboardingExtraction;
  /** Items whose deadline is inside 48h of NOW; must end up blocking/critical. */
  readonly within48h: ReadonlyArray<string>;
}

const STUDENT: Fixture = {
  who: "student",
  transcript: `okay so it's late and my brain won't shut up. the big thing is the
  orgo midterm, that's monday, wait no it's this monday coming up, two days, and
  i've barely looked at chapter nine. also the chem lab report is due tomorrow at
  noon and i haven't done the error analysis section. professor patel emailed
  about the research position, i need to reply before she gives it to someone
  else, been sitting for four days ugh. financial aid, the FAFSA renewal closes
  september first i think, need to ask mom for the tax stuff. um. the group
  project for stats, i'm supposed to send my part to jenna, it's the regression
  slides. gym membership i keep meaning to cancel, whatever. oh and i need to
  register for spring classes, enrollment opens next week and the good sections
  fill up fast. call grandma back, she called twice. and the scholarship essay,
  that's the one that actually matters, it's due the fifteenth and i haven't
  started, five hundred words on leadership.`,
  extraction: {
    fronts: [
      {
        front: "School",
        role: "Keeps coursework and deadlines from slipping.",
        urgency: "high",
        items: [
          { text: "Study chapter nine for the orgo midterm", due: "Mon Aug 31", blocking: true },
          { text: "Finish the error analysis in the chem lab report", due: "Aug 31", blocking: true },
          { text: "Send the regression slides to Jenna for the stats group project" },
          { text: "Register for spring classes when enrollment opens next week" },
          { text: "Write the 500-word scholarship essay on leadership", due: "Sep 15" },
        ],
      },
      {
        front: "Research",
        role: "Chases the research opportunity before it closes.",
        urgency: "high",
        items: [
          { text: "Reply to Professor Patel about the research position", blocking: true },
        ],
      },
      {
        front: "Money",
        role: "Handles aid paperwork and closing windows.",
        urgency: "high",
        items: [
          { text: "Renew the FAFSA before it closes", due: "Sep 1", blocking: true },
          { text: "Ask Mom for the tax documents for the FAFSA" },
        ],
      },
      {
        front: "Personal",
        role: "The life admin that keeps getting deferred.",
        urgency: "low",
        items: [
          { text: "Cancel the gym membership" },
          { text: "Call Grandma back, she called twice" },
        ],
      },
    ],
  },
  within48h: [
    "Study chapter nine for the orgo midterm",
    "Finish the error analysis in the chem lab report",
    "Renew the FAFSA before it closes",
  ],
};

const FOUNDER: Fixture = {
  who: "founder",
  transcript: `brain dump before i lose it. investor update goes out end of day
  tomorrow, i still don't have the burn number from finance, need to chase
  dylan. the demo for the acme pilot is wednesday and the onboarding flow still
  crashes on signup, that's a blocker. we're supposed to close the seed round
  this month and i owe the lead a data room, it's half built. hiring, the senior
  eng candidate, priya, i need to send the offer before friday or we lose her to
  stripe. the aws bill doubled and nobody knows why, someone has to dig in.
  payroll runs the thirtieth, need to move money into the account. oh the
  trademark filing, the lawyer needs my sign-off, it's been sitting a week.
  content, i promised a launch blog post but honestly that can wait. and i need
  to renew the domain, it expires in like ten days and if it lapses we're
  offline. board meeting prep, that's the fourth.`,
  extraction: {
    fronts: [
      {
        front: "Fundraise",
        role: "Gets the round closed and investors current.",
        urgency: "high",
        items: [
          { text: "Send the investor update; chase Dylan for the burn number", due: "Aug 31", blocking: true },
          { text: "Finish the data room for the seed lead" },
          { text: "Prep for the board meeting", due: "Sep 4" },
        ],
      },
      {
        front: "Product",
        role: "Keeps the pilot demo and the app working.",
        urgency: "high",
        items: [
          { text: "Fix the signup crash in the onboarding flow before the Acme demo", due: "Sep 2", blocking: true },
        ],
      },
      {
        front: "Hiring",
        role: "Closes the key engineering hire before she is gone.",
        urgency: "high",
        items: [
          { text: "Send Priya the senior eng offer before she takes Stripe", due: "Sep 4", blocking: true },
        ],
      },
      {
        front: "Ops",
        role: "Handles the money, the cloud bill, and the filings.",
        urgency: "high",
        items: [
          { text: "Move money into the account for payroll", due: "Aug 30", blocking: true },
          { text: "Investigate why the AWS bill doubled" },
          { text: "Renew the company domain before it expires and takes us offline", blocking: true },
          { text: "Sign off on the trademark filing for the lawyer" },
        ],
      },
      {
        front: "Marketing",
        role: "The launch content that can wait a beat.",
        urgency: "low",
        items: [{ text: "Write the launch blog post" }],
      },
    ],
  },
  within48h: [
    "Send the investor update; chase Dylan for the burn number",
    "Send Priya the senior eng offer before she takes Stripe",
    "Move money into the account for payroll",
  ],
};

const PARENT: Fixture = {
  who: "parent",
  transcript: `okay everything in my head right now. leo's science project is due
  monday and we still need the poster board and the little solar panel thing.
  maya's soccer registration closes tomorrow, i literally cannot forget again.
  mom's cardiology follow-up is on the fourth and i'm driving her, block the
  morning. the dishwasher's been leaking, need to call a plumber. school
  fundraiser, i signed up to bring forty cupcakes friday, why did i do that. the
  car registration expires end of the month, that's the thirty-first, need to do
  the smog check first. dentist for both kids, overdue, should book it. my work
  thing, the quarterly report, my boss wants the draft wednesday. and the
  mortgage refinance paperwork, the rate lock expires in a week and if i miss it
  we start over. oh and thank-you notes for maya's birthday, been three weeks,
  bad mom. pick up the prescription, it's ready.`,
  extraction: {
    fronts: [
      {
        front: "Kids",
        role: "Keeps the children's deadlines and care on track.",
        urgency: "high",
        items: [
          { text: "Buy poster board and a solar panel for Leo's science project", due: "Aug 31", blocking: true },
          { text: "Complete Maya's soccer registration before it closes", due: "Aug 31", blocking: true },
          { text: "Book the overdue dentist appointments for both kids" },
          { text: "Write thank-you notes for Maya's birthday" },
        ],
      },
      {
        front: "Family",
        role: "Handles elder care and the household.",
        urgency: "high",
        items: [
          { text: "Drive Mom to her cardiology follow-up and block the morning", due: "Sep 4" },
          { text: "Call a plumber about the leaking dishwasher" },
          { text: "Pick up the prescription that is ready" },
        ],
      },
      {
        front: "Home",
        role: "Keeps the house, car, and finances from lapsing.",
        urgency: "high",
        items: [
          { text: "Do the smog check then renew the car registration", due: "Aug 31", blocking: true },
          { text: "Submit the mortgage refinance paperwork before the rate lock expires", blocking: true },
          { text: "Bring forty cupcakes to the school fundraiser", due: "Sep 4" },
        ],
      },
      {
        front: "Work",
        role: "The day job that still needs its deliverable.",
        urgency: "medium",
        items: [{ text: "Draft the quarterly report for my boss", due: "Sep 2" }],
      },
    ],
  },
  within48h: [
    "Buy poster board and a solar panel for Leo's science project",
    "Complete Maya's soccer registration before it closes",
    "Do the smog check then renew the car registration",
  ],
};

const FIXTURES: ReadonlyArray<Fixture> = [STUDENT, FOUNDER, PARENT];

/** Every item text the fixture declared, flattened. */
function allItemTexts(fixture: Fixture): Array<string> {
  return fixture.extraction.fronts.flatMap((f) => f.items.map((i) => i.text));
}

describe("voice-note onboarding — acceptance", () => {
  for (const fixture of FIXTURES) {
    describe(fixture.who, () => {
      const assembled = assembleOnboarding(fixture.extraction, NOW);
      const roster = assembled.roster;
      const sections = parseNowSections(assembled.nowMd);
      const outItems = sections.flatMap((s) => s.items);

      it("produces a NOW.md the real parser splits into sections", () => {
        assert.isAbove(sections.length, 0, "NOW.md did not parse into any section");
        assert.isAbove(outItems.length, 0, "NOW.md parsed but yielded no items");
      });

      it("routes every escalation to an owner — ZERO unrouted", () => {
        const unrouted = outItems
          .map((i) => i.text)
          .filter((text) => ownerOf(text, roster) === null);
        assert.deepStrictEqual(unrouted, [], `unrouted items:\n${unrouted.join("\n")}`);
      });

      it("captures every transcript item — nothing dropped", () => {
        // Each declared item must appear verbatim (whitespace-normalized) inside
        // some parsed output item. Proves the assembler dropped nothing.
        const haystack = outItems.map((i) => i.text.replace(/\s+/g, " ")).join("\n");
        const missing = allItemTexts(fixture)
          .map((t) => t.replace(/\s+/g, " "))
          .filter((t) => !haystack.includes(t));
        assert.deepStrictEqual(missing, [], `dropped items:\n${missing.join("\n")}`);
        assert.strictEqual(
          assembled.items,
          allItemTexts(fixture).length,
          "assembled item count disagrees with the fixture",
        );
      });

      it("puts <48h deadlines on the critical path so they escalate today", () => {
        const critical = sections.find((s) => s.kind === "critical");
        const criticalText = (critical?.items ?? []).map((i) => i.text.replace(/\s+/g, " "));
        for (const urgent of fixture.within48h) {
          const norm = urgent.replace(/\s+/g, " ");
          assert.isTrue(
            criticalText.some((t) => t.includes(norm)),
            `"${urgent}" is due <48h but is not on the critical path`,
          );
        }
      });

      it("emits a roster valid at the same boundary as a hand-written one", () => {
        // parseRoster throws on any malformed entry; a clean parse means our
        // generated config passes the untrusted-input boundary.
        const parsed = parseRoster(roster);
        assert.strictEqual(parsed.length, roster.length);
        assert.strictEqual(parsed.length, fixture.extraction.fronts.length);
      });
    });
  }
});
