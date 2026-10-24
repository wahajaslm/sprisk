import type { FlowDecisions, PipelineVersion } from "@sprisk/contracts";
import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import groupSplit from "../../../tests/contract/flow_decisions/valid/group-split.json";
import methodFiles from "../../../tests/contract/method_files/valid/split-method.json";
import { FilesTab } from "../src/views/inspector/FilesTab.tsx";
import { renderWithApi } from "./render.tsx";
import { server } from "./server.ts";

const decided = groupSplit as FlowDecisions;
const pipeline: PipelineVersion = {
  schema_version: "sprisk.pipeline_version/v1",
  id: decided.pipeline_version_id,
  project_id: "prj_01JABCDEFGHJKMNPQRSTVWXYZ0",
  nodes: [
    { id: "split", operator: "sprisk.validation.group_split@1.0.0", params: {} },
    { id: "model", operator: "sprisk.ml.linear_model@1.0.0", params: {} },
  ],
  edges: [],
  created_at: "2026-10-24T10:00:00Z",
};
const operatorSource = {
  operator: "sprisk.validation.group_split@1.0.0", path: "sprisk_validation/split.py", language: "python",
  text: "def group_split(data, group_column):\n    ...\n", digest: `sha256:${"a".repeat(64)}`,
};

function render(nodeId: string) {
  server.use(
    http.get(`/api/pipeline_versions/${pipeline.id}/decisions`, () => HttpResponse.json(decided)),
    http.get("/api/methods/:id/files", () => HttpResponse.json(methodFiles)),
    http.get("/api/operators/:id/source", () => HttpResponse.json(operatorSource)),
  );
  renderWithApi(<FilesTab pipeline={pipeline} nodeId={nodeId} />);
}

describe("a step's files (ADR-0063)", () => {
  it("shows the code the step runs, then the files of each method that shaped it", async () => {
    render("split");
    expect(await screen.findByRole("region", { name: "sprisk_validation/split.py" })).toHaveTextContent("def group_split");
    expect(await screen.findByRole("region", { name: "methodology.supervised.split_method@1.0.0 · method.yaml" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "methodology.supervised.split_method@1.0.0 · method.py" })).toHaveTextContent("def decide(ctx)");
  });

  it("shows only the step's own code when no method shaped it", async () => {
    server.use(http.get("/api/operators/:id/source", () => HttpResponse.json({ ...operatorSource, operator: "sprisk.ml.linear_model@1.0.0", path: "sprisk_ml/linear.py" })));
    render("model");
    expect(await screen.findByText("No method shaped this step.")).toBeInTheDocument();
  });
});
