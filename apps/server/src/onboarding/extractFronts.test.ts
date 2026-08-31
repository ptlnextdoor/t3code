// @effect-diagnostics globalDate:off
/**
 * Unit tests for the pure halves of brain-dump extraction: the prompt builder
 * and the tolerant response parser. The subprocess call itself is not exercised
 * here (it spends a token and is non-deterministic); these prove the contract
 * around it, which is where the bugs actually live.
 */
import { assert, describe, it } from "@effect/vitest";

import {
  buildExtractionPrompt,
  ExtractionError,
  parseExtractionResponse,
} from "./extractFronts.ts";

const NOW = new Date("2026-08-30T09:00:00Z");

describe("buildExtractionPrompt", () => {
  it("embeds today's resolved date and the transcript", () => {
    const prompt = buildExtractionPrompt("chase Marcus for the slide", NOW);
    assert.include(prompt, "2026-08-30");
    assert.include(prompt, "Sunday");
    assert.include(prompt, "chase Marcus for the slide");
  });

  it("instructs zero-dropped and closing-window urgency (bake-off lessons)", () => {
    const prompt = buildExtractionPrompt("stuff", NOW);
    assert.include(prompt, "Capture EVERY concrete item");
    assert.include(prompt, "CLOSING WINDOW");
  });
});

describe("parseExtractionResponse", () => {
  const GOOD = JSON.stringify({
    fronts: [
      {
        front: "Work",
        role: "Ships the deck.",
        urgency: "high",
        items: [{ text: "Finish the board deck", due: "Sep 3", blocking: true }],
      },
    ],
  });

  it("parses a clean JSON object", () => {
    const out = parseExtractionResponse(GOOD);
    assert.strictEqual(out.fronts.length, 1);
    assert.strictEqual(out.fronts[0]!.items[0]!.blocking, true);
  });

  it("digs the object out of a ```json fence and trailing prose", () => {
    const noisy = "Here you go:\n```json\n" + GOOD + "\n```\nHope that helps!";
    const out = parseExtractionResponse(noisy);
    assert.strictEqual(out.fronts[0]!.front, "Work");
  });

  it("tolerates bare-string items and fills a default role", () => {
    const raw = JSON.stringify({
      fronts: [{ front: "Home", urgency: "low", items: ["Call the plumber"] }],
    });
    const out = parseExtractionResponse(raw);
    assert.strictEqual(out.fronts[0]!.items[0]!.text, "Call the plumber");
    assert.isAbove(out.fronts[0]!.role.length, 0);
  });

  it("drops malformed fronts but keeps valid ones", () => {
    const raw = JSON.stringify({
      fronts: [
        { front: "", items: [{ text: "no name" }] },
        { front: "Money", urgency: "high", items: [{ text: "File reimbursement" }] },
        { front: "Empty", urgency: "low", items: [] },
      ],
    });
    const out = parseExtractionResponse(raw);
    assert.strictEqual(out.fronts.length, 1);
    assert.strictEqual(out.fronts[0]!.front, "Money");
  });

  it("throws a parse-stage error when there is no JSON", () => {
    try {
      parseExtractionResponse("I couldn't do that.");
      assert.fail("expected throw");
    } catch (error) {
      assert.instanceOf(error, ExtractionError);
      assert.strictEqual((error as ExtractionError).stage, "parse");
    }
  });

  it("throws when the JSON has no usable fronts", () => {
    try {
      parseExtractionResponse(JSON.stringify({ fronts: [] }));
      assert.fail("expected throw");
    } catch (error) {
      assert.strictEqual((error as ExtractionError).stage, "parse");
    }
  });
});
