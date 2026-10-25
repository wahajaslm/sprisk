import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { createElement } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";

import type { CodeInputProps } from "../src/views/CodeInput.tsx";

import { useCanvasDetail, useResultLayout } from "../src/workbench/detail.ts";
import { useCanvasNotice } from "../src/views/flow/useStepActions.ts";
import { useCollapsed } from "../src/notebook/collapsed.ts";
import { useOutputs } from "../src/notebook/outputs.ts";
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
// jsdom has no canvas: the design's charts (views/charts) draw nothing here. Tests check what
// is drawn and its label; Chrome checks the drawing.
Object.defineProperty(HTMLCanvasElement.prototype, "getContext", { configurable: true, value: () => null });

// plotly.js needs a real browser (canvas, layout). Tests check what is drawn; Chrome checks the drawing.
vi.mock("../src/views/PlotlyFigure.tsx", () => ({
  default: ({ label }: { label: string }) => createElement("div", { role: "img", "aria-label": label }),
}));

// Vega draws with a real browser's layout too; the same stand-in.
vi.mock("../src/views/VegaFigure.tsx", () => ({
  default: ({ label }: { label: string }) => createElement("div", { role: "img", "aria-label": label }),
}));

vi.mock("../src/views/MonacoCode.tsx", () => ({
  default: ({ value, label, onChange, onRun, onRunStay, onEscape, readOnly }: CodeInputProps) =>
    createElement("textarea", {
      "aria-label": label,
      value,
      readOnly,
      onChange: (e: { target: { value: string } }) => onChange(e.target.value),
      onKeyDown: (e: { key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; preventDefault: () => void; currentTarget: { value: string } }) => {
        if (e.key === "Enter" && e.shiftKey) {
          e.preventDefault();
          onRun(e.currentTarget.value);
        }
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          (onRunStay ?? onRun)(e.currentTarget.value);
        }
        if (e.key === "Escape") onEscape?.();
      },
    }),
}));

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
beforeEach(() => {
  useSelection.setState({ nav: "Flow", pipelineVersionId: undefined, runId: undefined, nodeId: undefined, notebookId: undefined, compare: [], experimentsTab: "Monitor" });
  useOutputs.setState({ byNotebook: {} });
  useCollapsed.setState({ byNotebook: {} });
  useWorkbench.setState({ activity: "steps", editing: false, dock: undefined });
  useCanvasDetail.setState({ level: "detail" });
  useResultLayout.setState({ layout: "inline" });
  useCanvasNotice.setState({ notice: undefined });
  // Saved UI preferences (the dock layout) never carry from one test to the next.
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());
