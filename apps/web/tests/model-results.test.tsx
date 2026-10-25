import { parse } from "@sprisk/contracts";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import costedJson from "../../../tests/contract/classification_report/valid/costed-no-scores-no-mistakes.json";
import threeClassesJson from "../../../tests/contract/classification_report/valid/three-classes.json";
import { ModelResults } from "../src/views/inspector/ModelResults.tsx";
import { PV, RUN, run, scoreAttempt, scoreOutputs } from "./fixtures.ts";
import { Inspector } from "./inspector.tsx";
import { renderWithApi } from "./render.tsx";
import { server } from "./server.ts";
import { useSelection } from "../src/workbench/selection.ts";

const threeClasses = parse("ClassificationReport", threeClassesJson);
const costed = parse("ClassificationReport", costedJson);

const cells = (row: HTMLElement) => within(row).getAllByRole("cell").map((c) => c.textContent);

describe("model results for a classifier", () => {
  it("leads with weighted F1, then macro F1, accuracy and balanced accuracy, as given", () => {
    const report = { ...threeClasses, weighted_f1: 0.8123, f1_macro: 0.7, accuracy: 0.9, balanced_accuracy: 0.65 };
    render(<ModelResults report={report} />);
    const tiles = screen.getAllByRole("group").map((g) => g.getAttribute("aria-label"));
    expect(tiles).toEqual(["Weighted F1", "Macro F1", "Accuracy", "Balanced accuracy"]);
    expect(within(screen.getByRole("group", { name: "Weighted F1" })).getByText("0.812")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Balanced accuracy" })).getByText("0.65")).toBeInTheDocument();
  });

  it("lists classes lowest F1 first, and sorts by support on request", async () => {
    const report = {
      ...threeClasses,
      per_class: [
        { label: "a", precision: 0.9, recall: 0.8, f1: 0.85, support: 5 },
        { label: "b", precision: 0.4, recall: 0.3, f1: 0.35, support: 40 },
        { label: "c", precision: 0.6, recall: 0.6, f1: 0.6, support: 12 },
      ],
    };
    render(<ModelResults report={report} />);
    const table = screen.getByRole("table", { name: "Per class" });
    const labels = () => within(table).getAllByRole("row").slice(1).map((r) => cells(r)[0]);
    expect(labels()).toEqual(["b", "c", "a"]);
    expect(cells(within(table).getAllByRole("row")[1]!)).toEqual(["b", "0.4", "0.3", "0.35", "40"]);
    await userEvent.click(within(table).getByRole("button", { name: "Support" }));
    expect(labels()).toEqual(["a", "c", "b"]);
  });

  it("lists the most confused pairs with their counts", () => {
    render(<ModelResults report={threeClasses} />);
    const list = screen.getByRole("list", { name: "Most confused pairs" });
    expect(within(list).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["a → b · 1", "b → c · 1", "c → a · 1"]);
  });

  it("draws how close the wrong answers were from the evaluator's bins", () => {
    render(<ModelResults report={threeClasses} />);
    expect(screen.getByRole("img", { name: "How close the wrong answers were" })).toBeInTheDocument();
  });

  it("draws no margin chart when the model gives no scores", () => {
    render(<ModelResults report={costed} />);
    expect(screen.queryByRole("img", { name: /How close/ })).toBeNull();
    expect(screen.getByText("No test row was misclassified.")).toBeInTheDocument();
  });

  it("shows the sampled wrong rows, out of all of them", () => {
    render(<ModelResults report={{ ...threeClasses, misclassified_sample: { ...threeClasses.misclassified_sample, n_total: 41 } }} />);
    const table = screen.getByRole("table", { name: "Misclassified rows" });
    expect(cells(within(table).getAllByRole("row")[1]!)).toEqual(["1", "a", "b", "0.25"]);
    expect(screen.getByText("3 of 41 misclassified rows")).toBeInTheDocument();
  });
});

describe("evaluator output in the Data tab", () => {
  /** Later handlers win in MSW, so a test's own handlers go after the shown content's. */
  function show(content: unknown, ...handlers: Parameters<typeof server.use>) {
    server.use(http.get("/api/artifacts/:id/content", () => HttpResponse.text(JSON.stringify(content))));
    server.use(...handlers);
    renderWithApi(<Inspector />);
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: "score" });
  }

  it("shows a classification report as model results", async () => {
    show(threeClassesJson);
    expect(await screen.findByRole("group", { name: "Weighted F1" })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Per class" })).toBeInTheDocument();
  });

  it("keeps the plain metric tiles for an older run's metrics", async () => {
    const { per_class: _dropped, ...older } = threeClassesJson;
    show(older);
    expect(await screen.findByRole("group", { name: "weighted f1" })).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "Per class" })).toBeNull();
  });

  it("shows each headline metric's change since the previous run", async () => {
    const older = { ...run, id: "run_01JABCDEFGHJKMNPQRSTVWXYZ1" };
    const olderScore = { ...scoreAttempt, id: "att_01JABCDEFGHJKMNPQRSTVWXY55", run_id: older.id };
    const olderMetrics = { ...scoreOutputs[0]!, artifact: { ...scoreOutputs[0]!.artifact, id: "art_01JABCDEFGHJKMNPQRSTVWXY55" } };
    show(
      threeClassesJson,
      http.get("/api/runs", () => HttpResponse.json([run, older])),
      http.get(`/api/runs/${older.id}/attempts`, () => HttpResponse.json([olderScore])),
      http.get(`/api/attempts/${olderScore.id}/outputs`, () => HttpResponse.json([olderMetrics])),
      http.get(`/api/artifacts/${olderMetrics.artifact.id}/content`, () => HttpResponse.text(JSON.stringify({ ...threeClassesJson, weighted_f1: 0.4 }))),
    );
    const tile = await screen.findByRole("group", { name: "Weighted F1" });
    await waitFor(() => expect(tile).toHaveTextContent("▲ 0.1 vs last run"));
  });
});
