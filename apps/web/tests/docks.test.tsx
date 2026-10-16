import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { StepTabLabel, StepToolbar } from "../src/views/inspector/step.tsx";
import { StepTab } from "../src/views/StepTab.tsx";
import { ViewInstance } from "../src/workbench/instance.tsx";
import { readTab } from "../src/workbench/inspectorTabs.ts";
import { LAYOUT_VERSION, restoreLayout } from "../src/workbench/layout.ts";
import { useSelection } from "../src/workbench/selection.ts";
import { useWorkbench } from "../src/workbench/workbench.ts";
import { fakeDock, PV, RUN } from "./fixtures.ts";
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

describe("every step shows its code", () => {
  it("a built-in step's Code tab shows its real source, read-only", async () => {
    const { http, HttpResponse } = await import("msw");
    const { server } = await import("./server.ts");
    server.use(
      http.get("/api/operators/:id/source", ({ params }) =>
        HttpResponse.json({
          operator: params.id,
          path: "sprisk_validation/random_split.py",
          language: "python",
          text: "def random_split(params, inputs, out_dir):\n    ...\n",
          digest: `sha256:${"a".repeat(64)}`,
        }),
      ),
    );
    renderWithApi(
      <ViewInstance pin={undefined} setPin={undefined} tab="code">
        <StepTab />
      </ViewInstance>,
    );
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "split" });
    const code = await screen.findByRole("textbox", { name: /random_split\.py/ });
    expect(code).toHaveValue("def random_split(params, inputs, out_dir):\n    ...\n");
    expect(code).toHaveAttribute("readonly");
    expect(screen.queryByText(/Built-in step/)).toBeNull();
  });
});

describe("charts (ADR-0023)", () => {
  it("adds a chart of a table and opens it in Visualizations", async () => {
    const { http, HttpResponse } = await import("msw");
    const { server } = await import("./server.ts");
    const { pipeline, run } = await import("./fixtures.ts");
    const posted: { nodes: { id: string; operator: string; params: unknown }[] }[] = [];
    server.use(
      http.post("/api/pipeline_versions", async ({ request }) => {
        const body = (await request.json()) as (typeof posted)[number];
        posted.push(body);
        return HttpResponse.json(body, { status: 201 });
      }),
      http.post("/api/runs", () => HttpResponse.json({ ...run, status: "queued" }, { status: 202 })),
    );
    const dock = fakeDock();
    useWorkbench.setState({ dock });
    renderWithApi(
      <ViewInstance pin={undefined} setPin={undefined} tab="data">
        <StepTab />
      </ViewInstance>,
    );
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "load" });
    await userEvent.click(await screen.findByRole("button", { name: "Chart" }));
    const form = screen.getByRole("form", { name: "New chart" });
    await userEvent.selectOptions(within(form).getByRole("combobox", { name: "Chart" }), "histogram");
    await userEvent.selectOptions(within(form).getByRole("combobox", { name: "x" }), "sepal_length");
    await userEvent.click(within(form).getByRole("button", { name: "Add chart" }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]!.nodes.at(-1)).toEqual({ id: "chart_1", operator: "sprisk.profile.chart@1.0.0", params: { kind: "histogram", x: "sepal_length" } });
    expect(pipeline.nodes.some((n) => n.id === "chart_1")).toBe(false);
    await waitFor(() => expect(dock.showTab).toHaveBeenCalledWith("visuals"));
  });
});

describe("a chart step's Visualizations", () => {
  it("draws the chart from the step's aggregated numbers", async () => {
    const { http, HttpResponse } = await import("msw");
    const { server } = await import("./server.ts");
    const { attempts, pipeline, scoreOutputs } = await import("./fixtures.ts");
    const chartPipeline = {
      ...pipeline,
      nodes: [...pipeline.nodes, { id: "chart_1", operator: "sprisk.profile.chart@1.0.0", params: { kind: "histogram", x: "x" } }],
      edges: [...pipeline.edges, { from: "load.data", to: "chart_1.data" }],
    };
    const chartAttempt = { ...attempts[1]!, id: "att_01JABCDEFGHJKMNPQRSTVWXY77", node_id: "chart_1" };
    const output = { port: "chart", artifact: { ...scoreOutputs[0]!.artifact, id: "art_01JABCDEFGHJKMNPQRSTVWXY77", size_bytes: 200 } };
    const report = { kind: "histogram", x: "x", n_rows: 3, bins: [{ lower: 0, upper: 1, count: 3 }], missing: 0 };
    server.use(
      http.get("/api/pipeline_versions", () => HttpResponse.json([chartPipeline])),
      http.get(`/api/runs/${RUN}/attempts`, () => HttpResponse.json([...attempts, chartAttempt])),
      http.get(`/api/attempts/${chartAttempt.id}/outputs`, () => HttpResponse.json([output])),
      http.get(`/api/artifacts/${output.artifact.id}/content`, () => HttpResponse.text(JSON.stringify(report))),
    );
    renderWithApi(
      <ViewInstance pin={undefined} setPin={undefined} tab="visuals">
        <StepTab />
      </ViewInstance>,
    );
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "chart_1" });
    const figure = await screen.findByRole("figure", { name: "histogram of x" });
    expect(figure).toHaveAttribute("data-kind", "histogram");
  });
});
