import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

import splitMethodShape from "../../../tests/contract/method/valid/split-method.json";

import {
  attempts,
  checksJson,
  gateAttempt,
  gateOutputs,
  loadAttempt,
  loadOutputs,
  profileAttempt,
  profileOutputs,
  profilePage,
  metricsJson,
  operators,
  pipeline,
  run,
  scoreAttempt,
  scoreOutputs,
  tablePage,
} from "./fixtures.ts";

export const handlers = [
  http.get("/api/question_versions", () => HttpResponse.json([])),
  // No data source was added by reference unless a test says so (ADR-0067).
  http.get("/api/dataset_versions", () => HttpResponse.json([])),
  http.get("/api/methodology_rules", () => HttpResponse.json([])),
  http.get("/api/pipeline_versions", () => HttpResponse.json([pipeline])),
  http.get("/api/pipeline_versions/:id/studies", () => HttpResponse.json([])),
  // No walk made a flow unless a test says so (ADR-0063).
  http.get("/api/pipeline_versions/:id/decisions", ({ params }) =>
    HttpResponse.json({ schema_version: "sprisk.flow_decisions/v2", pipeline_version_id: params.id, decisions: [] }),
  ),
  http.get("/api/operators", () => HttpResponse.json(operators)),
  // Steps have no plain code unless a test says so (ADR-0055).
  http.post("/api/operators/:id/notebook_code", () => HttpResponse.json({ errors: [{ code: "no_plain_code", message: "none yet" }] }, { status: 404 })),
  http.get("/api/runs", () => HttpResponse.json([run])),
  http.get(`/api/runs/${run.id}/attempts`, () => HttpResponse.json(attempts)),
  http.get("/api/attempts/:id/outputs", ({ params }) =>
    HttpResponse.json(
      params.id === scoreAttempt.id
        ? scoreOutputs
        : params.id === gateAttempt.id
          ? gateOutputs
          : params.id === loadAttempt.id
            ? loadOutputs
            : params.id === profileAttempt.id
              ? profileOutputs
              : [],
    ),
  ),
  http.get("/api/artifacts/:id/content", ({ params }) =>
    HttpResponse.text(params.id === gateOutputs[0]!.artifact.id ? checksJson : metricsJson),
  ),
  http.get("/api/artifacts/:id/rows", ({ request, params }) => {
    if (params.id === profileOutputs[0]!.artifact.id) return HttpResponse.json(profilePage);
    const url = new URL(request.url);
    return HttpResponse.json(tablePage(Number(url.searchParams.get("offset")), Number(url.searchParams.get("limit"))));
  }),
];

export const server = setupServer(...handlers);

/** The model shortlist as a compared method (ADR-0063 D3): its options swap the step with the
 * role model, which the flow's linear model has. */
const shortlistMethod = {
  ...splitMethodShape,
  id: "methodology.supervised.model_shortlist@1.0.0",
  decides: "models.estimator_selection",
  compare: true,
  options: ["ml_dummy_baseline", "ml_linear_model"].map((id) => ({
    id,
    label: id,
    description: id,
    condition: "always",
    when: "always",
    rationale: id,
    action: { replace: { role: "model", operator: `sprisk.${id.replace("ml_", "ml.")}@3.0.0` } },
    verify: [],
  })),
};
export const comparedModel = [
  http.get("/api/methods", () => HttpResponse.json([shortlistMethod])),
  http.get("/api/operators", () =>
    HttpResponse.json(operators.map((o) => (o.id === "sprisk.ml.linear_model@1.0.0" ? { ...o, role: "model" } : o))),
  ),
];
