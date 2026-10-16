import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { StepTabLabel, StepToolbar } from "../src/views/inspector/step.tsx";
import { StepTab } from "../src/views/StepTab.tsx";
import { ViewInstance } from "../src/workbench/instance.tsx";
import { readTab } from "../src/workbench/inspectorTabs.ts";
import { LAYOUT_VERSION, restoreLayout } from "../src/workbench/layout.ts";
import { useSelection } from "../src/workbench/selection.ts";
import { PV, RUN } from "./fixtures.ts";
import { renderWithApi } from "./render.tsx";

describe("each Inspector tab is its own dock panel", () => {
  it("follows the selection", async () => {
    renderWithApi(
      <ViewInstance pin={undefined} setPin={vi.fn()} tab="history">
        <StepToolbar />
        <StepTab />
      </ViewInstance>,
    );
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "split" });
    expect(await screen.findByRole("table", { name: "Runs of this step" })).toHaveTextContent("2 attempts");
    expect(screen.getByText("split")).toBeInTheDocument();
  });

  it("a pinned panel keeps its step when the selection moves", async () => {
    renderWithApi(
      <ViewInstance pin={{ runId: RUN, nodeId: "split" }} setPin={vi.fn()} tab="history">
        <StepToolbar />
        <StepTab />
      </ViewInstance>,
    );
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "score" });
    expect(await screen.findByRole("table", { name: "Runs of this step" })).toHaveTextContent("2 attempts");
    await waitFor(() => expect(screen.getByText("split")).toBeInTheDocument());
  });

  it("pins a panel to the shown run and step", async () => {
    const setPin = vi.fn();
    renderWithApi(
      <ViewInstance pin={undefined} setPin={setPin} tab="console">
        <StepToolbar />
      </ViewInstance>,
    );
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "split" });
    await userEvent.click(await screen.findByRole("button", { name: /Pin/ }));
    expect(setPin).toHaveBeenCalledWith({ runId: RUN, nodeId: "split" });
  });

  it("the dock tab label is muted when there is nothing to show", async () => {
    renderWithApi(
      <ViewInstance pin={undefined} setPin={undefined} tab="performance">
        <StepTabLabel />
      </ViewInstance>,
    );
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "split" });
    await waitFor(() => expect(screen.getByText("Performance")).toHaveClass("muted-tab"));
  });

  it("asks for a selection when nothing is selected", () => {
    renderWithApi(
      <ViewInstance pin={undefined} setPin={undefined} tab="console">
        <StepTab />
      </ViewInstance>,
    );
    expect(within(document.body).getByText("Select a step to see its console.")).toBeInTheDocument();
  });
});

describe("saved tab panels", () => {
  it("accepts only known tab names from a saved layout", () => {
    expect(readTab({ tab: "console" })).toBe("console");
    expect(readTab({ tab: "hologram" })).toBeUndefined();
    expect(readTab(null)).toBeUndefined();
  });

  it("keeps step-tab panels and drops the old single Inspector panel to a placeholder", () => {
    const saved = JSON.stringify({
      version: LAYOUT_VERSION,
      dock: { panels: { t: { id: "t", contentComponent: "step-tab" }, i: { id: "i", contentComponent: "inspector" } } },
    });
    expect(restoreLayout(saved)?.panels["t"]?.contentComponent).toBe("step-tab");
    expect(restoreLayout(saved)?.panels["i"]?.contentComponent).toBe("placeholder");
  });
});

describe("closed tabs can come back", () => {
  it("lists the tabs that are not open, in Inspector order", async () => {
    const { closedTabs } = await import("../src/workbench/inspectorTabs.ts");
    expect(closedTabs(["data", "history", "console"])).toEqual(["visuals", "inputs", "parameters", "code", "checks", "performance"]);
    expect(closedTabs([])).toHaveLength(9);
  });
});
