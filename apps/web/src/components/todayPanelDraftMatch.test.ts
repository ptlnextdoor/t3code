// @effect-diagnostics globalDate:off
import { assert, describe, it } from "@effect/vitest";

import { findDraftFor } from "./TodayPanel";

/** Real drafts, taken verbatim from the live Gmail account. */
const DRAFTS = [
  {
    id: "r-76453650855327",
    snippet: "",
    subject: "Re: Stanford SIMR students seeking brief chat",
    to: "scott.linderman@stanford.edu",
  },
  {
    id: "r-61268783877061",
    snippet: "",
    subject: "High schooler with a 6-DOF planner",
    to: "maxim@cs.cmu.edu",
  },
  {
    id: "r157162415873713",
    snippet: "",
    subject: "The CD69 thread running through Asiri",
    to: "rmajeti@stanford.edu",
  },
  {
    id: "r874101473045802",
    snippet: "",
    subject: "Stanford SIMR student",
    to: "dcamarillo@stanford.edu",
  },
];

const fetchDrafts = () => Promise.resolve(DRAFTS);

describe("findDraftFor", () => {
  it("matches an escalation to the right draft by proper noun", async () => {
    const draft = await findDraftFor("Linderman follow-up — Gmail draft, HELD", fetchDrafts);
    assert.strictEqual(draft?.id, "r-76453650855327");
  });

  it("matches on subject text as well as recipient", async () => {
    const draft = await findDraftFor("Camarillo intro", fetchDrafts);
    assert.strictEqual(draft?.to, "dcamarillo@stanford.edu");
  });

  it("returns null rather than guessing when nothing matches", async () => {
    // Sending the wrong email is far worse than sending nothing.
    const draft = await findDraftFor("Plasma Gate 1 hardware decision", fetchDrafts);
    assert.isNull(draft);
  });

  it("returns null when the item has no proper nouns to match on", async () => {
    const draft = await findDraftFor("follow up on the thing", fetchDrafts);
    assert.isNull(draft);
  });

  it("returns null when there are no drafts at all", async () => {
    const draft = await findDraftFor("Linderman follow-up", () => Promise.resolve([]));
    assert.isNull(draft);
  });

  it("prefers the draft matching the most names", async () => {
    const draft = await findDraftFor("Stanford Linderman chat", fetchDrafts);
    // "Stanford" and "Linderman" both hit the Linderman draft.
    assert.strictEqual(draft?.id, "r-76453650855327");
  });
});
