import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { readTab, TAB_DRAG_TYPE } from "../src/workbench/inspectorTabs.ts";
import { Inspector } from "../src/views/Inspector.tsx";
import { StepTab } from "../src/views/StepTab.tsx";
import { ViewInstance } from "../src/workbench/instance.tsx";
import { LAYOUT_VERSION, restoreLayout } from "../src/workbench/layout.ts";
import { useSelection } from "../src/workbench/selection.ts";
import { useWorkbench } from "../src/workbench/workbench.ts";
import { fakeDock, PV, RUN } from "./fixtures.ts";
import { renderWithApi } from "./render.tsx";

describe("inspector tabs in their own dock panels", () => {
  it("opens the shown tab in its own panel", async () => {
    const dock = fakeDock();
    useWorkbench.setState({ dock });
    renderWithApi(<Inspector />);
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "split" });
    await userEvent.click(await screen.findByRole("tab", { name: "History" }));
    await userEvent.click(screen.getByRole("button", { name: "Open History in its own panel" }));
    expect(dock.openTab).toHaveBeenCalledWith("history");
  });

  it("a tab can be dragged out of the inspector", async () => {
    renderWithApi(<Inspector />);
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "split" });
    const tab = await screen.findByRole("tab", { name: "Console" });
    expect(tab).toHaveAttribute("draggable", "true");
    const setData = vi.fn();
    fireEvent.dragStart(tab, { dataTransfer: { setData, effectAllowed: "" } });
    expect(setData).toHaveBeenCalledWith(TAB_DRAG_TYPE, "console");
  });

  it("a tab panel follows the selection", async () => {
    renderWithApi(
      <ViewInstance pin={undefined} setPin={vi.fn()} tab="history">
        <StepTab />
      </ViewInstance>,
    );
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "split" });
    expect(await screen.findByRole("table", { name: "Runs of this step" })).toHaveTextContent("2 attempts");
    expect(screen.getByText("split")).toBeInTheDocument();
  });

  it("a pinned tab panel keeps its step when the selection moves", async () => {
    renderWithApi(
      <ViewInstance pin={{ runId: RUN, nodeId: "split" }} setPin={vi.fn()} tab="history">
        <StepTab />
      </ViewInstance>,
    );
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "score" });
    expect(await screen.findByRole("table", { name: "Runs of this step" })).toHaveTextContent("2 attempts");
    await waitFor(() => expect(screen.getByText("split")).toBeInTheDocument());
  });

  it("pins a tab panel to the shown run and step", async () => {
    const setPin = vi.fn();
    renderWithApi(
      <ViewInstance pin={undefined} setPin={setPin} tab="console">
        <StepTab />
      </ViewInstance>,
    );
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "split" });
    await userEvent.click(await screen.findByRole("button", { name: /Pin/ }));
    expect(setPin).toHaveBeenCalledWith({ runId: RUN, nodeId: "split" });
  });
});

describe("saved tab panels", () => {
  it("accepts only known tab names from a saved layout", () => {
    expect(readTab({ tab: "console" })).toBe("console");
    expect(readTab({ tab: "hologram" })).toBeUndefined();
    expect(readTab(null)).toBeUndefined();
  });

  it("keeps step-tab panels when a layout is restored", () => {
    const saved = JSON.stringify({ version: LAYOUT_VERSION, dock: { panels: { t: { id: "t", contentComponent: "step-tab" } } } });
    expect(restoreLayout(saved)?.panels["t"]?.contentComponent).toBe("step-tab");
  });
});
