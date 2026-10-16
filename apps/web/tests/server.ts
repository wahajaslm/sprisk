import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

import { attempts, metricsJson, operators, pipeline, run, scoreAttempt, scoreOutputs } from "./fixtures.ts";

export const handlers = [
  http.get("/api/pipeline_versions", () => HttpResponse.json([pipeline])),
  http.get("/api/operators", () => HttpResponse.json(operators)),
  http.get("/api/runs", () => HttpResponse.json([run])),
  http.get(`/api/runs/${run.id}/attempts`, () => HttpResponse.json(attempts)),
  http.get("/api/attempts/:id/outputs", ({ params }) =>
    HttpResponse.json(params.id === scoreAttempt.id ? scoreOutputs : []),
  ),
  http.get("/api/artifacts/:id/content", () => HttpResponse.text(metricsJson)),
];

export const server = setupServer(...handlers);
