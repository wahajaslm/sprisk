import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { clampHeight, FlowInspector } from "../src/views/flow/FlowInspector.tsx";
import { useSelection } from "../src/workbench/selection.ts";
import { LAYOUT_KEY, LAYOUT_VERSION } from "../src/workbench/layout.ts";
import { useWorkbench } from "../src/workbench/workbench.ts";
import { PV, RUN } from "./fixtures.ts";
import { renderWithApi } from "./render.tsx";

const FAKE = ["Missing data treatment strategy", "31.2% · umami_score", "Drop columns ≥ threshold", "Rule details"];

describe("FlowInspector", () => {
  beforeEach(() => useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: undefined }));

  it("asks for a step before showing checks, and never shows a made-up rule", () => {
    renderWithApi(<FlowInspector />);

    expect(screen.getByText("Select a step in the flow to inspect its methodology.")).toBeInTheDocument();
    for (const fake of FAKE) expect(screen.queryByText(fake)).not.toBeInTheDocument();
  });

  it("shows the selected step's real checks", async () => {
    useSelection.setState({ nodeId: "model" });
    renderWithApi(<FlowInspector />);

    expect(await screen.findByText("No methodology check concerns this step.")).toBeInTheDocument();
    for (const fake of FAKE) expect(screen.queryByText(fake)).not.toBeInTheDocument();
  });

  it("is a dock: it registers its tab commands, and folds to its tab bar and back", async () => {
    useWorkbench.setState({ inspectorCollapsed: false, inspectorMaximized: false });
    renderWithApi(<FlowInspector />);
    await waitFor(() => expect(useWorkbench.getState().dock).toBeDefined());

    await userEvent.click(screen.getByRole("button", { name: "Collapse panel" }));
    expect(screen.getByRole("region", { name: "Flow Inspector" })).toHaveClass("collapsed");
    await userEvent.click(screen.getByRole("button", { name: "Expand panel" }));
    expect(screen.getByRole("region", { name: "Flow Inspector" })).not.toHaveClass("collapsed");
  });

  it("can float its tabs out of the panel", async () => {
    renderWithApi(<FlowInspector />);
    expect(await screen.findByRole("button", { name: "Float panel" })).toBeInTheDocument();
  });

  it("remembers its tabs: a tab closed stays closed when the page opens again", async () => {
    const first = renderWithApi(<FlowInspector />);
    const tab = { selector: ".dock-tab" };
    fireEvent(await screen.findByText("History", tab), new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    await waitFor(() => expect(screen.queryByText("History", tab)).toBeNull());
    first.unmount();

    renderWithApi(<FlowInspector />);
    expect(await screen.findByText("Code", tab)).toBeInTheDocument();
    expect(screen.queryByText("History", tab)).toBeNull();
  });

  it("opens on the default tabs when the saved layout cannot be read", async () => {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify({ version: LAYOUT_VERSION, dock: { grid: "broken", panels: {} } }));
    renderWithApi(<FlowInspector />);
    expect(await screen.findByText("History", { selector: ".dock-tab" })).toBeInTheDocument();
  });

  it("shows a saved tab this version does not know as a placeholder", async () => {
    // Closing a tab saves the layout.
    const first = renderWithApi(<FlowInspector />);
    fireEvent(await screen.findByText("Performance", { selector: ".dock-tab" }), new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    await waitFor(() => expect(localStorage.getItem(LAYOUT_KEY)).not.toBeNull());
    first.unmount();
    const saved = JSON.parse(localStorage.getItem(LAYOUT_KEY)!) as { dock: { panels: Record<string, { params: { tab: string } }> } };
    saved.dock.panels["step-history"]!.params.tab = "telepathy";
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(saved));

    renderWithApi(<FlowInspector />);
    // Only the open tab draws its content.
    const [placeholderTab] = (await screen.findAllByText("History")).filter((e) => e.closest('[role="menu"]') === null);
    await userEvent.click(placeholderTab!);
    expect(await screen.findByText("This tab is no longer available. Close it, and reopen tabs from +.")).toBeInTheDocument();
  });

  it("keeps a dragged height between 120 and 620 pixels", () => {
    expect(clampHeight(40)).toBe(120);
    expect(clampHeight(300)).toBe(300);
    expect(clampHeight(900)).toBe(620);
  });
});
