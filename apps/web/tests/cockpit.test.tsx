import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import { FlowCanvas } from "../src/views/FlowCanvas.tsx";
import { Inspector } from "../src/views/Inspector.tsx";
import { StepLibrary } from "../src/views/StepLibrary.tsx";
import { TopBar } from "../src/views/TopBar.tsx";
import { useSelection } from "../src/workbench/selection.ts";
import { Copilot } from "../src/views/Copilot.tsx";
import { PV, RUN, loadOutputs, profilePage, run, scoreOutputs, tablePage } from "./fixtures.ts";
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

  it("filters steps by search", async () => {
    renderWithApi(<StepLibrary />);
    await screen.findByRole("region", { name: "Clean" });
    await userEvent.type(screen.getByRole("searchbox", { name: "Search steps" }), "split");
    expect(screen.getByText("random_split")).toBeInTheDocument();
    expect(screen.queryByText("impute")).toBeNull();
  });
});

describe("flow canvas", () => {
  it("shows every node in a stage frame with its latest attempt state", async () => {
    useSelection.setState({ pipelineVersionId: PV, runId: RUN });
    renderWithApi(<FlowCanvas />);
    const split = await screen.findByRole("button", { name: /^split/ });
    await waitFor(() => expect(split).toHaveTextContent("succeeded"));
    expect(screen.getByText("Split").closest(".stage-frame-head")).toHaveTextContent("02Split1 step");
    expect(screen.queryByRole("button", { name: /gate_b/ })).toBeNull();
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
  it("Data tab shows the selected step's JSON outputs", async () => {
    renderWithApi(<Inspector />);
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "score" });
    expect(await screen.findByText(/"accuracy": 0.947/)).toBeInTheDocument();
  });

  it("Logs tab lists every attempt, failures with their error", async () => {
    renderWithApi(<Inspector />);
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "split" });
    await userEvent.click(await screen.findByRole("tab", { name: "Logs" }));
    expect(await screen.findByText(/worker_lost/)).toBeInTheDocument();
    expect(screen.getByText(/#2/)).toBeInTheDocument();
  });

  it("asks for a selection when nothing is selected", () => {
    renderWithApi(<Inspector />);
    expect(screen.getByText(/Select a step/)).toBeInTheDocument();
  });
});

describe("inspector failures and checks", () => {
  it("shows methodology checks that cite the selected step", async () => {
    renderWithApi(<Inspector />);
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "split" });
    const checks = await screen.findByRole("region", { name: "Methodology checks" });
    expect(within(checks).getByLabelText("pass")).toBeInTheDocument();
    expect(checks).toHaveTextContent("at most one non-baseline model");
  });

  it("says so when the checks output is not a list of checks", async () => {
    server.use(http.get("/api/artifacts/:id/content", () => HttpResponse.text('{"verdict": "pass"}')));
    renderWithApi(<Inspector />);
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "split" });
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
    expect(screen.getByText("Rows 1–50 of 120")).toBeInTheDocument();
  });

  it("marks a missing cell instead of showing it blank", async () => {
    renderWithApi(<Inspector />);
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "load" });
    const table = await screen.findByRole("table", { name: "data rows" });
    expect(within(within(table).getByRole("row", { name: /^4 / })).getByLabelText("missing")).toBeInTheDocument();
  });

  it("pages forward and back without loading the whole table", async () => {
    const offsets: string[] = [];
    server.use(
      http.get("/api/artifacts/:id/content", ({ params }) => {
        if (params.id === loadOutputs[0]!.artifact.id) throw new Error("a table must never be downloaded");
        return HttpResponse.text("[]");
      }),
      http.get("/api/artifacts/:id/rows", ({ request }) => {
        const url = new URL(request.url);
        offsets.push(`${url.searchParams.get("offset")}/${url.searchParams.get("limit")}`);
        return HttpResponse.json(tablePage(Number(url.searchParams.get("offset")), 50));
      }),
    );
    renderWithApi(<Inspector />);
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "load" });
    await screen.findByText("Rows 1–50 of 120");
    expect(screen.getByRole("button", { name: "Previous rows" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Next rows" }));
    await userEvent.click(await screen.findByRole("button", { name: "Next rows" }));
    expect(await screen.findByText("Rows 101–120 of 120")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next rows" })).toBeDisabled();
    expect(offsets).toEqual(["0/50", "50/50", "100/50"]);
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
    expect(await screen.findByText("accuracy 0.947")).toBeInTheDocument();
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

describe("copilot", () => {
  it("summarises the run's step attempts, without the gate", async () => {
    renderWithApi(<Copilot />);
    useSelection.setState({ pipelineVersionId: PV, runId: RUN });
    expect(await screen.findByText("6 of 7 step attempts succeeded")).toBeInTheDocument();
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
    useWorkbench.setState({ activity: "steps", editing: false, dock: { addView: vi.fn(), resetLayout: vi.fn(), setEditing: vi.fn(), setSidebarVisible } });
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

  it("opens another view and resets the layout from the Views sidebar", async () => {
    const { ViewsPanel } = await import("../src/views/ViewsPanel.tsx");
    const { useWorkbench } = await import("../src/workbench/workbench.ts");
    const dock = { addView: vi.fn(), resetLayout: vi.fn(), setEditing: vi.fn(), setSidebarVisible: vi.fn() };
    useWorkbench.setState({ activity: "views", editing: false, dock });
    renderWithApi(<ViewsPanel />);
    await userEvent.click(screen.getByRole("button", { name: /^Inspector/ }));
    expect(dock.addView).toHaveBeenCalledWith("inspector");
    await userEvent.click(screen.getByRole("button", { name: /Edit layout/ }));
    expect(dock.setEditing).toHaveBeenCalledWith(true);
    await userEvent.click(screen.getByRole("button", { name: /Reset to Studio layout/ }));
    expect(dock.resetLayout).toHaveBeenCalled();
  });
});

describe("pinned inspector", () => {
  it("keeps showing its pinned step when the selection moves", async () => {
    const { ViewInstance } = await import("../src/workbench/instance.tsx");
    renderWithApi(
      <ViewInstance pin={{ runId: RUN, nodeId: "score" }} setPin={vi.fn()}>
        <Inspector />
      </ViewInstance>,
    );
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "load" });
    expect(await screen.findByText(/"accuracy": 0.947/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Pinned/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("pins to the current run and step", async () => {
    const { ViewInstance } = await import("../src/workbench/instance.tsx");
    const setPin = vi.fn();
    renderWithApi(
      <ViewInstance pin={undefined} setPin={setPin}>
        <Inspector />
      </ViewInstance>,
    );
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "score" });
    await userEvent.click(await screen.findByRole("button", { name: /Pin/ }));
    expect(setPin).toHaveBeenCalledWith({ runId: RUN, nodeId: "score" });
  });
});
