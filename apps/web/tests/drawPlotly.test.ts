import { afterEach, describe, expect, it, vi } from "vitest";

const plotly = vi.hoisted(() => ({ react: vi.fn(), purge: vi.fn(), Plots: { resize: vi.fn() } }));
vi.mock("plotly.js-dist-min", () => ({ default: plotly }));

import { drawPlotly } from "../src/views/drawPlotly.ts";

type Watcher = { callback: () => void; observed: Element[]; disconnected: boolean };
const watchers: Watcher[] = [];

class FakeResizeObserver {
  private watcher: Watcher;
  constructor(callback: () => void) {
    this.watcher = { callback, observed: [], disconnected: false };
    watchers.push(this.watcher);
  }
  observe(el: Element) {
    this.watcher.observed.push(el);
  }
  unobserve() {}
  disconnect() {
    this.watcher.disconnected = true;
  }
}

afterEach(() => {
  watchers.length = 0;
  vi.unstubAllGlobals();
});

describe("a Plotly figure fills its box", () => {
  it("redraws at the new size when its box changes, as when the grid or a dock panel resizes", () => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const node = document.createElement("div");
    const cleanup = drawPlotly(node, { data: [] });
    expect(watchers[0]?.observed).toEqual([node]);
    watchers[0]?.callback();
    expect(plotly.Plots.resize).toHaveBeenCalledWith(node);
    cleanup();
    expect(watchers[0]?.disconnected).toBe(true);
    expect(plotly.purge).toHaveBeenCalledWith(node);
  });
});
