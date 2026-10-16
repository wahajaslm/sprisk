import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach } from "vitest";

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
