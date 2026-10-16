import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { createElement } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";

import type { CodeInputProps } from "../src/views/CodeInput.tsx";

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

// Monaco needs a real browser (workers, layout). Tests drive a plain textbox with the same
// contract; the real editor is checked in the browser.
vi.mock("../src/views/MonacoCode.tsx", () => ({
  default: ({ value, label, onChange, onRun }: CodeInputProps) =>
    createElement("textarea", {
      "aria-label": label,
      value,
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
  useSelection.setState({ nav: "Flow", pipelineVersionId: undefined, runId: undefined, nodeId: undefined });
  useWorkbench.setState({ activity: "steps", editing: false, dock: undefined });
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());
