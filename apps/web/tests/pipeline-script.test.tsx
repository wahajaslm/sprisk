import type { PipelineVersion } from "@sprisk/contracts";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import { pipelineScript } from "../src/notebook/script.ts";
import { stageNotebooks } from "../src/notebook/stageNotebooks.ts";
import { StageNotebook } from "../src/views/notebook/StageNotebook.tsx";
import { useSelection } from "../src/workbench/selection.ts";
import { notebookOperator, operators, pipeline, RUN } from "./fixtures.ts";
import { renderWithApi } from "./render.tsx";
import { server } from "./server.ts";

/** The fixture flow with a code step that reads the imputed train rows. */
const flow: PipelineVersion = {
  ...pipeline,
  nodes: [...pipeline.nodes, { id: "rate", operator: notebookOperator.id, params: { source: "rate = impute_train.height", inputs: ["impute_train"], outputs: [] } }],
  edges: [...pipeline.edges, { from: "impute.train", to: "rate.impute_train" }],
};

// Split and impute write themselves as plain code; no other ready-made step here does.
const WRITERS: Record<string, string> = {
  "sprisk.validation.random_split@1.0.0": "split_train, split_test = shuffle(load_data)\n",
  "sprisk.clean.impute@1.0.0": "impute_train, impute_test = fill(split_train, split_test)\n",
};
const writing = operators.map((o) => (WRITERS[o.id] ? { ...o, notebook_code: "sprisk_x.y:as_code" } : o));
const byRef = new Map([...writing, notebookOperator].map((o) => [o.id, o]));

const SCRIPT = `# load · sprisk.io.file_source@1.0.0
# No plain code for this step yet.

# profile · sprisk.profile.summarize@1.0.0
# No plain code for this step yet.

# split · sprisk.validation.random_split@1.0.0
split_train, split_test = shuffle(load_data)

# impute · sprisk.clean.impute@1.0.0
impute_train, impute_test = fill(split_train, split_test)

# rate · sprisk.code.python@2.0.0
rate = impute_train.height

# model · sprisk.ml.linear_model@1.0.0
# No plain code for this step yet.

# score · sprisk.ml.evaluate@1.0.0
# No plain code for this step yet.
`;

describe("the pipeline as one script (ADR-0055)", () => {
  it("joins each step's code in notebook order, saying which steps have none", () => {
    const code = new Map([
      ["split", WRITERS["sprisk.validation.random_split@1.0.0"]!],
      ["impute", WRITERS["sprisk.clean.impute@1.0.0"]!],
    ]);
    expect(stageNotebooks(flow, byRef).flatMap((s) => s.nodes.map((n) => n.id))).toEqual(["load", "profile", "split", "impute", "rate", "model", "score"]);
    expect(pipelineScript(flow, byRef, code)).toBe(SCRIPT);
  });

  it("copies the script from a stage notebook, asking each writing step once", async () => {
    const asked: string[] = [];
    server.use(
      http.get("/api/pipeline_versions", () => HttpResponse.json([flow])),
      http.get("/api/operators", () => HttpResponse.json([...writing, notebookOperator])),
      http.post("/api/operators/:id/notebook_code", ({ params }) => {
        const id = String(params.id);
        asked.push(id);
        return HttpResponse.json({ code: WRITERS[id] });
      }),
    );
    useSelection.setState({ pipelineVersionId: flow.id, runId: RUN });
    const writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    const section = stageNotebooks(flow, byRef).find((s) => s.name === "Load")!;
    renderWithApi(<StageNotebook pipeline={flow} section={section} />);

    await userEvent.click(await screen.findByRole("button", { name: "Copy pipeline as script" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(SCRIPT));
    expect(asked.sort()).toEqual(Object.keys(WRITERS).sort());
    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });

  it("copies nothing and says why when a step's code cannot be written", async () => {
    server.use(
      http.get("/api/operators", () => HttpResponse.json([...writing, notebookOperator])),
      http.post("/api/operators/:id/notebook_code", () => HttpResponse.json({ errors: [{ code: "code_failed", message: "writer crashed" }] }, { status: 500 })),
    );
    useSelection.setState({ pipelineVersionId: flow.id, runId: RUN });
    const writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    const section = stageNotebooks(flow, byRef).find((s) => s.name === "Load")!;
    renderWithApi(<StageNotebook pipeline={flow} section={section} />);

    await userEvent.click(await screen.findByRole("button", { name: "Copy pipeline as script" }));

    expect(await screen.findByText(/The script could not be copied: .*writer crashed/)).toBeInTheDocument();
    expect(writeText).not.toHaveBeenCalled();
  });
});
