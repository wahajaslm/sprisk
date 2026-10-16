import { describe, expect, it } from "vitest";

import { LAYOUT_VERSION, restoreLayout } from "../src/workbench/layout.ts";

describe("saved layouts", () => {
  it("an unknown view type in a saved layout becomes a placeholder, not a crash", () => {
    const saved = JSON.stringify({
      version: LAYOUT_VERSION,
      dock: { panels: { a: { id: "a", contentComponent: "flow" }, b: { id: "b", contentComponent: "hologram" }, c: { id: "c", contentComponent: "library" } } },
    });
    const restored = restoreLayout(saved);
    expect(restored?.panels["b"]?.contentComponent).toBe("placeholder");
    expect(restored?.panels["a"]?.contentComponent).toBe("flow");
    expect(restored?.panels["c"]?.contentComponent).toBe("placeholder");
  });

  it("a layout from another version, or unreadable text, falls back to the default", () => {
    expect(restoreLayout(JSON.stringify({ version: LAYOUT_VERSION + 1, dock: { panels: {} } }))).toBeUndefined();
    expect(restoreLayout("{not json")).toBeUndefined();
    expect(restoreLayout(null)).toBeUndefined();
  });
});
