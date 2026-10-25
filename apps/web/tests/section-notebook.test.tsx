import type { FlowDecision } from "@sprisk/contracts";
import { screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { StageNotebook } from "../src/views/notebook/StageNotebook.tsx";
import { stageNotebooks } from "../src/notebook/stageNotebooks.ts";
import { operators, pipeline } from "./fixtures.ts";
import { renderWithApi } from "./render.tsx";
import { server } from "./server.ts";

const fair: FlowDecision = {
  decides: "split.method",
  method: "methodology.supervised.split_method@1.0.0",
  name: "Train/test split",
  activity: "Fair evaluation",
  question: "How are rows divided into training and test so the score is fair?",
  option: "item_groups",
  label: "Keep each item's rows on one side",
  reason: "Rows of one item stay on one side, so no item is scored on rows the model saw.",
  assurance: "rule",
  steps: ["split"],
  promises: [
    { verification: "no_group_overlap", promise: "No item has rows in both train and test.", status: "fail",
      detail: "3 items have rows in both train and test: 12, 40, 77", step: "split" },
  ],
};

describe("a notebook section for an activity (ADR-0063)", () => {
  it("opens with the question, the finding, the decision and its promises, then the section's cells", async () => {
    server.use(
      http.get(`/api/pipeline_versions/${pipeline.id}/decisions`, () =>
        HttpResponse.json({ schema_version: "sprisk.flow_decisions/v1", pipeline_version_id: pipeline.id, decisions: [fair] }),
      ),
    );
    const byRef = new Map(operators.map((o) => [o.id, o]));
    const section = stageNotebooks(pipeline, byRef, [fair]).find((s) => s.name === "Split")!;
    renderWithApi(<StageNotebook pipeline={pipeline} section={section} />);

    expect(await screen.findByRole("heading", { name: "Train/test split" })).toBeInTheDocument();
    const block = screen.getByRole("region", { name: "Decision: How are rows divided into training and test so the score is fair?" });
    expect(within(block).getByText(fair.reason)).toBeInTheDocument();
    expect(within(block).getByText("Keep each item's rows on one side")).toBeInTheDocument();
    const promise = within(block).getByRole("listitem", { name: "No item has rows in both train and test." });
    expect(within(promise).getByText("Fails")).toBeInTheDocument();
  });
});
