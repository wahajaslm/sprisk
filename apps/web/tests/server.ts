import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

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
  http.get("/api/methodology_rules", () => HttpResponse.json([])),
  http.get("/api/pipeline_versions", () => HttpResponse.json([pipeline])),
  http.get("/api/pipeline_versions/:id/studies", () => HttpResponse.json([])),
  http.get("/api/operators", () => HttpResponse.json(operators)),
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
