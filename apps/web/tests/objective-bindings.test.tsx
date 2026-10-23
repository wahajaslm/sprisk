import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { parse } from "@sprisk/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import questionJson from "../../../tests/contract/question_version/valid/classification-with-bindings.json";
import { ObjectivePage } from "../src/views/objective/ObjectivePage.tsx";
import { useSelection } from "../src/workbench/selection.ts";
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

describe("Objective page bindings", () => {
  beforeEach(() => useSelection.setState({ nav: "Objective", pipelineVersionId: undefined }));

  it("states which column means each concept, keeping what the question already binds", async () => {
    let sent: Record<string, unknown> | undefined;
    server.use(
      http.get("/api/question_versions", () => HttpResponse.json([question])),
      http.get("/api/concepts", () => HttpResponse.json(concepts)),
      http.post("/api/question_versions", async ({ request }) => {
        sent = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(sent, { status: 201 });
      }),
    );
    renderWithApi(<ObjectivePage />);

    await userEvent.click(await screen.findByRole("button", { name: "Revise question" }));
    const title = await screen.findByLabelText(/^Short text that names the item a row describes\./);
    expect(title).toHaveValue("designation");
    await userEvent.clear(title);
    await userEvent.type(title, "titre");
    await userEvent.click(screen.getByRole("button", { name: "Save revision" }));

    await waitFor(() => expect(sent).toBeDefined());
    // A revision says which question it revises, so the page can follow it.
    expect(sent?.parent_id).toBe(question.id);
    expect(sent?.bindings).toEqual([
      {
        schema_version: "sprisk.binding/v1",
        concept: "common.item_title",
        source: { column: "titre" },
        set_by: { assurance: "stated" },
      },
    ]);
  });

  it("leaves a concept unbound when its column is left empty", async () => {
    let sent: Record<string, unknown> | undefined;
    server.use(
      http.get("/api/question_versions", () => HttpResponse.json([question])),
      http.get("/api/concepts", () => HttpResponse.json(concepts)),
      http.post("/api/question_versions", async ({ request }) => {
        sent = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(sent, { status: 201 });
      }),
    );
    renderWithApi(<ObjectivePage />);

    await userEvent.click(await screen.findByRole("button", { name: "Revise question" }));
    await userEvent.clear(await screen.findByLabelText(/^Short text that names the item a row describes\./));
    await userEvent.click(screen.getByRole("button", { name: "Save revision" }));

    await waitFor(() => expect(sent).toBeDefined());
    expect(sent?.bindings).toBeUndefined();
  });
});
