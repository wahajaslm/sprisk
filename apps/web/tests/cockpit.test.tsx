import type { Attempt } from "@sprisk/contracts";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import splitProposal from "../../../tests/contract/decision_proposal/valid/split.json";
import appliedDecision from "../../../tests/contract/methodology_decision/valid/applied.json";
import multicollinearity from "../../../tests/contract/methodology_rule/valid/multicollinearity.json";
import { FlowCanvas } from "../src/views/FlowCanvas.tsx";
import { Inspector } from "./inspector.tsx";
import { StepLibrary } from "../src/views/StepLibrary.tsx";
import { TopBar } from "../src/views/TopBar.tsx";
import { useSelection } from "../src/workbench/selection.ts";
import { useCanvasDetail } from "../src/workbench/detail.ts";
import { useWorkbench } from "../src/workbench/workbench.ts";
import { Copilot } from "../src/views/Copilot.tsx";
import {
  PV,
  RUN,
  attempts,
  checksJson,
  codeAttempt,
  gateOutputs,
  fakeDock,
  codeDisplayJson,
  codeOutputs,
  codePipeline,
  loadOutputs,
  notebookOperator,
  operators,
  pipeline,
  profilePage,
  run,
  scoreAttempt,
  scoreOutputs,
  tablePage,
} from "./fixtures.ts";
import { renderWithApi } from "./render.tsx";
import { server } from "./server.ts";

describe("top bar", () => {
  it("lists flows by their data file and switches between them", async () => {
    renderWithApi(<TopBar />);
    const switcher = await screen.findByRole("button", { name: "Project and flow" });
    await waitFor(() => expect(switcher).toHaveTextContent("iris.csv"));
    await userEvent.click(switcher);
    const option = within(screen.getByRole("listbox", { name: "Flows" })).getByRole("option", { name: /iris.csv/ });
    await userEvent.click(option);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("puts the project and flow switcher first, then the views including Objective, then Run flow", async () => {
    renderWithApi(<TopBar />);
    const bar = screen.getByRole("banner");
    const switcher = await within(bar).findByRole("button", { name: "Project and flow" });
    const nav = within(bar).getByRole("navigation");
    const tabs = within(nav).getAllByRole("button").map((b) => b.textContent);
    expect(tabs).toEqual(["Objective", "Flow", "Datasets", "Notebooks", "Methodology", "Experiments", "Deploy", "Reports", "Settings"]);
    expect(switcher.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(bar).getByRole("button", { name: /Run flow/ })).toBeInTheDocument();
    await waitFor(() => expect(useSelection.getState().pipelineVersionId).toBe(PV));
  });

  it("lists a flow once however many times it was edited", async () => {
    const edited = { ...pipeline, id: "plv_01JABCDEFGHJKMNPQRSTVWXYZ7", parent_id: PV };
    server.use(http.get("/api/pipeline_versions", () => HttpResponse.json([edited, pipeline])));
    renderWithApi(<TopBar />);
    await userEvent.click(await screen.findByRole("button", { name: "Project and flow" }));
    const options = within(screen.getByRole("listbox", { name: "Flows" })).getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent("2 versions");
    await userEvent.click(options[0]!);
    expect(useSelection.getState().pipelineVersionId).toBe(edited.id);
  });

  it("opens the newest flow, not a comparison saved after it", async () => {
    const comparison = { ...pipeline, id: "plv_01JABCDEFGHJKMNPQRSTVWXYZ8", compares: "mpr_01JABCDEFGHJKMNPQRSTVWXYZ0" };
    server.use(http.get("/api/pipeline_versions", () => HttpResponse.json([comparison, pipeline])));
    renderWithApi(<TopBar />);
    await waitFor(() => expect(useSelection.getState().pipelineVersionId).toBe(PV));
  });

  it("picking the flow that is already open keeps showing its latest run", async () => {
    renderWithApi(<TopBar />);
    await waitFor(() => expect(useSelection.getState().runId).toBe(RUN));
    await userEvent.click(screen.getByRole("button", { name: "Project and flow" }));
    await userEvent.click(within(screen.getByRole("listbox", { name: "Flows" })).getByRole("option", { name: /iris.csv/ }));
    await waitFor(() => expect(useSelection.getState().runId).toBe(RUN));
  });

  it("starts a run of the selected pipeline version", async () => {
    let posted: unknown;
    server.use(
      http.post("/api/runs", async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json({ ...run, status: "queued" }, { status: 202 });
      }),
    );
    renderWithApi(<TopBar />);
    await waitFor(() => expect(useSelection.getState().pipelineVersionId).toBe(PV));
    await userEvent.click(screen.getByRole("button", { name: /Run flow/ }));
    // Run flow runs from the start: nothing reused.
    await waitFor(() => expect(posted).toEqual({ pipeline_version_id: PV }));
  });

  it("shows why a run could not start", async () => {
    server.use(
      http.post("/api/runs", () =>
        HttpResponse.json({ errors: [{ code: "path_outside_data_roots", message: "node load: outside" }] }, { status: 422 }),
      ),
    );
    renderWithApi(<TopBar />);
    await waitFor(() => expect(useSelection.getState().pipelineVersionId).toBe(PV));
    await userEvent.click(screen.getByRole("button", { name: /Run flow/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("path_outside_data_roots");
  });
});

describe("step library", () => {
  it("groups registered operators by stage", async () => {
    renderWithApi(<StepLibrary />);
    const clean = await screen.findByRole("region", { name: "Clean" });
    expect(within(clean).getByText("Impute")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Model" })).getByText("Linear model")).toBeInTheDocument();
  });

  it("shows a step's description on hover only, so each row stays one line", async () => {
    const described = { ...operators[0]!, description: "Read a local CSV file." };
    server.use(http.get("/api/operators", () => HttpResponse.json([described])));
    renderWithApi(<StepLibrary />);
    expect(await screen.findByTitle(/Read a local CSV file\./)).toBeInTheDocument();
    expect(screen.queryByText("Read a local CSV file.")).toBeNull();
  });

  it("folds a stage away when its heading is clicked", async () => {
    renderWithApi(<StepLibrary />);
    const clean = await screen.findByRole("region", { name: "Clean" });
    const heading = within(clean).getByRole("button", { name: /Clean/ });
    await userEvent.click(heading);
    expect(heading).toHaveAttribute("aria-expanded", "false");
    expect(within(clean).queryByText("Impute")).toBeNull();
    await userEvent.click(heading);
    expect(within(clean).getByText("Impute")).toBeInTheDocument();
  });

  it("lists only the newest version of an operator", async () => {
    const v = (id: string) => ({ ...operators[0]!, id, capability_class: "analyzer" as const });
    server.use(
      http.get("/api/operators", () =>
        HttpResponse.json([v("sprisk.code.python@1.0.0"), v("sprisk.code.python@1.10.0"), v("sprisk.code.python@1.9.0")]),
      ),
    );
    renderWithApi(<StepLibrary />);
    const explore = await screen.findByRole("region", { name: "Explore" });
    expect(within(explore).getAllByText("Python")).toHaveLength(1);
    expect(within(explore).getByTitle(/sprisk.code.python@1.10.0/)).toBeInTheDocument();
  });

  it("tags each of the flow's steps with its latest attempt in the run, never a made-up state", async () => {
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: undefined });
    renderWithApi(<StepLibrary />);

    const split = (await screen.findByText("Random split")).closest(".step-item")!;
    expect(await within(split as HTMLElement).findByText("succeeded")).toBeInTheDocument();
    expect(screen.queryByText("Queued")).toBeNull();
  });

  it("tags a step that never ran as not run", async () => {
    useSelection.setState({ pipelineVersionId: PV, runId: undefined, nodeId: undefined });
    renderWithApi(<StepLibrary />);

    const split = (await screen.findByText("Random split")).closest(".step-item")!;
    expect(within(split as HTMLElement).getByText("Not run")).toBeInTheDocument();
  });

  it("counts the steps that read the selected step", async () => {
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "load" });
    renderWithApi(<StepLibrary />);

    expect(await screen.findByText("2 steps")).toBeInTheDocument();
    act(() => useSelection.setState({ nodeId: "score" }));
    expect(await screen.findByText("0 steps")).toBeInTheDocument();
  });

  it("tags a step that a methodology check did not pass", async () => {
    const failing = JSON.parse(checksJson).map((c: { verdict: string }) => ({ ...c, verdict: "fail" }));
    server.use(http.get("/api/artifacts/:id/content", () => HttpResponse.text(JSON.stringify(failing))));
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: undefined });
    renderWithApi(<StepLibrary />);

    const split = (await screen.findByText("Random split")).closest(".step-item")!;
    expect(await within(split as HTMLElement).findByText("1 check")).toBeInTheDocument();
  });

  it("shows why the run's attempts cannot be read, instead of tagging steps not run", async () => {
    server.use(http.get(`/api/runs/${RUN}/attempts`, () => HttpResponse.json({ errors: [{ code: "internal", message: "disk full" }] }, { status: 500 })));
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: undefined });
    renderWithApi(<StepLibrary />);

    expect(await screen.findByRole("alert")).toHaveTextContent("disk full");
  });

  it("shows why the checks cannot be read, instead of tagging steps clean", async () => {
    server.use(http.get("/api/artifacts/:id/content", () => HttpResponse.text("not json")));
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: undefined });
    renderWithApi(<StepLibrary />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/Unreadable methodology checks|JSON/);
  });

  it("has no Plugins tab, since there is nothing to list in it", async () => {
    renderWithApi(<StepLibrary />);
    await screen.findByRole("region", { name: "Clean" });
    expect(screen.queryByText("Plugins")).toBeNull();
  });

  it("filters steps by search", async () => {
    renderWithApi(<StepLibrary />);
    await screen.findByRole("region", { name: "Clean" });
    await userEvent.type(screen.getByRole("searchbox", { name: "Search steps" }), "split");
    expect(screen.getByText("Random split")).toBeInTheDocument();
    expect(screen.queryByText("Impute")).toBeNull();
  });
});

describe("flow canvas", () => {
  it("shows every step as a node with its name and latest state, with no stage boxes", async () => {
    useSelection.setState({ pipelineVersionId: PV, runId: RUN });
    useCanvasDetail.setState({ level: "compact" });
    renderWithApi(<FlowCanvas />);
    const split = await screen.findByRole("button", { name: /^split/ });
    // The kind of step on top, what it is about below (ADR-0055).
    await waitFor(() => expect(split).toHaveTextContent(/^Random split\s*split$/));
    expect(split.querySelector(".state-dot")).toHaveAccessibleName("succeeded");
    expect(document.querySelector(".stage-frame")).toBeNull();
    expect(screen.queryByRole("button", { name: /gate_b/ })).toBeNull();
  });

  it("places each step to the right of the steps it reads", async () => {
    const { flowPositions } = await import("../src/flow/layout.ts");
    const { nodes: at } = await flowPositions(pipeline, () => ({ width: 168, height: 44 }), () => undefined);
    const x = (id: string) => at.get(id)!.x;
    expect(x("load")).toBeLessThan(x("split"));
    expect(x("split")).toBeLessThan(x("model"));
    expect(x("model")).toBeLessThan(x("score"));
  });

  it("keeps a stage's steps together under its heading, with no box", async () => {
    const { flowPositions } = await import("../src/flow/layout.ts");
    const stage = (id: string) => (id === "model" || id === "score" ? "Model" : undefined);
    const { nodes: at, groups } = await flowPositions(pipeline, () => ({ width: 168, height: 44 }), stage);
    const [group] = groups;
    expect(group).toMatchObject({ id: "Model", count: 2 });
    for (const id of ["model", "score"]) {
      expect(at.get(id)!.x).toBeGreaterThanOrEqual(group!.x);
      expect(at.get(id)!.y).toBeGreaterThan(group!.y);
    }
  });

  it("stacks a stage's steps top to bottom, while stages still run left to right", async () => {
    const { flowPositions } = await import("../src/flow/layout.ts");
    const stage = (id: string) => (id === "model" || id === "score" ? "Model" : undefined);
    const { nodes: at } = await flowPositions(pipeline, () => ({ width: 168, height: 44 }), stage);
    expect(at.get("model")!.x).toBe(at.get("score")!.x);
    expect(at.get("model")!.y + 44).toBeLessThan(at.get("score")!.y);
    expect(at.get("split")!.x + 168).toBeLessThan(at.get("model")!.x);
  });

  it("stacks a stage's steps in one column even when they do not read each other", async () => {
    const { flowPositions } = await import("../src/flow/layout.ts");
    const scores = ["score_a", "score_b", "score_c"];
    const three = {
      ...pipeline,
      nodes: [pipeline.nodes[0]!, ...scores.map((id) => ({ id, operator: "sprisk.profile.summarize@1.0.0", params: {} }))],
      edges: scores.map((id) => ({ from: "load.data", to: `${id}.data` })),
    };
    const stage = (id: string) => (scores.includes(id) ? "Evaluate" : undefined);
    // Detail cards are tall: packing them for a pleasing shape would put them side by side.
    const { nodes: at } = await flowPositions(three, () => ({ width: 232, height: 176 }), stage);
    const [a, b, c] = scores.map((id) => at.get(id)!);
    expect([b!.x, c!.x]).toEqual([a!.x, a!.x]);
    expect(new Set([a!.y, b!.y, c!.y]).size).toBe(3);
  });

  it("groups steps of one stage only where they sit together in the flow", async () => {
    const { stageGroups } = await import("../src/notebook/stageNotebooks.ts");
    const byRef = new Map(operators.map((o) => [o.id, o]));
    const groups = stageGroups(pipeline, byRef);
    // profile looks at all loaded rows, so it shares Load's heading.
    expect(groups.get("profile")).toBe(groups.get("load"));
    // split is the only Split step; impute (Clean) is apart from the Explore steps.
    expect(groups.get("split")).not.toBe(groups.get("impute"));
    expect(groups.get("split")?.startsWith("Split")).toBe(true);
  });

  it("puts each grouped step inside its stage, so dragging the heading moves the group", async () => {
    const { flowGraph } = await import("../src/views/FlowCanvas.tsx");
    const byRef = new Map(operators.map((o) => [o.id, o]));
    const at = new Map([["split", { x: 110, y: 50 }]]);
    const groups = [{ id: "Split#split", count: 1, x: 100, y: 20, width: 200, height: 90 }];
    const { nodes } = flowGraph(pipeline, byRef, new Map(), undefined, "compact", new Map(), at, groups);
    const stage = nodes.find((n) => n.id === "stage:Split#split")!;
    const split = nodes.find((n) => n.id === "split")!;
    expect(stage).toMatchObject({ draggable: true, dragHandle: ".stage-head", height: 90 });
    expect(split).toMatchObject({ parentId: "stage:Split#split", position: { x: 10, y: 30 } });
  });

  it("gives every compact card the Flow Studio size, whatever its title (ADR-0061)", async () => {
    const { flowGraph } = await import("../src/views/FlowCanvas.tsx");
    const { NODE_SIZE } = await import("../src/workbench/detail.ts");
    const byRef = new Map(operators.map((o) => [o.id, o]));
    const width = (title: string) => {
      const titled = { ...pipeline, nodes: pipeline.nodes.map((n) => (n.id === "split" ? { ...n, title } : n)) };
      return flowGraph(titled, byRef, new Map(), undefined, "compact", new Map(), new Map()).nodes.find((n) => n.id === "split")!.width!;
    };
    // A long title is cut short on the card, so the canvas keeps one grid of equal steps.
    expect(width("Stratified train/test split by class")).toBe(NODE_SIZE.compact.width);
    expect(width("Split")).toBe(NODE_SIZE.compact.width);
  });

  it("links steps of one stage top to bottom, and stages side to side", async () => {
    const { flowGraph } = await import("../src/views/FlowCanvas.tsx");
    const byRef = new Map(operators.map((o) => [o.id, o]));
    const { edges } = flowGraph(pipeline, byRef, new Map(), undefined, "compact", new Map(), new Map());
    const edge = (from: string, to: string) => edges.find((e) => e.source === from && e.target === to)!;
    expect(edge("load", "profile")).toMatchObject({ sourceHandle: "down", targetHandle: "top" });
    expect(edge("load", "split")).toMatchObject({ sourceHandle: "out", targetHandle: "in" });
  });

  it("shows a heading above each stage, without a step count", async () => {
    useSelection.setState({ pipelineVersionId: PV, runId: RUN });
    renderWithApi(<FlowCanvas />);
    const heading = await screen.findByRole("heading", { name: /Split/ });
    expect(heading).toHaveTextContent(/^Split$/);
  });

  it("Tidy puts every step back where the layout places it", async () => {
    useSelection.setState({ pipelineVersionId: PV, runId: RUN });
    renderWithApi(<FlowCanvas />);
    await screen.findByRole("button", { name: /^split/ });
    await userEvent.click(screen.getByRole("button", { name: "Tidy" }));
    expect(screen.getByRole("button", { name: /^split/ })).toBeInTheDocument();
  });

  it("Undo and Redo buttons are present on canvas and toggle after tidy", async () => {
    useSelection.setState({ pipelineVersionId: PV, runId: RUN });
    renderWithApi(<FlowCanvas />);
    await screen.findByRole("button", { name: /^split/ });
    const undoBtn = screen.getByRole("button", { name: "Undo" });
    const redoBtn = screen.getByRole("button", { name: "Redo" });
    expect(undoBtn).toBeDisabled();
    expect(redoBtn).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Tidy" }));
    expect(undoBtn).not.toBeDisabled();
    await userEvent.click(undoBtn);
    expect(redoBtn).not.toBeDisabled();
  });

  it("encapsulateStages dynamically expands stage dimensions to enclose moved child steps", async () => {
    const { encapsulateStages } = await import("../src/views/FlowCanvas.tsx");
    const testNodes: any[] = [
      {
        id: "stage:Split#split",
        type: "stage",
        position: { x: 100, y: 100 },
        width: 280,
        height: 480,
        data: { name: "Split", count: 1, active: false, baseWidth: 280, baseHeight: 480 },
      },
      {
        id: "split",
        type: "step",
        parentId: "stage:Split#split",
        position: { x: 350, y: 550 },
        width: 200,
        height: 80,
        data: {},
      },
    ];
    const { STAGE_FOOTER_HEIGHT, STAGE_PAD_X } = await import("../src/flow/layout.ts");
    const encapsulated = encapsulateStages(testNodes);
    const stage = encapsulated.find((n) => n.id === "stage:Split#split")!;
    // The child's right edge (350 + 200) and bottom edge (550 + 80), plus the stage's padding.
    expect(stage.width).toBe(350 + 200 + STAGE_PAD_X);
    expect(stage.height).toBe(550 + 80 + STAGE_FOOTER_HEIGHT + 24);
  });

  it("right-click on a step opens its actions", async () => {
    const dock = fakeDock();
    useWorkbench.setState({ dock });
    const writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    useSelection.setState({ pipelineVersionId: PV, runId: RUN });
    renderWithApi(<FlowCanvas />);
    fireEvent.contextMenu(await screen.findByRole("button", { name: /^split/ }));
    const menu = screen.getByRole("menu", { name: "split" });
    await userEvent.click(within(menu).getByRole("menuitem", { name: "Open code" }));
    expect(useSelection.getState().nodeId).toBe("split");
    expect(dock.showTab).toHaveBeenCalledWith("code");
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.contextMenu(screen.getByRole("button", { name: /^split/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Copy step id" }));
    expect(writeText).toHaveBeenCalledWith("split");

    fireEvent.contextMenu(screen.getByRole("button", { name: /^split/ }));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("right-click removes a step nothing reads, as a new version; a step others read stays", async () => {
    const posted: { parent_id?: string; nodes: { id: string }[]; edges: { to: string }[] }[] = [];
    server.use(
      http.post("/api/pipeline_versions", async ({ request }) => {
        const body = (await request.json()) as (typeof posted)[number];
        posted.push(body);
        return HttpResponse.json(body, { status: 201 });
      }),
      http.post("/api/runs", () => HttpResponse.json({ ...run, id: "run_01JABCDEFGHJKMNPQRSTVWXYZ8" }, { status: 202 })),
    );
    useSelection.setState({ pipelineVersionId: PV, runId: RUN });
    renderWithApi(<FlowCanvas />);

    fireEvent.contextMenu(await screen.findByRole("button", { name: /^split/ }));
    expect(screen.getByRole("menuitem", { name: "Remove step" })).toBeDisabled();
    await userEvent.keyboard("{Escape}");

    fireEvent.contextMenu(screen.getByRole("button", { name: /^profile/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Remove step" }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]!.parent_id).toBe(PV);
    expect(posted[0]!.nodes.some((n) => n.id === "profile")).toBe(false);
    expect(posted[0]!.edges.some((e) => e.to.startsWith("profile."))).toBe(false);
  });

  it("selecting a node opens it in the inspector", async () => {
    useSelection.setState({ pipelineVersionId: PV, runId: RUN });
    renderWithApi(<FlowCanvas />);
    // A plain click: jsdom cannot run React Flow's drag handling behind a full pointer sequence.
    fireEvent.click(await screen.findByRole("button", { name: /^score/ }));
    expect(useSelection.getState().nodeId).toBe("score");
  });

  it("shows an API error instead of an empty canvas", async () => {
    server.use(
      http.get("/api/pipeline_versions", () =>
        HttpResponse.json({ errors: [{ code: "internal", message: "database is locked" }] }, { status: 500 }),
      ),
    );
    useSelection.setState({ pipelineVersionId: PV });
    renderWithApi(<FlowCanvas />);
    expect(await screen.findByRole("alert")).toHaveTextContent("database is locked");
  });
});

describe("inspector", () => {
  it("Result tab shows an evaluator's metrics as tiles, not raw JSON", async () => {
    renderWithApi(<Inspector />);
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "score" });
    expect(within(await screen.findByRole("group", { name: "accuracy" })).getByText("0.947")).toBeInTheDocument();
    expect(screen.getByText(/LogisticRegression · scored on 38 held-out rows/)).toBeInTheDocument();
    expect(screen.queryByText(/application\/json/)).toBeNull();
  });

  it("each metric tile shows the change since the previous run", async () => {
    const older = { ...run, id: "run_01JABCDEFGHJKMNPQRSTVWXYZ1" };
    const olderScore = { ...scoreAttempt, id: "att_01JABCDEFGHJKMNPQRSTVWXY55", run_id: older.id };
    const olderMetrics = { ...scoreOutputs[0]!, artifact: { ...scoreOutputs[0]!.artifact, id: "art_01JABCDEFGHJKMNPQRSTVWXY55" } };
    server.use(
      http.get("/api/runs", () => HttpResponse.json([run, older])),
      http.get(`/api/runs/${older.id}/attempts`, () => HttpResponse.json([olderScore])),
      http.get(`/api/attempts/${olderScore.id}/outputs`, () => HttpResponse.json([olderMetrics])),
      http.get(`/api/artifacts/${olderMetrics.artifact.id}/content`, () => HttpResponse.text('{"accuracy": 0.9}')),
    );
    renderWithApi(<Inspector />);
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "score" });
    const tile = await screen.findByRole("group", { name: "accuracy" });
    await waitFor(() => expect(tile).toHaveTextContent("▲ 0.047 vs last run"));
  });

  it("History compares an earlier run with the shown one in Experiments", async () => {
    const older = { ...run, id: "run_01JABCDEFGHJKMNPQRSTVWXYZ1" };
    server.use(
      http.get("/api/runs", () => HttpResponse.json([run, older])),
      http.get(`/api/runs/${older.id}/attempts`, () => HttpResponse.json([])),
    );
    renderWithApi(<Inspector />);
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "score" });
    await userEvent.click(await screen.findByRole("tab", { name: "History" }));
    await userEvent.click(await screen.findByRole("button", { name: "Compare run #1 with the shown run" }));
    expect(useSelection.getState()).toMatchObject({ nav: "Experiments", experimentsTab: "Compare", compare: [older.id, RUN] });
  });

  it("the tab line holds only the tabs: no step name, state or settings", async () => {
    renderWithApi(<Inspector setPin={vi.fn()} />);
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "score" });
    await screen.findByRole("group", { name: "accuracy" });
    expect(screen.getByRole("tablist", { name: "Inspector" })).not.toHaveTextContent("score");
    expect(screen.queryByText(/Evaluate · /)).toBeNull();
  });

  it("Data and History have no Technical switch", async () => {
    renderWithApi(<Inspector />);
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "score" });
    await screen.findByRole("group", { name: "accuracy" });
    expect(screen.queryByRole("checkbox", { name: "Technical" })).toBeNull();
    await userEvent.click(await screen.findByRole("tab", { name: /History/ }));
    await screen.findByRole("table", { name: "Runs of this step" });
    expect(screen.queryByRole("checkbox", { name: "Technical" })).toBeNull();
  });

  it("History tab lists the run and, below, every attempt with its error", async () => {
    renderWithApi(<Inspector />);
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "split" });
    await userEvent.click(await screen.findByRole("tab", { name: "History" }));
    expect(await screen.findByRole("table", { name: "Runs of this step" })).toHaveTextContent("2 attempts");
    expect(await screen.findByText(/worker_lost/)).toBeInTheDocument();
    expect(screen.getByText(/#2/)).toBeInTheDocument();
  });

  it("asks for a selection when nothing is selected", () => {
    renderWithApi(<Inspector />);
    expect(screen.getByText(/Select a step/)).toBeInTheDocument();
  });
});

describe("inspector failures and checks", () => {
  it("badges the Methodology tab when a check on this step did not pass", async () => {
    const failing = JSON.parse(checksJson).map((c: { verdict: string }) => ({ ...c, verdict: "fail" }));
    server.use(http.get("/api/artifacts/:id/content", ({ params }) =>
      HttpResponse.text(params.id === "art_01JABCDEFGHJKMNPQRSTVWXYZ1" ? JSON.stringify(failing) : "{}"),
    ));
    renderWithApi(<Inspector />);
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "split" });
    expect(await screen.findByRole("tab", { name: "Methodology, 1 to review" })).toBeInTheDocument();
  });

  it("shows methodology checks that cite the selected step", async () => {
    renderWithApi(<Inspector />);
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "split" });
    await userEvent.click(await screen.findByRole("tab", { name: "Methodology" }));
    const checks = await screen.findByRole("region", { name: "Methodology checks" });
    expect(within(checks).getByLabelText("pass")).toBeInTheDocument();
    expect(checks).toHaveTextContent("at most one non-baseline model");
  });

  it("names each verdict's rule, phase and coverage, and what the decision that set the step chose", async () => {
    const design = {
      ...JSON.parse(checksJson)[0],
      id: "mck_01JABCDEFGHJKMNPQRSTVWXYZ9",
      check: "methodology.supervised.data_split@1.0.0",
      phase: "plan",
      coverage: "partial",
      methodology_decision_id: "mdc_01JABCDEFGHJKMNPQRSTVWXYZ0",
      cited_nodes: ["split"],
    };
    server.use(
      http.get("/api/artifacts/:id/content", () => HttpResponse.text(JSON.stringify([...JSON.parse(checksJson), design]))),
      http.get("/api/methodology_rules", () =>
        HttpResponse.json([
          {
            ...multicollinearity,
            id: design.check,
            name: "Data Splitting",
            alternatives: [{ ...multicollinearity.alternatives[0], id: "temporal", label: "Temporal split" }],
          },
        ]),
      ),
      http.get("/api/methodology_proposals/:id", ({ params }) =>
        params.id === appliedDecision.proposal_id
          ? HttpResponse.json(splitProposal)
          : HttpResponse.json({ errors: [] }, { status: 404 }),
      ),
      http.get("/api/methodology_decisions/:id", ({ params }) =>
        params.id === design.methodology_decision_id
          ? HttpResponse.json({ ...appliedDecision, rule: design.check })
          : HttpResponse.json({ errors: [] }, { status: 404 }),
      ),
    );
    renderWithApi(<Inspector />);
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "split" });
    await userEvent.click(await screen.findByRole("tab", { name: "Methodology" }));
    const checks = await screen.findByRole("region", { name: "Methodology checks" });
    const [leakage, chosen] = within(checks).getAllByRole("article");
    expect(leakage).toHaveTextContent("supervised.split_leakage@1.0.0");
    expect(leakage).not.toHaveTextContent("Decision chose");
    expect(await within(chosen!).findByText("Data Splitting")).toBeInTheDocument();
    expect(chosen).toHaveTextContent("Plan · partial coverage");
    expect(await within(chosen!).findByText(/Decision chose Temporal split/)).toHaveTextContent(
      "Decision chose Temporal split: Matches deployment chronology.",
    );
    const evidence = await within(chosen!).findByRole("list", { name: "Evidence the decision weighed" });
    expect(evidence).toHaveTextContent("Time column: order_date (explicit)");
  });

  it("says so when the decision a verdict cites cannot be loaded", async () => {
    const cited = { ...JSON.parse(checksJson)[0], methodology_decision_id: "mdc_01JABCDEFGHJKMNPQRSTVWXYZ9" };
    server.use(
      http.get("/api/artifacts/:id/content", () => HttpResponse.text(JSON.stringify([cited]))),
      http.get("/api/methodology_decisions/:id", () =>
        HttpResponse.json({ errors: [{ code: "not_found", message: "methodology decision mdc_01JABCDEFGHJKMNPQRSTVWXYZ9 not found" }] }, { status: 404 }),
      ),
    );
    renderWithApi(<Inspector />);
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "split" });
    await userEvent.click(await screen.findByRole("tab", { name: "Methodology" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("mdc_01JABCDEFGHJKMNPQRSTVWXYZ9");
  });

  it("says so when the proposal behind a cited decision cannot be loaded", async () => {
    const cited = { ...JSON.parse(checksJson)[0], methodology_decision_id: appliedDecision.id };
    server.use(
      http.get("/api/artifacts/:id/content", () => HttpResponse.text(JSON.stringify([cited]))),
      http.get("/api/methodology_decisions/:id", () => HttpResponse.json(appliedDecision)),
      http.get("/api/methodology_proposals/:id", () =>
        HttpResponse.json({ errors: [{ code: "not_found", message: `methodology proposal ${appliedDecision.proposal_id} not found` }] }, { status: 404 }),
      ),
    );
    renderWithApi(<Inspector />);
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "split" });
    await userEvent.click(await screen.findByRole("tab", { name: "Methodology" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(appliedDecision.proposal_id);
  });

  it("shows a split's row check from its own gate attempt next to Gate B's", async () => {
    const rowCheck: Attempt = { ...attempts[0]!, id: "att_01JABCDEFGHJKMNPQRSTVWXZZ1", node_id: "gate_split" };
    const rowArtifact = { ...gateOutputs[0]!.artifact, id: "art_01JABCDEFGHJKMNPQRSTVWXZZ1", producer_attempt_id: rowCheck.id };
    const failing = {
      ...JSON.parse(checksJson)[0],
      id: "mck_01JABCDEFGHJKMNPQRSTVWXZZ1",
      check: "methodology.supervised.data_split@1.0.0",
      phase: "runtime",
      coverage: "complete",
      verdict: "fail",
      rationale: "In step split's rows, 1 patient value is in both train and test, e.g. ['b'].",
      cited_nodes: ["split"],
    };
    server.use(
      http.get(`/api/runs/${RUN}/attempts`, () => HttpResponse.json([...attempts, rowCheck])),
      http.get("/api/attempts/:id/outputs", ({ params }) =>
        HttpResponse.json(params.id === rowCheck.id ? [{ port: "checks", artifact: rowArtifact }] : params.id === attempts[0]!.id ? gateOutputs : []),
      ),
      http.get("/api/artifacts/:id/content", ({ params }) =>
        HttpResponse.text(params.id === rowArtifact.id ? JSON.stringify([failing]) : checksJson),
      ),
    );
    renderWithApi(<Inspector />);
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "split" });
    await userEvent.click(await screen.findByRole("tab", { name: "Methodology, 1 to review" }));
    const checks = await screen.findByRole("region", { name: "Methodology checks" });
    expect(within(checks).getAllByRole("article")).toHaveLength(2);
    expect(checks).toHaveTextContent("Run · complete coverage");
    expect(checks).toHaveTextContent("1 patient value is in both train and test");
  });

  it("says so when the checks output is not a list of checks", async () => {
    server.use(http.get("/api/artifacts/:id/content", () => HttpResponse.text('{"verdict": "pass"}')));
    renderWithApi(<Inspector />);
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "split" });
    await userEvent.click(await screen.findByRole("tab", { name: "Methodology" }));
    expect(await screen.findByText(/Unreadable methodology checks/)).toBeInTheDocument();
  });

  it("shows an attempts error instead of 'not run'", async () => {
    server.use(http.get(`/api/runs/${RUN}/attempts`, () => HttpResponse.json({ errors: [{ code: "internal", message: "disk full" }] }, { status: 500 })));
    renderWithApi(<Inspector />);
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "score" });
    expect(await screen.findByRole("alert")).toHaveTextContent("disk full");
  });

  it("does not download a large JSON artifact", async () => {
    let fetched = false;
    const big = [{ ...scoreOutputs[0]!, artifact: { ...scoreOutputs[0]!.artifact, size_bytes: 10_000_000 } }];
    server.use(
      http.get("/api/attempts/:id/outputs", () => HttpResponse.json(big)),
      http.get("/api/artifacts/:id/content", () => {
        fetched = true;
        return HttpResponse.text("{}");
      }),
    );
    renderWithApi(<Inspector />);
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "score" });
    expect(await screen.findByText(/too large to show/)).toBeInTheDocument();
    expect(fetched).toBe(false);
  });
});

describe("peek at a table output", () => {
  it("shows the first page of rows with column types", async () => {
    renderWithApi(<Inspector />);
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "load" });
    const table = await screen.findByRole("table", { name: "data rows" });
    expect(within(table).getByRole("columnheader", { name: /sepal_length\s*Float64/ })).toBeInTheDocument();
    expect(within(table).getByRole("row", { name: /^1 0.5 setosa/ })).toBeInTheDocument();
    expect(screen.getByText("120 rows")).toBeInTheDocument();
  });

  it("marks a missing cell instead of showing it blank", async () => {
    renderWithApi(<Inspector />);
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "load" });
    const table = await screen.findByRole("table", { name: "data rows" });
    expect(within(within(table).getByRole("row", { name: /^4 / })).getByLabelText("missing")).toBeInTheDocument();
  });

  it("scrolls through the whole table, loading only the rows in view", async () => {
    const offsets: string[] = [];
    server.use(
      http.get("/api/artifacts/:id/content", ({ params }) => {
        if (params.id === loadOutputs[0]!.artifact.id) throw new Error("a table must never be downloaded");
        return HttpResponse.text("[]");
      }),
      http.get("/api/artifacts/:id/rows", ({ request }) => {
        const url = new URL(request.url);
        offsets.push(`${url.searchParams.get("offset")}/${url.searchParams.get("limit")}`);
        return HttpResponse.json(tablePage(Number(url.searchParams.get("offset")), Number(url.searchParams.get("limit"))));
      }),
    );
    renderWithApi(<Inspector />);
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "load" });
    const table = await screen.findByRole("table", { name: "data rows" });
    expect(screen.getByText("120 rows")).toBeInTheDocument();
    expect(within(table).getByText("0.5")).toBeInTheDocument();
    expect(within(table).queryByText("110.5")).toBeNull();
    const scroller = table.closest(".peek-scroll")!;
    scroller.scrollTop = 105 * 26;
    fireEvent.scroll(scroller);
    expect(await within(table).findByText("110.5")).toBeInTheDocument();
    expect(offsets).toEqual(["0/100", "100/100"]);
  });

  it("says when a wide table shows only its first columns", async () => {
    server.use(http.get("/api/artifacts/:id/rows", () => HttpResponse.json({ ...tablePage(0, 50), total_columns: 340 })));
    renderWithApi(<Inspector />);
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "load" });
    expect(await screen.findByText("· first 2 shown")).toBeInTheDocument();
    expect(screen.getByText("· 340 columns")).toBeInTheDocument();
  });

  it("shows why rows could not be read", async () => {
    server.use(
      http.get("/api/artifacts/:id/rows", () =>
        HttpResponse.json({ errors: [{ code: "not_a_table", message: "corrupt footer" }] }, { status: 422 }),
      ),
    );
    renderWithApi(<Inspector />);
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "load" });
    expect(await screen.findByRole("alert")).toHaveTextContent("not_a_table: corrupt footer");
  });
});

describe("column profile", () => {
  it("shows one card per column with missing share, distinct count and spread", async () => {
    renderWithApi(<Inspector />);
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "profile" });
    const profile = await screen.findByRole("region", { name: "Column profile" });
    const sepal = within(profile).getByRole("group", { name: "sepal_length" });
    expect(sepal).toHaveTextContent("DOUBLE");
    expect(sepal).toHaveTextContent("2.67% missing");
    expect(sepal).toHaveTextContent("35 distinct");
    expect(sepal).toHaveTextContent("min 4.3 · q25 5.1 · median 5.8 · q75 6.4 · max 7.9");
  });

  it("shows a text column's range", async () => {
    renderWithApi(<Inspector />);
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "profile" });
    const species = within(await screen.findByRole("region", { name: "Column profile" })).getByRole("group", { name: "species" });
    expect(species).toHaveTextContent("setosa … virginica");
    expect(within(species).queryByRole("img")).toBeNull();
  });
});

describe("column profile edge cases", () => {
  it("shows why the profile could not be read", async () => {
    server.use(
      http.get("/api/artifacts/:id/rows", () =>
        HttpResponse.json({ errors: [{ code: "not_a_table", message: "bad footer" }] }, { status: 422 }),
      ),
    );
    renderWithApi(<Inspector />);
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "profile" });
    expect(await screen.findByRole("alert")).toHaveTextContent("not_a_table: bad footer");
  });

  it("falls back to the range when quartiles are missing, and omits a missing std", async () => {
    const row = { values: ["age", "BIGINT", "1", "90", "50", "40", "", "", "", "", "10", "0.00"], missing: [6, 7, 8, 9] };
    server.use(http.get("/api/artifacts/:id/rows", () => HttpResponse.json({ ...profilePage, total_rows: 1, rows: [row] })));
    renderWithApi(<Inspector />);
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "profile" });
    const age = within(await screen.findByRole("region", { name: "Column profile" })).getByRole("group", { name: "age" });
    expect(age).toHaveTextContent("1 … 90");
    expect(age).toHaveTextContent("mean 40");
    expect(age).not.toHaveTextContent("±");
  });

  it("says when only the first columns are profiled", async () => {
    server.use(http.get("/api/artifacts/:id/rows", () => HttpResponse.json({ ...profilePage, total_rows: 900 })));
    renderWithApi(<Inspector />);
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "profile" });
    expect(await screen.findByText("First 2 of 900 columns.")).toBeInTheDocument();
  });
});

describe("node previews", () => {
  it("keeps the plain status when an evaluator's output is not metrics JSON", async () => {
    server.use(http.get("/api/artifacts/:id/content", () => HttpResponse.text("not json")));
    useSelection.setState({ pipelineVersionId: PV, runId: RUN });
    renderWithApi(<FlowCanvas />);
    const score = await screen.findByRole("button", { name: /^score/ });
    await waitFor(() => expect(score).toHaveTextContent("succeeded"));
    expect(score).not.toHaveTextContent("accuracy");
  });

  it("shows the size of a table output and the headline metric on the canvas", async () => {
    useSelection.setState({ pipelineVersionId: PV, runId: RUN });
    renderWithApi(<FlowCanvas />);
    expect(await screen.findByText("120 rows × 2 cols")).toBeInTheDocument();
    const score = await screen.findByRole("button", { name: /^score/ });
    await waitFor(() => expect(score).toHaveTextContent(/0\.947\s*accuracy/));
  });

  it("says how many columns a profile covers, not its own row count", async () => {
    useSelection.setState({ pipelineVersionId: PV, runId: RUN });
    renderWithApi(<FlowCanvas />);
    expect(await screen.findByText("2 cols profiled")).toBeInTheDocument();
  });

  it("names the port when a step has several outputs", async () => {
    server.use(http.get("/api/attempts/:id/outputs", () => HttpResponse.json([
      { ...loadOutputs[0]!, port: "test" },
      { ...loadOutputs[0]!, port: "train" },
    ])));
    useSelection.setState({ pipelineVersionId: PV, runId: RUN });
    renderWithApi(<FlowCanvas />);
    expect((await screen.findAllByText("test 120 × 2"))[0]).toBeInTheDocument();
  });

  /** A code step (as in the example flows) whose display report holds a table; returns what
   * the canvas asked for. */
  function codeStepDrawing(figures: () => Response, sizeBytes = 900) {
    const asked: string[] = [];
    const display = codeOutputs[0]!.artifact.id;
    const nodes = codePipeline.nodes.map((n) => (n.id === "code_1" ? { ...n, operator: "sprisk.code.python@2.0.0" } : n));
    server.use(
      http.get("/api/pipeline_versions", () => HttpResponse.json([{ ...codePipeline, nodes }])),
      http.get("/api/operators", () => HttpResponse.json([...operators, notebookOperator])),
      http.get(`/api/runs/${RUN}/attempts`, () => HttpResponse.json([...attempts, codeAttempt])),
      http.get(`/api/attempts/${codeAttempt.id}/outputs`, () =>
        HttpResponse.json([{ ...codeOutputs[0]!, artifact: { ...codeOutputs[0]!.artifact, size_bytes: sizeBytes } }]),
      ),
      http.get(`/api/artifacts/${display}/content`, () => {
        asked.push("content");
        return HttpResponse.text(codeDisplayJson);
      }),
      http.get(`/api/artifacts/${display}/figures`, ({ request }) => {
        asked.push(`figures${new URL(request.url).search}`);
        return figures();
      }),
    );
    useSelection.setState({ pipelineVersionId: PV, runId: RUN });
    renderWithApi(<FlowCanvas />);
    return asked;
  }
  const plotly = (title: string) => ({ library: "plotly", format: "plotly_json", title, content: '{"data": [], "layout": {}}' });

  it("previews a step's first figure on its card, fetching only that figure and never the tables", async () => {
    const asked = codeStepDrawing(() => HttpResponse.json({ items: [plotly("Target")] }));
    const card = await screen.findByRole("button", { name: /^code_1/ });
    expect(await within(card).findByRole("img", { name: "Target" })).toBeInTheDocument();
    expect(card).not.toHaveTextContent("output saved");
    expect(asked).toEqual(["figures?limit=1"]);
  });

  it("keeps the card as it was when the step drew no figure", async () => {
    codeStepDrawing(() => HttpResponse.json({ items: [] }));
    const card = await screen.findByRole("button", { name: /^code_1/ });
    await waitFor(() => expect(card).toHaveTextContent("output saved"));
  });

  it("does not fetch a figure from a report above the figure cap", async () => {
    const asked = codeStepDrawing(() => HttpResponse.json({ items: [plotly("Target")] }), 10_000_000);
    const card = await screen.findByRole("button", { name: /^code_1/ });
    await waitFor(() => expect(card).toHaveTextContent("output saved"));
    expect(asked).toEqual([]);
  });

  /** The real evaluator: it draws figures too, and its outputs are listed by port name. */
  function evaluatorDrawing(figures: { items: ReturnType<typeof plotly>[] }) {
    const metrics = scoreOutputs[0]!;
    const drawn = { port: "figures", artifact: { ...metrics.artifact, id: "art_01JABCDEFGHJKMNPQRSTVWXY77" } };
    const evaluate = operators.find((o) => o.id === "sprisk.ml.evaluate@1.0.0")!;
    const withFigures = { ...evaluate, outputs: [...evaluate.outputs, { name: "figures", kind: "figure" as const }] };
    server.use(
      http.get("/api/operators", () => HttpResponse.json(operators.map((o) => (o === evaluate ? withFigures : o)))),
      http.get(`/api/attempts/${scoreAttempt.id}/outputs`, () => HttpResponse.json([drawn, metrics])),
      http.get(`/api/artifacts/${drawn.artifact.id}/figures`, () => HttpResponse.json(figures)),
      http.get(`/api/artifacts/${drawn.artifact.id}/content`, () => HttpResponse.json({ items: [plotly("Predicted against actual")] })),
    );
    useSelection.setState({ pipelineVersionId: PV, runId: RUN });
    renderWithApi(<FlowCanvas />);
  }

  it("shows an evaluator's metric above its figure, whatever order its outputs come in", async () => {
    evaluatorDrawing({ items: [plotly("Predicted against actual")] });
    const score = await screen.findByRole("button", { name: /^score/ });
    expect(await within(score).findByRole("img", { name: "Predicted against actual" })).toBeInTheDocument();
    await waitFor(() => expect(score).toHaveTextContent(/accuracy 0\.947/));
  });

  it("shows an evaluator's metric when it drew no figure, whatever order its outputs come in", async () => {
    evaluatorDrawing({ items: [] });
    const score = await screen.findByRole("button", { name: /^score/ });
    await waitFor(() => expect(score).toHaveTextContent(/0\.947\s*accuracy/));
  });

  it("says why the figure could not be read", async () => {
    codeStepDrawing(() => HttpResponse.json({ errors: [{ code: "not_figures", message: "not figures" }] }, { status: 422 }));
    const card = await screen.findByRole("button", { name: /^code_1/ });
    expect(await within(card).findByRole("alert")).toHaveTextContent("not_figures");
  });
});

describe("code steps (ADR-0020)", () => {
  function recordPosts() {
    const posted: { versions: unknown[]; runs: unknown[] } = { versions: [], runs: [] };
    server.use(
      http.post("/api/pipeline_versions", async ({ request }) => {
        const body = await request.json();
        posted.versions.push(body);
        return HttpResponse.json(body, { status: 201 });
      }),
      http.post("/api/runs", async ({ request }) => {
        const body = (await request.json()) as { pipeline_version_id: string };
        posted.runs.push(body);
        return HttpResponse.json({ ...run, id: "run_01JABCDEFGHJKMNPQRSTVWXYZ9", pipeline_version_id: body.pipeline_version_id, status: "queued" }, { status: 202 });
      }),
    );
    return posted;
  }

  it("explores a table output in a new code step and runs it", async () => {
    const posted = recordPosts();
    renderWithApi(<Inspector />);
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "load" });
    await userEvent.click(await screen.findByRole("button", { name: "Explore data in code" }));
    await waitFor(() => expect(posted.runs).toHaveLength(1));
    const version = posted.versions[0] as typeof pipeline;
    expect(version.nodes.at(-1)).toMatchObject({ id: "code_1", operator: "sprisk.code.python@1.2.0" });
    expect(version.edges.at(-1)).toEqual({ from: "load.data", to: "code_1.data" });
    // An edit runs from the edited step onwards, reusing the run on screen (ADR-0026).
    expect(posted.runs[0]).toEqual({ pipeline_version_id: version.id, reuse_run_id: RUN });
    expect(useSelection.getState()).toMatchObject({ pipelineVersionId: version.id, runId: "run_01JABCDEFGHJKMNPQRSTVWXYZ9", nodeId: "code_1" });
  });

  it("edits the code in the Code tab and runs the new version", async () => {
    server.use(http.get("/api/pipeline_versions", () => HttpResponse.json([codePipeline])));
    const posted = recordPosts();
    renderWithApi(<Inspector />);
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "code_1" });
    await userEvent.click(await screen.findByRole("tab", { name: "Code" }));
    const editor = await screen.findByRole("textbox", { name: "Code for code_1" });
    expect(editor).toHaveValue("print(data.height)\ndata.head(1)");
    await userEvent.clear(editor);
    await userEvent.type(editor, "data.height");
    await userEvent.click(screen.getByRole("button", { name: "Run code" }));
    await waitFor(() => expect(posted.runs).toHaveLength(1));
    const version = posted.versions[0] as typeof pipeline;
    expect(version.nodes.find((n) => n.id === "code_1")?.params).toEqual({ source: "data.height" });
  });

  it("says which exposed settings override the code", async () => {
    const exposed = {
      ...codePipeline,
      nodes: codePipeline.nodes.map((n) =>
        n.id === "code_1" ? { ...n, operator: "sprisk.code.python@1.2.0", params: { source: "k = 1", parameters: { k: 5.5 } } } : n,
      ),
    };
    server.use(http.get("/api/pipeline_versions", () => HttpResponse.json([exposed])));
    renderWithApi(<Inspector />);
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "code_1" });
    await userEvent.click(await screen.findByRole("tab", { name: "Code" }));
    expect(await screen.findByText(/Runs with k = 5.5/)).toHaveTextContent("set in Inputs");
  });

  it("runs the code with Shift+Enter", async () => {
    server.use(http.get("/api/pipeline_versions", () => HttpResponse.json([codePipeline])));
    const posted = recordPosts();
    renderWithApi(<Inspector />);
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "code_1" });
    await userEvent.click(await screen.findByRole("tab", { name: "Code" }));
    const editor = await screen.findByRole("textbox", { name: "Code for code_1" });
    await userEvent.type(editor, "{Shift>}{Enter}{/Shift}");
    await waitFor(() => expect(posted.runs).toHaveLength(1));
  });

  it("shows what the code printed, its table and its figures", async () => {
    server.use(
      http.get("/api/pipeline_versions", () => HttpResponse.json([codePipeline])),
      http.get(`/api/runs/${RUN}/attempts`, () => HttpResponse.json([...attempts, codeAttempt])),
      http.get(`/api/attempts/${codeAttempt.id}/outputs`, () => HttpResponse.json(codeOutputs)),
      http.get(`/api/artifacts/${codeOutputs[0]!.artifact.id}/content`, () => HttpResponse.text(codeDisplayJson)),
    );
    renderWithApi(<Inspector />);
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "code_1" });
    const tables = await screen.findByRole("region", { name: "Shown table 1" });
    expect(within(tables).getByRole("table")).toHaveTextContent("setosa");
    expect(within(tables).getByText("1 of 150 rows")).toBeInTheDocument();
    expect(screen.queryByText("This step produces no data.")).toBeNull();
    expect(await screen.findByRole("tab", { name: /Visualizations 1/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: /Visualizations/ }));
    const shown = await screen.findByRole("region", { name: "Visualizations" });
    expect(within(shown).queryByRole("table")).toBeNull();
    expect(within(shown).getByRole("img", { name: "Figure 1" })).toHaveAttribute("src", "data:image/png;base64,iVBORw0KGgo=");
    await userEvent.click(screen.getByRole("tab", { name: /Console/ }));
    expect(within(await screen.findByRole("region", { name: "Printed output" })).getByText("150")).toBeInTheDocument();
  });
});

describe("code output layout (Scenario F)", () => {
  const many = JSON.stringify({
    items: [
      { kind: "text", text: "150 rows\n", channel: "stdout" },
      { kind: "image", png_base64: "AAAA" },
      { kind: "image", png_base64: "BBBB" },
      { kind: "text", text: "UserWarning: small sample\n", channel: "stderr" },
    ],
  });
  function showMany() {
    server.use(
      http.get("/api/pipeline_versions", () => HttpResponse.json([codePipeline])),
      http.get(`/api/runs/${RUN}/attempts`, () => HttpResponse.json([...attempts, codeAttempt])),
      http.get(`/api/attempts/${codeAttempt.id}/outputs`, () => HttpResponse.json(codeOutputs)),
      http.get(`/api/artifacts/${codeOutputs[0]!.artifact.id}/content`, () => HttpResponse.text(many)),
    );
    renderWithApi(<Inspector />);
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "code_1" });
  }
  const open = async (tab: RegExp) => userEvent.click(await screen.findByRole("tab", { name: tab }));

  it("marks stderr and warnings apart from printed text, and badges the Console", async () => {
    showMany();
    expect(await screen.findByRole("tab", { name: /Console ⚠ 1/ })).toBeInTheDocument();
    await open(/Console/);
    const warning = await screen.findByText(/small sample/);
    expect(warning.closest("[data-channel]")).toHaveAttribute("data-channel", "stderr");
  });

  it("switches between inline and a grid without re-running anything", async () => {
    showMany();
    expect(await screen.findByRole("tab", { name: /Visualizations 2/ })).toBeInTheDocument();
    await open(/Visualizations/);
    const shown = await screen.findByRole("region", { name: "Visualizations" });
    expect(shown).toHaveClass("inline");
    await userEvent.click(screen.getByRole("radio", { name: "Grid" }));
    expect(screen.getByRole("region", { name: "Visualizations" })).toHaveClass("grid");
    expect(screen.getAllByRole("img", { name: /Figure \d/ })).toHaveLength(2);
  });

  it("opens a figure large and closes it with Escape", async () => {
    showMany();
    await open(/Visualizations/);
    await userEvent.click(await screen.findByRole("button", { name: "Enlarge Figure 2" }));
    const dialog = screen.getByRole("dialog", { name: "Figure 2" });
    expect(within(dialog).getByRole("img")).toHaveAttribute("src", "data:image/png;base64,BBBB");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("code step failures", () => {
  it("shows why a new code step could not be saved", async () => {
    server.use(
      http.post("/api/pipeline_versions", () =>
        HttpResponse.json({ errors: [{ code: "unknown_operator", message: "no sprisk.code.python" }] }, { status: 422 }),
      ),
    );
    renderWithApi(<Inspector />);
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "load" });
    await userEvent.click(await screen.findByRole("button", { name: "Explore data in code" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("unknown_operator: no sprisk.code.python");
  });

  async function showCode(content: string, sizeBytes = 900) {
    server.use(
      http.get("/api/pipeline_versions", () => HttpResponse.json([codePipeline])),
      http.get(`/api/runs/${RUN}/attempts`, () => HttpResponse.json([...attempts, codeAttempt])),
      http.get(`/api/attempts/${codeAttempt.id}/outputs`, () =>
        HttpResponse.json([{ ...codeOutputs[0]!, artifact: { ...codeOutputs[0]!.artifact, size_bytes: sizeBytes } }]),
      ),
      http.get(`/api/artifacts/${codeOutputs[0]!.artifact.id}/content`, () => HttpResponse.text(content)),
    );
    renderWithApi(<Inspector />);
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "code_1" });
    await userEvent.click(await screen.findByRole("tab", { name: /Visualizations/ }));
  }

  it("says the output is unreadable instead of drawing nothing", async () => {
    await showCode('{"items": [{"kind": "video"}]}');
    expect(await screen.findByRole("alert")).toHaveTextContent(`Unreadable display report ${codeOutputs[0]!.artifact.id}`);
  });

  it("flags an image item with no picture", async () => {
    await showCode('{"items": [{"kind": "image"}]}');
    expect(await screen.findByRole("alert")).toHaveTextContent("Output item 1 (image) has no content");
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("draws a code step's plots as notebooks do: SVG pictures and live Plotly charts", async () => {
    const display = {
      items: [
        { kind: "figure", figure: { library: "matplotlib", format: "svg", title: "Body mass", content: "<svg xmlns='http://www.w3.org/2000/svg'></svg>" } },
        { kind: "figure", figure: { library: "plotly", format: "plotly_json", title: "counts", content: '{"data": [], "layout": {}}' } },
        { kind: "figure", figure: { library: "altair", format: "vega_lite_json", title: "bars", content: '{"mark": "bar"}' } },
      ],
    };
    await showCode(JSON.stringify(display));
    await userEvent.click(await screen.findByRole("tab", { name: /Visualizations 3/ }));
    const shown = await screen.findByRole("region", { name: "Visualizations" });
    expect(within(shown).getByRole("img", { name: "Body mass" })).toHaveAttribute("src", expect.stringMatching(/^data:image\/svg\+xml/));
    expect(await within(shown).findByRole("img", { name: "counts" })).toBeInTheDocument();
    expect(await within(shown).findByRole("img", { name: "bars" })).toBeInTheDocument();
  });

  it("labels each plot with the code line that showed it", async () => {
    const svg = (title: string) => ({ library: "matplotlib", format: "svg", title, content: "<svg xmlns='http://www.w3.org/2000/svg'></svg>" });
    const display = { items: [{ kind: "figure", line: 2, figure: svg("a") }, { kind: "figure", figure: svg("b") }] };
    await showCode(JSON.stringify(display));
    await userEvent.click(await screen.findByRole("tab", { name: /Visualizations 2/ }));
    const shown = await screen.findByRole("region", { name: "Visualizations" });
    expect(within(shown).getByText("Plot 1 · line 2 · data.head(1)")).toBeInTheDocument();
    expect(within(shown).getByText("Plot 2 · shown at the end")).toBeInTheDocument();
  });

  it("does not download output above the cap", async () => {
    await showCode(codeDisplayJson, 10_000_000);
    expect(await screen.findByText(/Too large to draw here/)).toBeInTheDocument();
  });

  it("left-aligns text columns the code returns", async () => {
    await showCode(codeDisplayJson);
    await userEvent.click(screen.getByRole("tab", { name: /^Data/ }));
    const table = await within(await screen.findByRole("region", { name: "Shown table 1" })).findByRole("table");
    expect(within(table).getByRole("columnheader", { name: /species/ })).toHaveClass("text");
  });
});

describe("inputs tab", () => {
  function openTab(nodeId: string, name: string) {
    renderWithApi(<Inspector />);
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId });
    return screen.findByRole("tab", { name }).then((tab) => userEvent.click(tab));
  }
  const openInputs = (nodeId: string) => openTab(nodeId, "Inputs");
  const openParameters = (nodeId: string) => openTab(nodeId, "Parameters");

  it("lists each input table with where it comes from and its size", async () => {
    await openInputs("split");
    const inputs = await screen.findByRole("region", { name: "Input tables" });
    expect(inputs).toHaveTextContent("data");
    expect(within(inputs).getByRole("button", { name: "load.data" })).toBeInTheDocument();
    await waitFor(() => expect(inputs).toHaveTextContent("120 rows × 2 cols"));
    await userEvent.click(within(inputs).getByRole("button", { name: "load.data" }));
    expect(useSelection.getState().nodeId).toBe("load");
  });

  it("shows settings as a form built from the operator's schema", async () => {
    server.use(
      http.get("/api/operators", () =>
        HttpResponse.json(
          operators.map((o) =>
            o.id === "sprisk.ml.linear_model@1.0.0"
              ? {
                  ...o,
                  params_schema: {
                    type: "object",
                    properties: {
                      target: { type: "string" },
                      features: { type: "array", items: { type: "string" } },
                      task: { type: "string", enum: ["classification", "regression"] },
                    },
                  },
                }
              : o,
          ),
        ),
      ),
    );
    await openParameters("model");
    const settings = await screen.findByRole("region", { name: "Settings" });
    expect(within(settings).getByRole("textbox", { name: "target" })).toHaveValue("y");
    expect(within(settings).getByRole("textbox", { name: "features" })).toHaveValue("x");
    expect(within(settings).getByRole("combobox", { name: "task" })).toHaveValue("classification");
    expect(within(settings).getByRole("button", { name: "Run with these settings" })).toBeDisabled();
  });

  it("explains each setting: description, type, allowed values, default and whether it is required", async () => {
    server.use(
      http.get("/api/operators", () =>
        HttpResponse.json(
          operators.map((o) =>
            o.id === "sprisk.validation.random_split@1.0.0"
              ? {
                  ...o,
                  params_schema: {
                    type: "object",
                    required: ["test_fraction"],
                    properties: {
                      test_fraction: { type: "number", minimum: 0, maximum: 1, description: "Share of rows held out for testing." },
                      seed: { type: "integer", default: 0, description: "Fixes the shuffle so runs repeat." },
                    },
                  },
                }
              : o,
          ),
        ),
      ),
    );
    await openParameters("split");
    const settings = await screen.findByRole("region", { name: "Settings" });
    const fraction = within(settings).getByRole("spinbutton", { name: "test_fraction" });
    expect(fraction).toHaveAccessibleDescription(/Share of rows held out for testing\..*number.*0 to 1.*required/);
    expect(within(settings).getByRole("spinbutton", { name: "seed" })).toHaveAccessibleDescription(/Fixes the shuffle.*integer.*default 0/);
  });

  it("lists every declared input, even one not connected, and every output with its type", async () => {
    await openInputs("score");
    const inputs = await screen.findByRole("region", { name: "Input tables" });
    expect(inputs).toHaveTextContent(/model.*model/);
    expect(inputs).toHaveTextContent(/test.*table/);
    const outputs = await screen.findByRole("region", { name: "Outputs" });
    expect(outputs).toHaveTextContent(/metrics.*metrics/);
  });

  it("shows an optional input left unconnected as optional, not as an error", async () => {
    server.use(
      http.get("/api/operators", () =>
        HttpResponse.json(
          operators.map((o) =>
            o.id === "sprisk.ml.evaluate@1.0.0" ? { ...o, inputs: [...o.inputs, { name: "words", kind: "matrix", optional: true }] } : o,
          ),
        ),
      ),
    );
    await openInputs("score");
    const inputs = await screen.findByRole("region", { name: "Input tables" });
    await waitFor(() => expect(inputs).toHaveTextContent(/words.*matrix.*optional, not connected/));
    expect(within(inputs).queryAllByText("not connected")).toHaveLength(0);
  });

  it("runs a new version with the changed setting", async () => {
    server.use(
      http.get("/api/operators", () =>
        HttpResponse.json(
          operators.map((o) =>
            o.id === "sprisk.validation.random_split@1.0.0"
              ? { ...o, params_schema: { type: "object", properties: { test_fraction: { type: "number" }, seed: { type: "integer", minimum: 0 } } } }
              : o,
          ),
        ),
      ),
    );
    const posted: unknown[] = [];
    server.use(
      http.post("/api/pipeline_versions", async ({ request }) => {
        const body = await request.json();
        posted.push(body);
        return HttpResponse.json(body, { status: 201 });
      }),
      http.post("/api/runs", async ({ request }) => {
        const body = (await request.json()) as { pipeline_version_id: string };
        return HttpResponse.json({ ...run, id: "run_01JABCDEFGHJKMNPQRSTVWXYZ8", pipeline_version_id: body.pipeline_version_id }, { status: 202 });
      }),
    );
    await openParameters("split");
    const seed = await screen.findByRole("spinbutton", { name: "seed" });
    await userEvent.clear(seed);
    await userEvent.type(seed, "7");
    await userEvent.click(screen.getByRole("button", { name: "Run with these settings" }));
    await waitFor(() => expect(posted).toHaveLength(1));
    const version = posted[0] as typeof pipeline;
    expect(version.parent_id).toBe(PV);
    expect(version.nodes.find((n) => n.id === "split")?.params).toEqual({ test_fraction: 0.25, seed: 7 });
    expect(useSelection.getState()).toMatchObject({ pipelineVersionId: version.id, nodeId: "split" });
  });
});

describe("code step interface (ADR-0021)", () => {
  const v12 = {
    ...codePipeline,
    nodes: codePipeline.nodes.map((n) =>
      n.id === "code_1" ? { ...n, operator: "sprisk.code.python@1.2.0", params: { source: "factor = 2\nout = data" } } : n,
    ),
  };
  const iface = { ...codeOutputs[0]!, port: "interface", artifact: { ...codeOutputs[0]!.artifact, id: "art_01JABCDEFGHJKMNPQRSTVWXY70" } };
  const report = {
    inputs: [{ name: "data", origin: "inferred", bound: true }, { name: "lookup", origin: "inferred", bound: false }],
    parameters: [{ name: "factor", line: 1, value_type: "integer", default_text: "2", effective_text: "2", origin: "inferred" }],
    outputs: [{ name: "out", type: "polars.DataFrame", rows: 120, columns: 2, origin: "measured", chosen: false }],
    files: [{ path: "lookup.csv", reader: "read_csv", line: 3 }],
  };
  const passed = { ...loadOutputs[0]!, port: "data", artifact: { ...loadOutputs[0]!.artifact, id: "art_01JABCDEFGHJKMNPQRSTVWXY71" } };
  function withInterface(found: unknown = report, version: typeof v12 = v12) {
    const posted: { params: Record<string, unknown> }[] = [];
    server.use(
      http.get("/api/pipeline_versions", () => HttpResponse.json([version])),
      http.get(`/api/runs/${RUN}/attempts`, () => HttpResponse.json([...attempts, codeAttempt])),
      http.get(`/api/attempts/${codeAttempt.id}/outputs`, () => HttpResponse.json([...codeOutputs, iface, passed])),
      http.get(`/api/artifacts/${iface.artifact.id}/content`, () => HttpResponse.text(JSON.stringify(found))),
      http.post("/api/pipeline_versions", async ({ request }) => {
        const body = (await request.json()) as typeof pipeline;
        posted.push(body.nodes.find((n) => n.id === "code_1") as { params: Record<string, unknown> });
        return HttpResponse.json(body, { status: 201 });
      }),
      http.post("/api/runs", async ({ request }) => {
        const body = (await request.json()) as { pipeline_version_id: string };
        return HttpResponse.json({ ...run, id: "run_01JABCDEFGHJKMNPQRSTVWXYZ8", pipeline_version_id: body.pipeline_version_id }, { status: 202 });
      }),
    );
    return posted;
  }

  async function openCode(tab: string) {
    renderWithApi(<Inspector />);
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "code_1" });
    await userEvent.click(await screen.findByRole("tab", { name: tab }));
  }

  /** Data's own tab of everything the code ended with, beside its tables. */
  async function openVariables() {
    await openCode("Data");
    await userEvent.click(await screen.findByRole("tab", { name: /^variables/ }));
  }

  it("Inputs lists the names the code reads, marking names nothing defines", async () => {
    withInterface();
    await openCode("Inputs");
    const names = await screen.findByRole("region", { name: "Names read by the code" });
    expect(within(names).getByText("data").closest("li")).toHaveTextContent("the input table");
    expect(within(names).getByText("lookup").closest("li")).toHaveTextContent("nothing defines it");
  });

  it("Inputs lists the files the code reads (ADR-0025)", async () => {
    withInterface();
    await openCode("Inputs");
    const inputs = await screen.findByRole("region", { name: "Input tables" });
    expect(within(inputs).getByText("lookup.csv")).toBeInTheDocument();
    expect(within(inputs).getByText("lookup.csv").closest("li")).toHaveTextContent(/file.*read_csv, line 3/);
  });

  it("Parameters exposes a setting found in the code and runs with a new value", async () => {
    const posted = withInterface();
    await openCode("Parameters");
    const found = await screen.findByRole("region", { name: "Settings in your code" });
    expect(found).toHaveTextContent("line 1");
    await userEvent.click(within(found).getByRole("checkbox", { name: "Expose factor" }));
    const value = within(found).getByRole("spinbutton", { name: "factor" });
    await userEvent.clear(value);
    await userEvent.type(value, "10");
    await userEvent.click(within(found).getByRole("button", { name: "Run with these settings" }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]!.params).toEqual({ source: "factor = 2\nout = data", parameters: { factor: 10 } });
  });

  it("Data chooses which value the code passes on", async () => {
    const posted = withInterface();
    await openVariables();
    const values = await screen.findByRole("region", { name: "Values in your code" });
    await userEvent.click(within(values).getByRole("radio", { name: /out · 120 rows × 2 cols/ }));
    await userEvent.click(within(values).getByRole("button", { name: "Pass this on and run" }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]!.params).toEqual({ source: "factor = 2\nout = data", output: "out" });
  });

  it("Data explores every variable the code ended with (ADR-0030)", async () => {
    const columns = [
      { name: "age", data_type: "Int64" },
      { name: "city", data_type: "String" },
    ];
    withInterface({
      ...report,
      outputs: [
        {
          ...report.outputs[0],
          fields: [
            { name: "age", data_type: "Int64", null_count: 0 },
            { name: "city", data_type: "String", null_count: 3 },
          ],
          sample: { offset: 0, total_rows: 120, total_columns: 2, columns, rows: [{ values: ["34", "Oslo"], missing: [] }] },
        },
        { name: "ages", type: "polars.Series", rows: 120, columns: 1, origin: "measured", chosen: false, fields: [{ name: "age", data_type: "Int64", null_count: 0 }] },
        { name: "wide", type: "polars.DataFrame", rows: 5, columns: 900, origin: "measured", chosen: false, fields: [{ name: "c0", data_type: "Int64", null_count: 0 }] },
        { name: "lookup", type: "dict", origin: "measured", chosen: false, text: "{'a': 1}" },
      ],
    });
    await openVariables();
    const variables = await screen.findByRole("region", { name: "Variables" });
    // Many variables: each is a tab of its own, beside the one shown.
    expect(within(variables).getByRole("tablist", { name: "Variables" })).toHaveAttribute("aria-orientation", "vertical");
    await userEvent.click(within(variables).getByRole("tab", { name: /^out/ }));
    const fields = within(variables).getByRole("table", { name: "Fields of out" });
    expect(within(fields).getByText("city").closest("tr")).toHaveTextContent(/city\s*String\s*3/);
    expect(within(variables).getByRole("table", { name: "First rows of out" })).toHaveTextContent("Oslo");

    await userEvent.click(within(variables).getByRole("tab", { name: /^ages/ }));
    expect(within(variables).getByText(/first rows were not kept/)).toBeInTheDocument();

    await userEvent.click(within(variables).getByRole("tab", { name: /^wide/ }));
    expect(within(variables).getByText("First 1 of 900 fields.")).toBeInTheDocument();

    // A dict is neither a table nor a plain value: it waits under Other.
    await userEvent.click(within(variables).getByRole("button", { name: "Other (1)" }));
    await userEvent.click(within(variables).getByRole("tab", { name: /^lookup/ }));
    expect(within(variables).getByText("{'a': 1}")).toBeInTheDocument();

    // Only a DataFrame can be passed on to the next step.
    const values = screen.getByRole("region", { name: "Values in your code" });
    expect(within(values).queryByRole("radio", { name: /ages/ })).toBeNull();
  });

  it("Data names each tab: tables passed on, tables the code showed by their code, then variables", async () => {
    const page = { ...tablePage(0, 1), total_rows: 3 };
    server.use(
      http.get(`/api/artifacts/${codeOutputs[0]!.artifact.id}/content`, () =>
        HttpResponse.text(JSON.stringify({ items: [{ kind: "table", table: page, label: "summary" }, { kind: "table", table: page }] })),
      ),
    );
    withInterface({
      ...report,
      outputs: [
        { name: "out", type: "polars.DataFrame", rows: 120, columns: 2, origin: "measured", chosen: true },
        { name: "summary", type: "pandas.DataFrame", rows: 4, columns: 4, origin: "measured", chosen: false },
        { name: "best", type: "str", origin: "measured", chosen: false, text: "'ridge'" },
        { name: "folds", type: "sklearn.KFold", origin: "measured", chosen: false, text: "KFold(n_splits=5)" },
        { name: "sizes", type: "numpy.ndarray", origin: "measured", chosen: false, text: "array([66, 132])" },
      ],
    });
    await openCode("Data");
    const strip = await screen.findByRole("tablist", { name: "Outputs" });
    await waitFor(() => expect(within(strip).getAllByRole("tab").map((t) => t.textContent)).toEqual(["data", "summary shown", "shown 2", "variables 4"]));

    await userEvent.click(within(strip).getByRole("tab", { name: /^variables/ }));
    const variables = await screen.findByRole("region", { name: "Variables" });
    // A table with a tab of its own is not listed again.
    expect(within(variables).queryByRole("tab", { name: /^summary/ })).toBeNull();
    expect(within(variables).getByText("summary has its own tab above.")).toBeInTheDocument();
    expect(within(variables).getByRole("tab", { name: /^out/ })).toHaveTextContent("→ next steps");
    expect(within(variables).getByText("Tables")).toBeInTheDocument();
    expect(within(variables).getByText("Values")).toBeInTheDocument();
    // Helpers and arrays wait behind Other until asked for.
    expect(within(variables).queryByRole("tab", { name: /^folds/ })).toBeNull();
    await userEvent.click(within(variables).getByRole("button", { name: "Other (2)" }));
    expect(within(variables).getByRole("tab", { name: /^folds/ })).toBeInTheDocument();
  });

  it("a notebook step passes on by name: no pass-on choice, named outputs listed (ADR-0031)", async () => {
    const notebook = {
      ...codePipeline,
      nodes: codePipeline.nodes.map((n) =>
        n.id === "code_1" ? { ...n, operator: "sprisk.code.python@2.0.0", params: { source: "kept = df", inputs: ["df"], outputs: ["kept"] } } : n,
      ),
      edges: codePipeline.edges.map((e) => (e.to === "code_1.data" ? { ...e, to: "code_1.df" } : e)),
    };
    const notebookOperator = {
      ...operators[0]!,
      id: "sprisk.code.python@2.0.0",
      inputs: [],
      outputs: [{ name: "display", kind: "diagnostics" }],
      params_schema: {
        type: "object",
        properties: { source: { type: "string" }, inputs: { type: "array", "x-sprisk-ports": "input" }, outputs: { type: "array", "x-sprisk-ports": "output" } },
      },
    };
    server.use(http.get("/api/operators", () => HttpResponse.json([...operators, notebookOperator])));
    withInterface(report, notebook);
    await openVariables();
    await screen.findByRole("region", { name: "Variables" });
    expect(screen.queryByRole("region", { name: "Values in your code" })).toBeNull();

    await userEvent.click(screen.getByRole("tab", { name: "Inputs" }));
    const inputs = await screen.findByRole("region", { name: "Input tables" });
    expect(within(inputs).getByText("df").closest("li")).toHaveTextContent("load");
    const outputs = screen.getByRole("region", { name: "Outputs" });
    expect(within(outputs).getByText("kept").closest("li")).toHaveTextContent("table");
  });


  it("a code step's Visualizations show only what its code drew (ADR-0032)", async () => {
    withInterface();
    await openCode("Visualizations");
    expect(await screen.findByRole("region", { name: "Visualizations" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Chart" })).toBeNull();
  });
});

describe("node detail switch", () => {
  const splitOutputs = [
    { ...loadOutputs[0]!, port: "test", artifact: { ...loadOutputs[0]!.artifact, id: "art_01JABCDEFGHJKMNPQRSTVWXYT1" } },
    { ...loadOutputs[0]!, port: "train", artifact: { ...loadOutputs[0]!.artifact, id: "art_01JABCDEFGHJKMNPQRSTVWXYT2" } },
  ];
  function withSplitOutputs() {
    const split = attempts.filter((a) => a.node_id === "split").at(-1)!;
    server.use(
      http.get(`/api/attempts/${split.id}/outputs`, () => HttpResponse.json(splitOutputs)),
      http.get("/api/artifacts/:id/rows", ({ params }) =>
        HttpResponse.json({ ...tablePage(0, 1), total_rows: params.id === "art_01JABCDEFGHJKMNPQRSTVWXYT1" ? 30 : 90 }),
      ),
    );
  }

  it("a step with several tables shows one sub-tab per table in Data, in the order its operator lists them", async () => {
    withSplitOutputs();
    renderWithApi(<Inspector />);
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "split" });
    const tables = await screen.findByRole("tablist", { name: "Outputs" });
    await waitFor(() => expect(within(tables).getAllByRole("tab").map((t) => t.textContent)).toEqual(["train", "test"]));
    expect(await screen.findByRole("region", { name: "Table · train" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Table · test" })).toBeNull();
    await userEvent.click(within(tables).getByRole("tab", { name: "test" }));
    expect(await screen.findByRole("region", { name: "Table · test" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Table · train" })).toBeNull();
  });

  it("shows round steps with name and state in Compact and full cards in Detail; there is no Summary", async () => {
    useSelection.setState({ pipelineVersionId: PV, runId: RUN });
    renderWithApi(<FlowCanvas />);
    await userEvent.click(await screen.findByRole("radio", { name: "Compact" }));
    expect(screen.getAllByRole("radio").map((r) => r.textContent)).toEqual(["Compact", "Detail"]);
    const score = await screen.findByRole("button", { name: /^score/ });
    expect(score).toHaveTextContent(/^Evaluate\s*score$/);
    expect(score.querySelector(".state-dot.tone-done")).not.toBeNull();
    expect(score.querySelector(".round-icon")).not.toBeNull();

    await userEvent.click(screen.getByRole("radio", { name: "Detail" }));
    const card = await screen.findByRole("button", { name: /^score/ });
    await waitFor(() => expect(card.querySelector(".card-status")).toHaveTextContent("succeeded"));
    expect(screen.getByRole("radio", { name: "Detail" })).toHaveAttribute("aria-checked", "true");
  });

  it("a remembered choice other than Detail opens as Compact, the Flow Studio default", async () => {
    const { readLevel } = await import("../src/workbench/detail.ts");
    expect(readLevel("detail")).toBe("detail");
    expect(readLevel("compact")).toBe("compact");
    expect(readLevel("summary")).toBe("compact");
    expect(readLevel(42)).toBe("compact");
  });

  it("draws the train / test balance of a split in Detail", async () => {
    withSplitOutputs();
    useSelection.setState({ pipelineVersionId: PV, runId: RUN });
    renderWithApi(<FlowCanvas />);
    await userEvent.click(await screen.findByRole("radio", { name: "Detail" }));
    expect(await screen.findByLabelText("train 90 rows, test 30 rows")).toBeInTheDocument();
    expect(screen.getByText("75 / 25")).toBeInTheDocument();
  });

  it("flags a step that a methodology check did not pass", async () => {
    const failing = JSON.parse(checksJson).map((c: { verdict: string }) => ({ ...c, verdict: "fail" }));
    server.use(http.get("/api/artifacts/:id/content", () => HttpResponse.text(JSON.stringify(failing))));
    useSelection.setState({ pipelineVersionId: PV, runId: RUN });
    renderWithApi(<FlowCanvas />);
    const split = await screen.findByRole("button", { name: /^split/ });
    await waitFor(() => expect(split).toHaveTextContent("⚠ 1 check"));
  });
});

describe("cached steps", () => {
  const cachedAttempts = () => attempts.map((a) => (a.node_id === "score" ? { ...a, state: "cache_hit" as const } : a));

  it("marks a cached step on the canvas and still shows its fact", async () => {
    server.use(http.get(`/api/runs/${RUN}/attempts`, () => HttpResponse.json(cachedAttempts())));
    useSelection.setState({ pipelineVersionId: PV, runId: RUN });
    renderWithApi(<FlowCanvas />);
    const score = await screen.findByRole("button", { name: /^score/ });
    await waitFor(() => expect(score).toHaveTextContent(/0\.947\s*accuracy/));
    expect(score).toHaveTextContent("cached");
  });

  it("shows a cached step's outputs in the inspector", async () => {
    server.use(http.get(`/api/runs/${RUN}/attempts`, () => HttpResponse.json(cachedAttempts())));
    renderWithApi(<Inspector />);
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "score" });
    expect(within(await screen.findByRole("group", { name: "accuracy" })).getByText("0.947")).toBeInTheDocument();
  });

  it("counts cached steps as done in the run summary", async () => {
    server.use(http.get(`/api/runs/${RUN}/attempts`, () => HttpResponse.json(cachedAttempts())));
    renderWithApi(<Copilot />);
    useSelection.setState({ pipelineVersionId: PV, runId: RUN });
    expect(await screen.findByText("6 of 7 step attempts done · 1 cached")).toBeInTheDocument();
  });
});

describe("a run that finishes between polls", () => {
  it("reads the attempts again once the run is finished", async () => {
    let attemptReads = 0;
    server.use(
      // The run list arrives after the first attempts read, already finished (all cached).
      http.get("/api/runs", async () => {
        await new Promise((r) => setTimeout(r, 50));
        return HttpResponse.json([run]);
      }),
      http.get(`/api/runs/${RUN}/attempts`, () => {
        attemptReads += 1;
        return HttpResponse.json(attemptReads === 1 ? [] : attempts);
      }),
    );
    renderWithApi(<Copilot />);
    useSelection.setState({ pipelineVersionId: PV, runId: RUN });
    expect(await screen.findByText("6 of 7 step attempts done", {}, { timeout: 4000 })).toBeInTheDocument();
  });
});

describe("copilot", () => {
  it("says it is not connected instead of making up answers", async () => {
    useSelection.setState({ nav: "Flow", pipelineVersionId: PV, runId: undefined, nodeId: undefined });
    renderWithApi(<Copilot />);

    expect(screen.getByText(/Copilot is not connected/)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Ask Copilot" })).toBeDisabled();
    for (const fake of ["Step Audit · Missing values ≥ 20%", "store_sales_2021_2026.csv", "German Credit v2", "Compare with 30%"]) {
      expect(screen.queryByText(fake)).not.toBeInTheDocument();
    }
  });

  it("names the open flow and its steps", async () => {
    useSelection.setState({ nav: "Flow", pipelineVersionId: PV, runId: undefined, nodeId: undefined });
    renderWithApi(<Copilot />);

    expect(await screen.findByText(`iris.csv · ${pipeline.nodes.length} steps`)).toBeInTheDocument();
    expect(screen.queryByText("German Credit · 7 steps")).not.toBeInTheDocument();
  });

  it("summarises the run's step attempts, without the gate", async () => {
    renderWithApi(<Copilot />);
    useSelection.setState({ pipelineVersionId: PV, runId: RUN });
    expect(await screen.findByText("6 of 7 step attempts done")).toBeInTheDocument();
    expect(run.status).toBe("succeeded");
  });

  it("shows an attempts error", async () => {
    server.use(http.get(`/api/runs/${RUN}/attempts`, () => HttpResponse.json({ errors: [{ code: "internal", message: "disk full" }] }, { status: 500 })));
    renderWithApi(<Copilot />);
    useSelection.setState({ pipelineVersionId: PV, runId: RUN });
    expect(await screen.findByRole("alert")).toHaveTextContent("disk full");
  });
});

describe("activity bar and sidebar", () => {
  it("navigates tabs from the icon rail and bottom Settings icon", async () => {
    const { ActivityBar } = await import("../src/views/ActivityBar.tsx");
    renderWithApi(<ActivityBar />);
    await userEvent.click(screen.getByRole("button", { name: "Datasets" }));
    expect(useSelection.getState().nav).toBe("Datasets");
    await userEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(useSelection.getState().nav).toBe("Settings");
  });

  it("opens another tab panel and resets the layout from the Views sidebar", async () => {
    const { ViewsPanel } = await import("../src/views/ViewsPanel.tsx");
    const { useWorkbench } = await import("../src/workbench/workbench.ts");
    const dock = fakeDock();
    useWorkbench.setState({ activity: "views", editing: false, dock });
    renderWithApi(<ViewsPanel />);
    await userEvent.click(screen.getByRole("button", { name: /^Console/ }));
    expect(dock.openTab).toHaveBeenCalledWith("console");
    await userEvent.click(screen.getByRole("button", { name: /Edit layout/ }));
    expect(dock.setEditing).toHaveBeenCalledWith(true);
    await userEvent.click(screen.getByRole("button", { name: /Reset to Studio layout/ }));
    expect(dock.resetLayout).toHaveBeenCalled();
  });
});

describe("pinned inspector", () => {
  it("keeps showing its pinned step when the selection moves", async () => {
    renderWithApi(<Inspector pin={{ runId: RUN, nodeId: "score" }} setPin={vi.fn()} />);
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "load" });
    expect(within(await screen.findByRole("group", { name: "accuracy" })).getByText("0.947")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unpin Data" })).toHaveAttribute("aria-pressed", "true");
  });

  it("pins to the current run and step", async () => {
    const setPin = vi.fn();
    renderWithApi(<Inspector setPin={setPin} />);
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "score" });
    await userEvent.click(await screen.findByRole("button", { name: "Pin History to this run and step" }));
    expect(setPin).toHaveBeenCalledWith({ runId: RUN, nodeId: "score" });
  });
});

