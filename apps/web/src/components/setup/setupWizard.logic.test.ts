import { assert, describe, it } from "@effect/vitest";

import {
  canGoBack,
  isComplete,
  isFirstRun,
  isSkippable,
  nextStep,
  prevStep,
  progress,
  resumeStep,
  SETUP_STEPS,
  SKIPPABLE_STEPS,
  stepIndex,
  type SetupStep,
} from "./setupWizard.logic";

describe("setup wizard — step order", () => {
  it("is the five canonical steps in the owner's sequence", () => {
    assert.deepStrictEqual(
      [...SETUP_STEPS],
      ["welcome", "connections", "remote", "braindump", "done"],
    );
  });

  it("next walks forward and clamps at done (never wraps)", () => {
    assert.strictEqual(nextStep("welcome"), "connections");
    assert.strictEqual(nextStep("connections"), "remote");
    assert.strictEqual(nextStep("remote"), "braindump");
    assert.strictEqual(nextStep("braindump"), "done");
    assert.strictEqual(nextStep("done"), "done");
  });

  it("prev walks back and clamps at welcome (never wraps)", () => {
    assert.strictEqual(prevStep("done"), "braindump");
    assert.strictEqual(prevStep("braindump"), "remote");
    assert.strictEqual(prevStep("connections"), "welcome");
    assert.strictEqual(prevStep("welcome"), "welcome");
  });

  it("stepIndex agrees with the canonical array", () => {
    SETUP_STEPS.forEach((step, i) => assert.strictEqual(stepIndex(step), i));
  });
});

describe("setup wizard — skip rules", () => {
  it("only remote is skippable", () => {
    assert.deepStrictEqual([...SKIPPABLE_STEPS], ["remote"]);
    assert.isTrue(isSkippable("remote"));
    for (const step of ["welcome", "connections", "braindump", "done"] as SetupStep[]) {
      assert.isFalse(isSkippable(step));
    }
  });

  it("skipping remote lands on braindump, same as advancing", () => {
    // A skip is just "advance without acting", so it must reach the same step.
    assert.strictEqual(nextStep("remote"), "braindump");
  });
});

describe("setup wizard — back affordance", () => {
  it("hides Back on the first step and on done, shows it in between", () => {
    assert.isFalse(canGoBack("welcome"));
    assert.isTrue(canGoBack("connections"));
    assert.isTrue(canGoBack("remote"));
    assert.isTrue(canGoBack("braindump"));
    assert.isFalse(canGoBack("done"));
  });
});

describe("setup wizard — first-run detection", () => {
  it("first run only when BOTH profile and roster are absent", () => {
    assert.isTrue(isFirstRun({ profilePresent: false, rosterPresent: false }));
  });

  it("a partially-set-up instance is NOT a first run", () => {
    assert.isFalse(isFirstRun({ profilePresent: true, rosterPresent: false }));
    assert.isFalse(isFirstRun({ profilePresent: false, rosterPresent: true }));
    assert.isFalse(isFirstRun({ profilePresent: true, rosterPresent: true }));
  });
});

describe("setup wizard — resume mid-wizard", () => {
  it("resumes a valid persisted step (a refresh does not lose progress)", () => {
    assert.strictEqual(resumeStep("remote"), "remote");
    assert.strictEqual(resumeStep("braindump"), "braindump");
    assert.strictEqual(resumeStep("done"), "done");
  });

  it("falls back to welcome for missing or garbage values", () => {
    assert.strictEqual(resumeStep(null), "welcome");
    assert.strictEqual(resumeStep(undefined), "welcome");
    assert.strictEqual(resumeStep(""), "welcome");
    assert.strictEqual(resumeStep("not-a-step"), "welcome");
  });
});

describe("setup wizard — progress", () => {
  it("reports 1-based position over five steps", () => {
    assert.deepStrictEqual(progress("welcome"), { index: 1, total: 5, fraction: 0 });
    assert.strictEqual(progress("connections").index, 2);
    assert.strictEqual(progress("done").index, 5);
  });

  it("the bar fills to 100% only on done", () => {
    assert.strictEqual(progress("done").fraction, 1);
    assert.isBelow(progress("braindump").fraction, 1);
  });

  it("isComplete is true only on done", () => {
    assert.isTrue(isComplete("done"));
    for (const step of ["welcome", "connections", "remote", "braindump"] as SetupStep[]) {
      assert.isFalse(isComplete(step));
    }
  });
});
