/**
 * The employee<->conversation link is the join the stage relies on to render
 * a person-shaped header instead of project/git chrome, so its resolution
 * rules (draft preferred over thread, last-write-wins) are pinned here.
 */
import { afterEach, describe, expect, it } from "vite-plus/test";

import { getEmployeeForConversation, recordEmployeeConversation } from "./employeeConversationLink";

const paper = { id: "paper", name: "Paper", role: "Ships the manuscript." };
const outreach = { id: "outreach", name: "Outreach", role: "Keeps collaborators warm." };

afterEach(() => {
  try {
    window.localStorage.clear();
  } catch {
    // jsdom without storage: nothing to clear.
  }
});

describe("employeeConversationLink", () => {
  it("resolves an employee by either draft or thread id", () => {
    recordEmployeeConversation({ draftId: "d1", threadId: "t1" }, paper);
    expect(getEmployeeForConversation({ draftId: "d1" })).toEqual(paper);
    expect(getEmployeeForConversation({ threadId: "t1" })).toEqual(paper);
  });

  it("returns null for an unknown conversation", () => {
    expect(getEmployeeForConversation({ draftId: "nope", threadId: "nope" })).toBeNull();
  });

  it("prefers the draft mapping when draft and thread disagree", () => {
    recordEmployeeConversation({ draftId: "d2" }, paper);
    recordEmployeeConversation({ threadId: "t2" }, outreach);
    expect(getEmployeeForConversation({ draftId: "d2", threadId: "t2" })).toEqual(paper);
  });

  it("overwrites a stale identity for the same conversation", () => {
    recordEmployeeConversation({ threadId: "t3" }, paper);
    recordEmployeeConversation({ threadId: "t3" }, outreach);
    expect(getEmployeeForConversation({ threadId: "t3" })).toEqual(outreach);
  });

  it("ignores absent keys", () => {
    recordEmployeeConversation({ draftId: null, threadId: undefined }, paper);
    expect(getEmployeeForConversation({ draftId: null, threadId: undefined })).toBeNull();
  });
});
