import type { Node, Operator } from "@sprisk/contracts";
import { describe, expect, it } from "vitest";

import { stepOrigin } from "../src/flow/stages.ts";
import { operators } from "./fixtures.ts";

const split = operators.find((o) => o.id.includes("random_split"))!;
const step = (extra: Partial<Node> = {}): Node => ({ id: "split", operator: split.id, params: {}, ...extra });
const producer: Operator = { ...split, produces: { "data.near_duplicate_groups": { fields: { rows: "integer" } } } };

describe("where a step on the canvas comes from (ADR-0063)", () => {
  it("is written when a person or the first build placed it", () => {
    expect(stepOrigin(step(), split)).toBe("written");
  });

  it("is decided when a method's decision placed or set it", () => {
    expect(stepOrigin(step({ methodology_decision_id: "mdc_01JABCDEFGHJKMNPQRSTVWXYZ0" }), split)).toBe("decided");
  });

  it("measures when its operator produces evidence for a method", () => {
    expect(stepOrigin(step(), producer)).toBe("measures");
  });

  it("is written when its operator is not installed", () => {
    expect(stepOrigin(step(), undefined)).toBe("written");
  });
});
