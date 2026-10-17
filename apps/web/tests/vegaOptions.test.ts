import { describe, expect, it } from "vitest";

import { vegaOptions } from "../src/views/vegaOptions.ts";

describe("Altair charts drawn with Vega (ADR-0024)", () => {
  const options = vegaOptions(() => "#123456");

  it("never fetches anything: a spec's data URLs are refused", async () => {
    await expect(options.loader.load("https://example.com/data.csv")).rejects.toThrow(/not fetched/);
    await expect(options.loader.sanitize("file:///etc/passwd")).rejects.toThrow(/not fetched/);
  });

  it("evaluates expressions without generated code, and offers no export or editor links", () => {
    expect(options.ast).toBe(true);
    expect(options.actions).toBe(false);
  });

  it("uses Studio colours, keeping the chart's own settings", () => {
    expect(options.config).toMatchObject({ background: "transparent", axis: { labelColor: "#123456" } });
  });
});
