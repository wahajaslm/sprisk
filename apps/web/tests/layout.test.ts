import { describe, expect, it } from "vitest";

import { LAYOUT_VERSION, restoreLayout } from "../src/workbench/layout.ts";

const tab = (id: string, name: string) => ({ id, contentComponent: "tab", tabComponent: "tab", params: { tab: name } });

describe("saved layouts", () => {
  it("keeps every Inspector tab it knows", () => {
    const saved = JSON.stringify({ version: LAYOUT_VERSION, dock: { panels: { a: tab("a", "data"), b: tab("b", "code") } } });
    const restored = restoreLayout(saved);
    expect(restored?.panels["a"]).toEqual(tab("a", "data"));
    expect(restored?.panels["b"]).toEqual(tab("b", "code"));
  });

  it("an unknown view type or tab in a saved layout becomes a placeholder, not a crash", () => {
    const saved = JSON.stringify({
      version: LAYOUT_VERSION,
      dock: { panels: { a: { id: "a", contentComponent: "hologram" }, b: tab("b", "telepathy") } },
    });
    const restored = restoreLayout(saved);
    expect(restored?.panels["a"]).toEqual({ id: "a", contentComponent: "placeholder" });
    expect(restored?.panels["b"]).toEqual({ id: "b", contentComponent: "placeholder", params: { tab: "telepathy" } });
  });

  it("a layout from another version, or unreadable text, falls back to the default", () => {
    expect(restoreLayout(JSON.stringify({ version: LAYOUT_VERSION + 1, dock: { panels: {} } }))).toBeUndefined();
    expect(restoreLayout(JSON.stringify({ version: 4, dock: { panels: { a: { id: "a", contentComponent: "flow" } } } }))).toBeUndefined();
    expect(restoreLayout("{not json")).toBeUndefined();
    expect(restoreLayout(null)).toBeUndefined();
  });
});
