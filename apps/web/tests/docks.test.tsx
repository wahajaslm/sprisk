import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { StepTabLabel } from "../src/views/inspector/step.tsx";
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
        <StepTab />
      </ViewInstance>,
    );
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "split" });
    expect(await screen.findByRole("table", { name: "Runs of this step" })).toHaveTextContent("2 attempts");
  });

  it("a pinned panel keeps its step when the selection moves, and its tab names that step", async () => {
    const pin = { runId: RUN, nodeId: "split" };
    renderWithApi(
      <>
        <ViewInstance pin={pin} setPin={vi.fn()} tab="history">
          <StepTabLabel />
        </ViewInstance>
        <ViewInstance pin={pin} setPin={vi.fn()} tab="history">
          <StepTab />
        </ViewInstance>
      </>,
    );
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "score" });
    expect(await screen.findByRole("table", { name: "Runs of this step" })).toHaveTextContent("2 attempts");
    expect(screen.getByText(/History/)).toHaveTextContent("History · split");
    expect(screen.getByRole("button", { name: "Unpin History" })).toHaveAttribute("aria-pressed", "true");
  });

  it("pins a panel to the shown run and step from the pin on its tab", async () => {
    const setPin = vi.fn();
    renderWithApi(
      <ViewInstance pin={undefined} setPin={setPin} tab="console">
        <StepTabLabel />
      </ViewInstance>,
    );
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "split" });
    await userEvent.click(await screen.findByRole("button", { name: "Pin Console to this run and step" }));
    expect(setPin).toHaveBeenCalledWith({ runId: RUN, nodeId: "split" });
  });

  it("a tab has no pin before there is a run to pin to", () => {
    renderWithApi(
      <ViewInstance pin={undefined} setPin={vi.fn()} tab="console">
        <StepTabLabel />
      </ViewInstance>,
    );
    expect(screen.queryByRole("button", { name: /Pin/ })).toBeNull();
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

describe("charts come only from code (ADR-0032)", () => {
  it("no step offers a Chart button, in Data or in Visualizations", async () => {
    renderWithApi(
      <>
        <ViewInstance pin={undefined} setPin={undefined} tab="data">
          <StepTab />
        </ViewInstance>
        <ViewInstance pin={undefined} setPin={undefined} tab="visuals">
          <StepTab />
        </ViewInstance>
      </>,
    );
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "load" });
    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(screen.getByText(/This step draws no figures/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Chart" })).toBeNull();
  });
});

describe("Visualizations show what Python drew (ADR-0024)", () => {
  async function chartStep(items: { library: string; format: string; title?: string; content: string }[]) {
    const { http, HttpResponse } = await import("msw");
    const { server } = await import("./server.ts");
    const { attempts, pipeline, run, scoreOutputs } = await import("./fixtures.ts");
    const chartPipeline = {
      ...pipeline,
      nodes: [...pipeline.nodes, { id: "chart_1", operator: "sprisk.profile.chart@1.0.0", params: { kind: "histogram", x: "sepal_length", bins: 10 } }],
      edges: [...pipeline.edges, { from: "load.data", to: "chart_1.data" }],
    };
    const chartAttempt = { ...attempts[1]!, id: "att_01JABCDEFGHJKMNPQRSTVWXY77", node_id: "chart_1" };
    const output = { port: "chart", artifact: { ...scoreOutputs[0]!.artifact, id: "art_01JABCDEFGHJKMNPQRSTVWXY77", size_bytes: 200 } };
    const posted: { nodes: { id: string; params: unknown }[] }[] = [];
    server.use(
      http.get("/api/pipeline_versions", () => HttpResponse.json([chartPipeline])),
      http.get(`/api/runs/${RUN}/attempts`, () => HttpResponse.json([...attempts, chartAttempt])),
      http.get(`/api/attempts/${chartAttempt.id}/outputs`, () => HttpResponse.json([output])),
      http.get(`/api/artifacts/${output.artifact.id}/content`, () => HttpResponse.text(JSON.stringify({ items }))),
      http.post("/api/pipeline_versions", async ({ request }) => {
        const body = (await request.json()) as (typeof posted)[number];
        posted.push(body);
        return HttpResponse.json(body, { status: 201 });
      }),
      http.post("/api/runs", () => HttpResponse.json({ ...run, status: "queued" }, { status: 202 })),
    );
    return posted;
  }
  const show = (tab: "visuals" | "parameters" | "data") =>
    renderWithApi(
      <ViewInstance pin={undefined} setPin={undefined} tab={tab}>
        <StepTab />
      </ViewInstance>,
    );
  const plotly = (title: string) => ({ library: "plotly", format: "plotly_json", title, content: '{"data": [], "layout": {}}' });

  it("shows every figure on a step's figure ports: Plotly drawn, SVG as an image", async () => {
    await chartStep([plotly("histogram of x"), { library: "matplotlib", format: "svg", content: "<svg xmlns='http://www.w3.org/2000/svg'></svg>" }]);
    show("visuals");
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "chart_1" });
    expect(await screen.findByRole("img", { name: "histogram of x" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Figure 2" })).toHaveAttribute("src", expect.stringMatching(/^data:image\/svg\+xml/));
  });

  it("puts chart choices above the figure, not in Parameters, and redraws on change", async () => {
    const posted = await chartStep([plotly("histogram of sepal_length")]);
    show("visuals");
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "chart_1" });
    const kind = await screen.findByRole("combobox", { name: "kind" });
    expect(kind).toHaveValue("histogram");
    const x = screen.getByRole("combobox", { name: "x" });
    await waitFor(() => expect(within(x).getAllByRole("option").map((o) => o.textContent)).toEqual(["sepal_length", "species"]));
    await userEvent.selectOptions(kind, "box");
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]!.nodes.find((n) => n.id === "chart_1")?.params).toEqual({ kind: "box", x: "sepal_length", bins: 10 });
  });

  it("a figure set too large to draw offers a download instead of fetching it (ADR-0029)", async () => {
    const { http, HttpResponse } = await import("msw");
    const { server } = await import("./server.ts");
    const { attempts, pipeline, scoreOutputs } = await import("./fixtures.ts");
    const withChart = {
      ...pipeline,
      nodes: [...pipeline.nodes, { id: "chart_1", operator: "sprisk.profile.chart@1.0.0", params: { kind: "histogram", x: "x" } }],
      edges: [...pipeline.edges, { from: "load.data", to: "chart_1.data" }],
    };
    const chartAttempt = { ...attempts[1]!, id: "att_01JABCDEFGHJKMNPQRSTVWXY77", node_id: "chart_1" };
    const huge = { port: "chart", artifact: { ...scoreOutputs[0]!.artifact, id: "art_01JABCDEFGHJKMNPQRSTVWXY78", size_bytes: 12 * 1024 * 1024 } };
    let fetched = false;
    server.use(
      http.get("/api/pipeline_versions", () => HttpResponse.json([withChart])),
      http.get(`/api/runs/${RUN}/attempts`, () => HttpResponse.json([...attempts, chartAttempt])),
      http.get(`/api/attempts/${chartAttempt.id}/outputs`, () => HttpResponse.json([huge])),
      http.get(`/api/artifacts/${huge.artifact.id}/content`, () => {
        fetched = true;
        return HttpResponse.text("{}");
      }),
    );
    show("visuals");
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "chart_1" });
    expect(await screen.findByText(/Too large to draw here \(12 MB\)/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download" })).toHaveAttribute("href", `/api/artifacts/${huge.artifact.id}/content?download=true`);
    expect(fetched).toBe(false);
  });

  it("figures are never shown as data", async () => {
    await chartStep([plotly("one")]);
    show("data");
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "chart_1" });
    expect(await screen.findByText("This step produces no data.")).toBeInTheDocument();
  });

  it("Parameters keeps only settings that are not about the view", async () => {
    await chartStep([]);
    show("parameters");
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "chart_1" });
    const settings = await screen.findByRole("region", { name: "Settings" });
    expect(within(settings).getByRole("spinbutton", { name: "bins" })).toBeInTheDocument();
    expect(within(settings).queryByRole("combobox", { name: "kind" })).toBeNull();
    expect(screen.getByText(/kind, x and y are set in Visualizations/)).toBeInTheDocument();
  });

  it("several figures can be shown inline or as a grid", async () => {
    await chartStep([plotly("one"), plotly("two")]);
    show("visuals");
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "chart_1" });
    await screen.findByRole("img", { name: "two" });
    await userEvent.click(screen.getByRole("radio", { name: "Grid" }));
    expect(screen.getByRole("region", { name: "Figures" })).toHaveClass("grid");
  });

});

describe("the code decides the tabs (ADR-0025)", () => {
  it("a file the step reads is an input, never a parameter", async () => {
    renderWithApi(
      <>
        <ViewInstance pin={undefined} setPin={undefined} tab="inputs">
          <StepTab />
        </ViewInstance>
        <ViewInstance pin={undefined} setPin={undefined} tab="parameters">
          <StepTab />
        </ViewInstance>
      </>,
    );
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "load" });
    const inputs = await screen.findByRole("region", { name: "Input tables" });
    expect(within(inputs).getByText("path")).toBeInTheDocument();
    expect(within(inputs).getByText("/d/iris.csv")).toBeInTheDocument();
    const settings = await screen.findByRole("region", { name: "Settings" });
    expect(within(settings).queryByRole("textbox", { name: "path" })).toBeNull();
    expect(within(settings).getByRole("combobox", { name: "format" })).toBeInTheDocument();
  });
});

describe("Console for every step (ADR-0025)", () => {
  it("shows what a built-in step printed and warned, and keeps it out of Data", async () => {
    const { http, HttpResponse } = await import("msw");
    const { server } = await import("./server.ts");
    const { attempts, loadOutputs, scoreOutputs } = await import("./fixtures.ts");
    const load = attempts.filter((a) => a.node_id === "load").at(-1)!;
    const consoleOut = { port: "console", artifact: { ...scoreOutputs[0]!.artifact, id: "art_01JABCDEFGHJKMNPQRSTVWXC01", size_bytes: 100 } };
    const printed = { items: [{ kind: "text", channel: "stdout", text: "read 120 rows\n" }, { kind: "text", channel: "stderr", text: "UserWarning: 3 empty rows\n" }] };
    server.use(
      http.get(`/api/attempts/${load.id}/outputs`, () => HttpResponse.json([...loadOutputs, consoleOut])),
      http.get(`/api/artifacts/${consoleOut.artifact.id}/content`, () => HttpResponse.text(JSON.stringify(printed))),
    );
    renderWithApi(
      <>
        <ViewInstance pin={undefined} setPin={undefined} tab="console">
          <StepTab />
        </ViewInstance>
        <ViewInstance pin={undefined} setPin={undefined} tab="data">
          <StepTab />
        </ViewInstance>
      </>,
    );
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "load" });
    const out = await screen.findByRole("region", { name: "Printed output" });
    expect(out).toHaveTextContent("read 120 rows");
    expect(within(out).getByText(/3 empty rows/).closest("[data-channel]")).toHaveAttribute("data-channel", "stderr");
    await screen.findByRole("table", { name: "data rows" });
    expect(screen.queryByRole("tab", { name: "console" })).toBeNull();
  });
});

describe("a chart step from an older flow version (ADR-0032)", () => {
  async function loadWithChart() {
    const { http, HttpResponse } = await import("msw");
    const { server } = await import("./server.ts");
    const { attempts, pipeline, run, scoreOutputs } = await import("./fixtures.ts");
    const withChart = {
      ...pipeline,
      nodes: [...pipeline.nodes, { id: "chart_1", operator: "sprisk.profile.chart@1.0.0", params: { kind: "histogram", x: "sepal_length" } }],
      edges: [...pipeline.edges, { from: "load.data", to: "chart_1.data" }],
    };
    const chartAttempt = { ...attempts[1]!, id: "att_01JABCDEFGHJKMNPQRSTVWXY77", node_id: "chart_1" };
    const output = { port: "chart", artifact: { ...scoreOutputs[0]!.artifact, id: "art_01JABCDEFGHJKMNPQRSTVWXY77", size_bytes: 200 } };
    const figures = { items: [{ library: "plotly", format: "plotly_json", title: "histogram of sepal_length", content: '{"data": [], "layout": {}}' }] };
    const posted: { nodes: { id: string }[] }[] = [];
    server.use(
      http.get("/api/pipeline_versions", () => HttpResponse.json([withChart])),
      http.get(`/api/runs/${RUN}/attempts`, () => HttpResponse.json([...attempts, chartAttempt])),
      http.get(`/api/attempts/${chartAttempt.id}/outputs`, () => HttpResponse.json([output])),
      http.get(`/api/artifacts/${output.artifact.id}/content`, () => HttpResponse.text(JSON.stringify(figures))),
      http.post("/api/pipeline_versions", async ({ request }) => {
        const body = (await request.json()) as (typeof posted)[number];
        posted.push(body);
        return HttpResponse.json(body, { status: 201 });
      }),
      http.post("/api/runs", () => HttpResponse.json({ ...run, status: "queued" }, { status: 202 })),
    );
    return posted;
  }

  it("is an ordinary step: on the canvas, and not shown inside the step it reads", async () => {
    const { FlowCanvas } = await import("../src/views/FlowCanvas.tsx");
    await loadWithChart();
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "load" });
    renderWithApi(
      <>
        <FlowCanvas />
        <ViewInstance pin={undefined} setPin={undefined} tab="visuals">
          <StepTab />
        </ViewInstance>
      </>,
    );
    expect(await screen.findByRole("button", { name: /^chart_1/ })).toBeInTheDocument();
    expect(screen.getByText(/This step draws no figures/)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Chart chart_1" })).toBeNull();
  });
});

describe("editing a built-in step's code (ADR-0028)", () => {
  async function codeOf(source: string) {
    const { http, HttpResponse } = await import("msw");
    const { server } = await import("./server.ts");
    const { run } = await import("./fixtures.ts");
    const posted: { nodes: { id: string; code?: unknown }[] }[] = [];
    server.use(
      http.get("/api/operators/:id/source", ({ params }) =>
        HttpResponse.json({ operator: params.id, path: "m.py", language: "python", text: source, digest: `sha256:${"a".repeat(64)}` }),
      ),
      http.post("/api/pipeline_versions", async ({ request }) => {
        const body = (await request.json()) as (typeof posted)[number];
        posted.push(body);
        return HttpResponse.json(body, { status: 201 });
      }),
      http.post("/api/runs", () => HttpResponse.json({ ...run, status: "queued" }, { status: 202 })),
    );
    return posted;
  }
  const showCode = (nodeId: string) => {
    renderWithApi(
      <ViewInstance pin={undefined} setPin={undefined} tab="code">
        <StepTab />
      </ViewInstance>,
    );
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId });
  };

  it("Edit makes the code editable and Run saves it as the step's own code", async () => {
    const posted = await codeOf("def f(data):\n    return data\n");
    showCode("split");
    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const editor = screen.getByRole("textbox", { name: /m\.py/ });
    expect(editor).not.toHaveAttribute("readonly");
    await userEvent.clear(editor);
    await userEvent.type(editor, "def f(data):{Enter}    return data.head(1){Enter}");
    await userEvent.click(screen.getByRole("button", { name: /Run code/ }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]!.nodes.find((n) => n.id === "split")?.code).toEqual({ source: "def f(data):\n    return data.head(1)\n", function: "f" });
  });

  it("a step that reads files cannot be edited, and says why", async () => {
    await codeOf("def f(path, format):\n    ...\n");
    showCode("load");
    expect(await screen.findByText(/reads files/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });
});
