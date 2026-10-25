import { parse } from "@sprisk/contracts";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import tableJson from "../../../tests/contract/loaded_table/valid/loaded-by-two-flows.json";
import questionJson from "../../../tests/contract/question_version/valid/classification-all-fields.json";
import { ReportsPage } from "../src/views/reports/ReportsPage.tsx";
import { useSelection } from "../src/workbench/selection.ts";
import { PV, pipeline } from "./fixtures.ts";
import { renderWithApi } from "./render.tsx";
import { server } from "./server.ts";

const question = parse("QuestionVersion", questionJson);
const earlier = { ...question, id: question.parent_id!, objective: { value: "Predict returns.", origin: "explicit" as const }, created_at: "2026-10-14T10:00:00Z" };
const { parent_id: _parent, ...first } = earlier;

function ledger() {
  server.use(
    http.get("/api/question_versions", () => HttpResponse.json([question, first])),
    http.get("/api/pipeline_versions", () => HttpResponse.json([{ ...pipeline, question_version_id: question.id }])),
    http.get("/api/loaded_tables", () => HttpResponse.json([tableJson])),
  );
  useSelection.setState({ pipelineVersionId: PV });
}

describe("the question ledger report", () => {
  it("lists the objective, then each open unknown under what it must be settled before", async () => {
    ledger();
    renderWithApi(<ReportsPage />);
    const side = await screen.findByRole("complementary", { name: "Questions" });
    expect(within(side).getByRole("button", { name: /Predict which orders will be returned/ })).toBeInTheDocument();
    expect(within(side).getByText("Before release")).toBeInTheDocument();
    expect(within(side).getByRole("button", { name: /Are exchanges counted as returns\?.*Open/ })).toBeInTheDocument();
  });

  it("shows the objective with its framing, assumptions, criteria, evidence and history", async () => {
    ledger();
    renderWithApi(<ReportsPage />);
    expect(await screen.findByRole("heading", { level: 2, name: question.objective.value })).toBeInTheDocument();
    const framing = screen.getByRole("region", { name: "Current answer" });
    expect(framing).toHaveTextContent("classification");
    expect(framing).toHaveTextContent("returned_within_30d");
    expect(screen.getByRole("region", { name: "Assumptions" })).toHaveTextContent("Return labels are complete after 30 days.");
    expect(screen.getByRole("region", { name: "Acceptance criteria" })).toHaveTextContent("Average precision beats the dummy baseline");
    expect(await screen.findByRole("button", { name: "Open pipeline iris.csv" })).toBeInTheDocument();
    const history = screen.getByRole("region", { name: "History" });
    expect(history).toHaveTextContent("Predict returns.");
  });

  it("says an open unknown has no answer yet, and what it holds up", async () => {
    ledger();
    renderWithApi(<ReportsPage />);
    await userEvent.click(await screen.findByRole("button", { name: /Are exchanges counted as returns\?/ }));
    expect(screen.getByRole("heading", { level: 2, name: "Are exchanges counted as returns?" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Current answer" })).toHaveTextContent("Not answered yet. It must be settled before release.");
  });

  it("counts the open entries in the info dock", async () => {
    ledger();
    renderWithApi(<ReportsPage />);
    const dock = await screen.findByRole("region", { name: "Info" });
    expect(dock).toHaveTextContent("Open1");
  });

  it("adds a question on the Objective page", async () => {
    ledger();
    renderWithApi(<ReportsPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Add question" }));
    expect(useSelection.getState().nav).toBe("Objective");
  });

  it("lists the loaded tables as sources", async () => {
    ledger();
    renderWithApi(<ReportsPage />);
    await userEvent.click(await screen.findByRole("tab", { name: "Sources" }));
    const sources = await screen.findByRole("list", { name: "Sources" });
    expect(sources).toHaveTextContent("diabetes.csv");
    expect(sources).toHaveTextContent("442 rows · 11 columns");
  });

  it("points to the Objective page when there is no question yet", async () => {
    renderWithApi(<ReportsPage />);
    expect(await screen.findByText("No question yet. State one on the Objective page.")).toBeInTheDocument();
  });

  it("searches the ledger and hides a group with nothing left in it", async () => {
    ledger();
    renderWithApi(<ReportsPage />);
    const side = await screen.findByRole("complementary", { name: "Questions" });
    await userEvent.type(within(side).getByRole("searchbox", { name: "Search questions" }), "orders");
    expect(within(side).getByRole("button", { name: /Predict which orders/ })).toBeInTheDocument();
    expect(within(side).queryByText("Before release")).toBeNull();
  });

  it("shows why the questions cannot be read", async () => {
    server.use(http.get("/api/question_versions", () => HttpResponse.json({ errors: [{ code: "internal", message: "disk full" }] }, { status: 500 })));
    renderWithApi(<ReportsPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("disk full");
  });
});
