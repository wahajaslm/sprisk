import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { FlowCanvas } from "../src/views/FlowCanvas.tsx";
import { Inspector } from "../src/views/Inspector.tsx";
import { StepLibrary } from "../src/views/StepLibrary.tsx";
import { TopBar } from "../src/views/TopBar.tsx";
import { useSelection } from "../src/workbench/selection.ts";
import { Copilot } from "../src/views/Copilot.tsx";
import { PV, RUN, run, scoreOutputs } from "./fixtures.ts";
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

describe("copilot", () => {
  it("summarises the run's step attempts, without the gate", async () => {
    renderWithApi(<Copilot />);
    useSelection.setState({ pipelineVersionId: PV, runId: RUN });
    expect(await screen.findByText("5 of 6 step attempts succeeded")).toBeInTheDocument();
    expect(run.status).toBe("succeeded");
  });

  it("shows an attempts error", async () => {
    server.use(http.get(`/api/runs/${RUN}/attempts`, () => HttpResponse.json({ errors: [{ code: "internal", message: "disk full" }] }, { status: 500 })));
    renderWithApi(<Copilot />);
    useSelection.setState({ pipelineVersionId: PV, runId: RUN });
    expect(await screen.findByRole("alert")).toHaveTextContent("disk full");
  });
});
