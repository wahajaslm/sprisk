import type { MethodologyCheck } from "@sprisk/contracts";
import { describe, expect, it } from "vitest";

import { concernsByNode } from "../src/api/checks.ts";

const check = (verdict: MethodologyCheck["verdict"], cited: string[]): MethodologyCheck => ({
  schema_version: "sprisk.methodology_check/v1",
  id: "mck_01JABCDEFGHJKMNPQRSTVWXYZ0",
  pipeline_version_id: "plv_01JABCDEFGHJKMNPQRSTVWXYZ0",
  check: "supervised.split_leakage@1.0.0",
  verdict,
  rationale: "Why.",
  cited_nodes: cited,
  created_at: "2026-10-25T10:00:00Z",
});

describe("a step's concerns (ADR-0061: red is for problems)", () => {
  it("counts a failed or warning check against each step it cites", () => {
    const run = { status: "ready" as const, checks: [check("fail", ["split"]), check("warning", ["split", "model"])] };
    expect(concernsByNode(run)).toEqual(new Map([["split", 2], ["model", 1]]));
  });

  it("does not count a check that could not assess the step: not knowing is not a problem", () => {
    const run = { status: "ready" as const, checks: [check("not_assessed", ["split"]), check("pass", ["split"])] };
    expect(concernsByNode(run)).toEqual(new Map());
  });
});
