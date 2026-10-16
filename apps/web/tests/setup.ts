import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { createElement } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";

import type { CodeInputProps } from "../src/views/CodeInput.tsx";

import { useCanvasDetail, useResultLayout } from "../src/workbench/detail.ts";
import { useSelection } from "../src/workbench/selection.ts";
import { useWorkbench } from "../src/workbench/workbench.ts";

import { server } from "./server.ts";

// React Flow measures nodes; jsdom has no layout engine.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverStub;
class DOMMatrixStub {
  m22 = 1;
}
Object.assign(globalThis, { DOMMatrixReadOnly: DOMMatrixStub });
// Virtualized tables measure their scroll box; jsdom lays nothing out, so give every box a panel size.
Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 400 });
Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 800 });

// Monaco needs a real browser (workers, layout). Tests drive a plain textbox with the same
// contract; the real editor is checked in the browser.
// plotly.js needs a real browser (canvas, layout). Tests check what is drawn; Chrome checks the drawing.
vi.mock("../src/views/PlotlyFigure.tsx", () => ({
  default: ({ label }: { label: string }) => createElement("div", { role: "img", "aria-label": label }),
}));

vi.mock("../src/views/MonacoCode.tsx", () => ({
  default: ({ value, label, onChange, onRun, readOnly }: CodeInputProps) =>
    createElement("textarea", {
      "aria-label": label,
      value,
      readOnly,
      onChange: (e: { target: { value: string } }) => onChange(e.target.value),
      onKeyDown: (e: { key: string; shiftKey: boolean; preventDefault: () => void; currentTarget: { value: string } }) => {
        if (e.key === "Enter" && e.shiftKey) {
          e.preventDefault();
          onRun(e.currentTarget.value);
        }
      },
    }),
}));

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
beforeEach(() => {
  useSelection.setState({ nav: "Flow", pipelineVersionId: undefined, runId: undefined, nodeId: undefined, compare: [] });
  useWorkbench.setState({ activity: "steps", editing: false, dock: undefined });
  useCanvasDetail.setState({ level: "detail" });
  useResultLayout.setState({ layout: "inline" });
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());
