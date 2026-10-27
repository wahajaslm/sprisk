import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { parse } from "@sprisk/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import questionJson from "../../../tests/contract/question_version/valid/classification-with-bindings.json";
import { ObjectivePage } from "../src/views/objective/ObjectivePage.tsx";
import { useSelection } from "../src/workbench/selection.ts";
import { PV, pipeline } from "./fixtures.ts";
import { renderWithApi } from "./render.tsx";
import { server } from "./server.ts";

const question = parse("QuestionVersion", questionJson);
const concepts = {
  schema_version: "sprisk.concept_set/v1",
  concepts: {
    "common.item_title": {
      kind: "text",
      description: "Short text that names the item a row describes.",
      binds_to: ["column"],
    },
  },
};

describe("Objective ledger", () => {
  beforeEach(() => useSelection.setState({ nav: "Objective", pipelineVersionId: undefined }));

  it("shows which column means each concept, and each decision a person answered", async () => {
    const answered = { ...question, answers: [{ decides: "data.repeated_items", option: "group_by_title" }] };
    server.use(
      http.get("/api/question_versions", () => HttpResponse.json([answered])),
      http.get("/api/concepts", () => HttpResponse.json(concepts)),
    );
    renderWithApi(<ObjectivePage />);

    const binding = (await screen.findByText("Short text that names the item a row describes.")).closest("tr")!;
    expect(within(binding).getByText("designation")).toBeInTheDocument();
    expect(within(binding).getByText("stated")).toBeInTheDocument();
    const answer = screen.getByText("data.repeated_items").closest("tr")!;
    expect(within(answer).getByText("group_by_title")).toBeInTheDocument();
    expect(within(answer).getByText("answered")).toBeInTheDocument();
  });
});

describe("Linking a question to the open flow", () => {
  beforeEach(() => useSelection.setState({ nav: "Objective", pipelineVersionId: PV }));

  it("saves a new version that reads the question and opens it, leaving the old version as it was", async () => {
    let sent: Record<string, unknown> | undefined;
    server.use(
      http.get("/api/question_versions", () => HttpResponse.json([question])),
      http.get("/api/pipeline_versions", () => HttpResponse.json([pipeline])),
      http.post("/api/pipeline_versions", async ({ request }) => {
        sent = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(sent, { status: 201 });
      }),
    );
    renderWithApi(<ObjectivePage />);

    await userEvent.click(await screen.findByRole("button", { name: "Link to current pipeline" }));

    await waitFor(() => expect(sent).toBeDefined());
    expect(sent?.id).not.toBe(PV);
    expect(sent?.parent_id).toBe(PV);
    expect(sent?.question_version_id).toBe(question.id);
    expect(sent?.nodes).toEqual(pipeline.nodes);
    await waitFor(() => expect(useSelection.getState().pipelineVersionId).toBe(sent?.id));
  });
});

describe("starting a new question", () => {
  beforeEach(() => useSelection.setState({ nav: "Objective", pipelineVersionId: undefined }));

  it("opens the data source picker, and goes back to the ledger unchanged", async () => {
    server.use(http.get("/api/question_versions", () => HttpResponse.json([question])));
    renderWithApi(<ObjectivePage />);

    await userEvent.click(await screen.findByRole("button", { name: "New question" }));
    expect(await screen.findByRole("heading", { name: "Which data is the question about?" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Back to ledger" }));
    expect(await screen.findByRole("heading", { name: question.objective.value })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Which data is the question about?" })).toBeNull();
  });
});
