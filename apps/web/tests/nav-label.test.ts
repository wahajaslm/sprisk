import { describe, expect, it } from "vitest";
import { NAV, NAV_LABEL } from "../src/workbench/selection.ts";

describe("NAV_LABEL", () => {
  it("shows the Flow page as Pipeline and keeps the Flow id", () => {
    expect(NAV).toContain("Flow");
    expect(NAV_LABEL.Flow).toBe("Pipeline");
  });

  it("gives every page a label", () => {
    for (const nav of NAV) expect(NAV_LABEL[nav]).toBeTruthy();
  });
});
