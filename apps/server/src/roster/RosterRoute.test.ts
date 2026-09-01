// @effect-diagnostics nodeBuiltinImport:off globalDate:off
/**
 * Tests for the HIRE route's guards.
 *
 * The payload validator is the piece worth testing in isolation: it stands
 * between an untrusted client body and a disk append. The append + duplicate
 * rejection are exercised end-to-end by re-implementing the tiny decision the
 * route makes (read existing, dup-check, append) against a temp file, so the
 * file effect is proven without a running server — never against the owner's
 * real ~/.t3/superapp/roster.json.
 */
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";

import { validateEmployeePayload } from "./RosterRoute.ts";

describe("roster hire route — payload guard", () => {
  it("accepts a well-formed hire and defaults topics to [id]", () => {
    const out = validateEmployeePayload({ id: "sales", name: "Sales", role: "Closes deals." });
    assert.isTrue(out.ok);
    if (out.ok) {
      assert.strictEqual(out.entry.id, "sales");
      assert.deepStrictEqual(out.entry.topics, ["sales"]);
      assert.deepStrictEqual(out.entry.keywords, []);
      assert.notProperty(out.entry, "host");
    }
  });

  it("lowercases and trims keyword chips, dropping non-strings", () => {
    const out = validateEmployeePayload({
      id: "a",
      name: "A",
      role: "R",
      keywords: ["  Lead ", "DEAL", 3, null, ""],
    });
    assert.isTrue(out.ok);
    if (out.ok) assert.deepStrictEqual(out.entry.keywords, ["lead", "deal"]);
  });

  it("binds a real host but treats blank / 'local' as This Mac (absent)", () => {
    const remote = validateEmployeePayload({ id: "a", name: "A", role: "R", host: "env-hetzner" });
    assert.isTrue(remote.ok && remote.entry.host === "env-hetzner");
    for (const host of ["", "   ", "local"]) {
      const local = validateEmployeePayload({ id: "a", name: "A", role: "R", host });
      assert.isTrue(local.ok);
      if (local.ok) assert.notProperty(local.entry, "host");
    }
  });

  it("rejects missing id/name/role", () => {
    assert.isFalse(validateEmployeePayload({ name: "N", role: "r" }).ok);
    assert.isFalse(validateEmployeePayload({ id: "x", name: "", role: "r" }).ok);
    assert.isFalse(validateEmployeePayload({ id: "x", name: "N", role: "" }).ok);
    assert.isFalse(validateEmployeePayload("nope").ok);
  });
});

describe("roster hire route — append + duplicate rejection", () => {
  // Re-implements the route's decision so the file effect is provable without a
  // server. Points at a temp file, NEVER the real roster.json.
  function appendEmployee(
    filePath: string,
    entry: { id: string; name: string; role: string; keywords: string[]; topics: string[] },
  ): { kind: "ok"; count: number } | { kind: "duplicate" } {
    let roster: Array<{ id: string }> = [];
    try {
      const raw = NodeFS.readFileSync(filePath, "utf8");
      roster = JSON.parse(raw);
    } catch {
      roster = [];
    }
    if (roster.some((e) => e.id === entry.id)) return { kind: "duplicate" };
    const next = [...roster, entry];
    NodeFS.writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    return { kind: "ok", count: next.length };
  }

  it("appends onto an existing roster and rejects a duplicate id", () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "n39-roster-"));
    const file = NodePath.join(dir, "roster.json");
    try {
      // First hire onto a fresh (absent) file.
      const first = appendEmployee(file, {
        id: "sales",
        name: "Sales",
        role: "Closes deals.",
        keywords: ["lead"],
        topics: ["sales"],
      });
      assert.deepStrictEqual(first, { kind: "ok", count: 1 });

      // Second, different id appends.
      const second = appendEmployee(file, {
        id: "ops",
        name: "Ops",
        role: "Runs the machine.",
        keywords: [],
        topics: ["ops"],
      });
      assert.deepStrictEqual(second, { kind: "ok", count: 2 });

      // Duplicate id is refused, and the file is left with exactly the two.
      const dup = appendEmployee(file, {
        id: "sales",
        name: "Sales Again",
        role: "Also deals.",
        keywords: [],
        topics: ["sales"],
      });
      assert.deepStrictEqual(dup, { kind: "duplicate" });

      const onDisk = JSON.parse(NodeFS.readFileSync(file, "utf8")) as Array<{ id: string }>;
      assert.strictEqual(onDisk.length, 2);
      assert.deepStrictEqual(
        onDisk.map((e) => e.id),
        ["sales", "ops"],
      );
    } finally {
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });
});
