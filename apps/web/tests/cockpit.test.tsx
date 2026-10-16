import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

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
  fakeDock,
  codeDisplayJson,
  codeOutputs,
  codePipeline,
  loadOutputs,
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

  it("puts the project and flow switcher first, then the five views, then Run graph", async () => {
    renderWithApi(<TopBar />);
    const bar = screen.getByRole("banner");
    const switcher = await within(bar).findByRole("button", { name: "Project and flow" });
    const nav = within(bar).getByRole("navigation");
    const tabs = within(nav).getAllByRole("button").map((b) => b.textContent);
    expect(tabs).toEqual(["Flow", "Datasets", "Notebooks", "Experiments", "Deploy"]);
    expect(switcher.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(bar).getByRole("button", { name: /Run graph/ })).toBeInTheDocument();
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
    await userEvent.click(screen.getByRole("button", { name: /Run graph/ }));
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
    await userEvent.click(screen.getByRole("button", { name: /Run graph/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("path_outside_data_roots");
  });
});

describe("step library", () => {
  it("groups registered operators by stage", async () => {
    renderWithApi(<StepLibrary />);
    const clean = await screen.findByRole("region", { name: "Clean" });
    expect(within(clean).getByText("impute")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Model" })).getByText("linear_model")).toBeInTheDocument();
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
    expect(within(explore).getAllByText("python")).toHaveLength(1);
    expect(within(explore).getByTitle(/sprisk.code.python@1.10.0/)).toBeInTheDocument();
  });

  it("filters steps by search", async () => {
    renderWithApi(<StepLibrary />);
    await screen.findByRole("region", { name: "Clean" });
    await userEvent.type(screen.getByRole("searchbox", { name: "Search steps" }), "split");
    expect(screen.getByText("random_split")).toBeInTheDocument();
    expect(screen.queryByText("impute")).toBeNull();
  });
});

describe("flow canvas", () => {
  it("shows every step as a node with its name and latest state, with no stage boxes", async () => {
    useSelection.setState({ pipelineVersionId: PV, runId: RUN });
    useCanvasDetail.setState({ level: "compact" });
    renderWithApi(<FlowCanvas />);
    const split = await screen.findByRole("button", { name: /^split/ });
    await waitFor(() => expect(split).toHaveTextContent(/^split\s*Transform$/));
    expect(split.querySelector(".state-dot")).toHaveAccessibleName("succeeded");
    expect(document.querySelector(".stage-frame")).toBeNull();
    expect(screen.queryByRole("button", { name: /gate_b/ })).toBeNull();
  });

  it("places each step to the right of the steps it reads", async () => {
    const { flowPositions } = await import("../src/flow/layout.ts");
    const at = await flowPositions(pipeline, () => ({ width: 168, height: 44 }));
    const x = (id: string) => at.get(id)!.x;
    expect(x("load")).toBeLessThan(x("split"));
    expect(x("split")).toBeLessThan(x("model"));
    expect(x("model")).toBeLessThan(x("score"));
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
    expect(useSelection.getState()).toMatchObject({ nav: "Experiments", compare: [older.id, RUN] });
  });

  it("technical details show media types and hashes only when switched on", async () => {
    renderWithApi(<Inspector />);
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "score" });
    await screen.findByRole("group", { name: "accuracy" });
    await userEvent.click(screen.getByRole("checkbox", { name: "Technical" }));
    expect(screen.getByText(/application\/json · 80 bytes/)).toBeInTheDocument();
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
  it("badges the Checks tab when a check on this step did not pass", async () => {
    const failing = JSON.parse(checksJson).map((c: { verdict: string }) => ({ ...c, verdict: "fail" }));
    server.use(http.get("/api/artifacts/:id/content", ({ params }) =>
      HttpResponse.text(params.id === "art_01JABCDEFGHJKMNPQRSTVWXYZ1" ? JSON.stringify(failing) : "{}"),
    ));
    renderWithApi(<Inspector />);
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "split" });
    expect(await screen.findByRole("tab", { name: "Checks, 1 to review" })).toBeInTheDocument();
  });

  it("shows methodology checks that cite the selected step", async () => {
    renderWithApi(<Inspector />);
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "split" });
    await userEvent.click(await screen.findByRole("tab", { name: "Checks" }));
    const checks = await screen.findByRole("region", { name: "Methodology checks" });
    expect(within(checks).getByLabelText("pass")).toBeInTheDocument();
    expect(checks).toHaveTextContent("at most one non-baseline model");
  });

  it("says so when the checks output is not a list of checks", async () => {
    server.use(http.get("/api/artifacts/:id/content", () => HttpResponse.text('{"verdict": "pass"}')));
    renderWithApi(<Inspector />);
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "split" });
    await userEvent.click(await screen.findByRole("tab", { name: "Checks" }));
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
    expect(await screen.findByText(/first 2 of 340 columns/)).toBeInTheDocument();
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
    expect(within(sepal).getByRole("img", { name: "min 4.3, q25 5.1, median 5.8, q75 6.4, max 7.9" })).toBeInTheDocument();
  });

  it("shows a text column's range without a spread strip", async () => {
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
    expect(posted.runs[0]).toEqual({ pipeline_version_id: version.id });
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

  it("does not download output above the cap", async () => {
    await showCode(codeDisplayJson, 10_000_000);
    expect(await screen.findByText(/Too large to show here/)).toBeInTheDocument();
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
  };
  function withInterface() {
    const posted: { params: Record<string, unknown> }[] = [];
    server.use(
      http.get("/api/pipeline_versions", () => HttpResponse.json([v12])),
      http.get(`/api/runs/${RUN}/attempts`, () => HttpResponse.json([...attempts, codeAttempt])),
      http.get(`/api/attempts/${codeAttempt.id}/outputs`, () => HttpResponse.json([...codeOutputs, iface])),
      http.get(`/api/artifacts/${iface.artifact.id}/content`, () => HttpResponse.text(JSON.stringify(report))),
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

  it("Inputs lists the names the code reads, marking names nothing defines", async () => {
    withInterface();
    await openCode("Inputs");
    const names = await screen.findByRole("region", { name: "Names read by the code" });
    expect(within(names).getByText("data").closest("li")).toHaveTextContent("the input table");
    expect(within(names).getByText("lookup").closest("li")).toHaveTextContent("nothing defines it");
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
    await openCode("Data");
    const values = await screen.findByRole("region", { name: "Values in your code" });
    await userEvent.click(within(values).getByRole("radio", { name: /out · 120 rows × 2 cols/ }));
    await userEvent.click(within(values).getByRole("button", { name: "Pass this on and run" }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]!.params).toEqual({ source: "factor = 2\nout = data", output: "out" });
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

  it("a step with several tables shows one sub-tab per table in Data", async () => {
    withSplitOutputs();
    renderWithApi(<Inspector />);
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "split" });
    const tables = await screen.findByRole("tablist", { name: "Outputs" });
    expect(within(tables).getAllByRole("tab").map((t) => t.textContent)).toEqual(["test", "train"]);
    expect(await screen.findByRole("region", { name: "Table · test" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Table · train" })).toBeNull();
    await userEvent.click(within(tables).getByRole("tab", { name: "train" }));
    expect(await screen.findByRole("region", { name: "Table · train" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Table · test" })).toBeNull();
  });

  it("shows round steps with name and state in Compact and full cards in Detail; there is no Summary", async () => {
    useSelection.setState({ pipelineVersionId: PV, runId: RUN });
    renderWithApi(<FlowCanvas />);
    await userEvent.click(await screen.findByRole("radio", { name: "Compact" }));
    expect(screen.getAllByRole("radio").map((r) => r.textContent)).toEqual(["Compact", "Detail"]);
    const score = await screen.findByRole("button", { name: /^score/ });
    expect(score).toHaveTextContent(/^score\s*Evaluation$/);
    expect(score.querySelector(".state-dot.tone-done")).not.toBeNull();
    expect(score.querySelector(".round-icon")).not.toBeNull();

    await userEvent.click(screen.getByRole("radio", { name: "Detail" }));
    const card = await screen.findByRole("button", { name: /^score/ });
    await waitFor(() => expect(card.querySelector(".card-status")).toHaveTextContent("succeeded"));
    expect(screen.getByRole("radio", { name: "Detail" })).toHaveAttribute("aria-checked", "true");
  });

  it("a remembered Summary choice opens as Detail", async () => {
    const { readLevel } = await import("../src/workbench/detail.ts");
    expect(readLevel("summary")).toBe("detail");
    expect(readLevel("compact")).toBe("compact");
    expect(readLevel(42)).toBe("detail");
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
  it("switches the sidebar and collapses it when the active icon is clicked again", async () => {
    const { ActivityBar } = await import("../src/views/ActivityBar.tsx");
    const { Sidebar } = await import("../src/views/Sidebar.tsx");
    const { useWorkbench } = await import("../src/workbench/workbench.ts");
    const setSidebarVisible = vi.fn();
    useWorkbench.setState({ activity: "steps", editing: false, dock: fakeDock({ setSidebarVisible }) });
    useSelection.setState({ pipelineVersionId: PV });
    renderWithApi(
      <>
        <ActivityBar />
        <Sidebar />
      </>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Runs" }));
    expect(await screen.findByText(RUN.slice(-8))).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Runs" }));
    expect(useWorkbench.getState().activity).toBeUndefined();
    expect(setSidebarVisible).toHaveBeenLastCalledWith(false);
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
    expect(screen.getByRole("button", { name: /Pinned/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("pins to the current run and step", async () => {
    const setPin = vi.fn();
    renderWithApi(<Inspector setPin={setPin} />);
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "score" });
    await userEvent.click(await screen.findByRole("button", { name: /Pin/ }));
    expect(setPin).toHaveBeenCalledWith({ runId: RUN, nodeId: "score" });
  });
});
