import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { parse } from "@sprisk/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import questionJson from "../../../tests/contract/question_version/valid/classification-all-fields.json";
import walking from "../../../tests/contract/walk/valid/walking.json";
import trail from "../../../tests/contract/walk_detail/valid/trail.json";
import { LOCAL_PROJECT } from "../src/notebook/document.ts";
import { ObjectivePage } from "../src/views/objective/ObjectivePage.tsx";
import { StartWalk } from "../src/views/objective/StartWalk.tsx";
import { useSelection } from "../src/workbench/selection.ts";
import { renderWithApi } from "./render.tsx";
import { server } from "./server.ts";

const question = parse("QuestionVersion", questionJson);
const WALK = trail.walk.id;
const started = { ...walking, id: WALK };
const stillWalking = { walk: started, steps: [] };

async function startWith(path: string) {
  await userEvent.type(screen.getByLabelText("Source files"), path);
  await userEvent.click(screen.getByRole("button", { name: "Start walk" }));
}

describe("StartWalk", () => {
  beforeEach(() => useSelection.setState({ nav: "Objective", pipelineVersionId: undefined }));

  it("starts a walk in the local project on the question, with each typed source path and a bounded budget", async () => {
    let sent: Record<string, unknown> | undefined;
    server.use(
      http.post("/api/walks", async ({ request }) => {
        sent = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(started, { status: 201 });
      }),
      http.get(`/api/walks/${WALK}`, () => HttpResponse.json(stillWalking)),
    );
    renderWithApi(<StartWalk question={question} />);

    await startWith("standin.csv{enter}  labels.csv  {enter}");

    expect(await screen.findByText("Walking")).toBeInTheDocument();
    expect(sent).toMatchObject({
      project_id: LOCAL_PROJECT,
      question_version_id: question.id,
      sources: ["standin.csv", "labels.csv"],
    });
    expect(sent?.idempotency_key).toMatch(/^walk-/);
    expect(sent?.max_actions).toBeGreaterThan(0);
    expect(sent?.max_wall_seconds).toBeGreaterThan(0);
  });

  it("cannot start without a source path", async () => {
    renderWithApi(<StartWalk question={question} />);

    expect(screen.getByRole("button", { name: "Start walk" })).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Source files"), "   ");
    expect(screen.getByRole("button", { name: "Start walk" })).toBeDisabled();
  });

  it("shows why the API refused to start the walk", async () => {
    server.use(
      http.post("/api/walks", () =>
        HttpResponse.json({ errors: [{ code: "invalid_walk", message: "the question has no target" }] }, { status: 400 }),
      ),
    );
    renderWithApi(<StartWalk question={question} />);

    await startWith("standin.csv");

    expect(await screen.findByText("invalid_walk: the question has no target")).toBeInTheDocument();
  });

  it("shows when the walk it started cannot be read", async () => {
    server.use(
      http.post("/api/walks", () => HttpResponse.json(started, { status: 201 })),
      http.get(`/api/walks/${WALK}`, () =>
        HttpResponse.json({ errors: [{ code: "not_found", message: "no such walk" }] }, { status: 404 }),
      ),
    );
    renderWithApi(<StartWalk question={question} />);

    await startWith("standin.csv");

    expect(await screen.findByText(`Walk ${WALK} cannot be read: not_found: no such walk`)).toBeInTheDocument();
  });

  it("keeps reading a walking walk until it stops, then shows why and each step", async () => {
    let reads = 0;
    server.use(
      http.post("/api/walks", () => HttpResponse.json(started, { status: 201 })),
      http.get(`/api/walks/${WALK}`, () => HttpResponse.json(++reads < 2 ? stillWalking : trail)),
    );
    renderWithApi(<StartWalk question={question} />);

    await startWith("standin.csv");

    expect(await screen.findByText("Needs your answer", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText(trail.walk.stop.detail)).toBeInTheDocument();
    for (const step of trail.steps) expect(screen.getByText(step.reason)).toBeInTheDocument();
  });

  it("opens the flow the walk made", async () => {
    server.use(
      http.post("/api/walks", () => HttpResponse.json(started, { status: 201 })),
      http.get(`/api/walks/${WALK}`, () => HttpResponse.json(trail)),
    );
    renderWithApi(<StartWalk question={question} />);

    await startWith("standin.csv");
    await userEvent.click(await screen.findByRole("button", { name: "Open in flow" }));

    await waitFor(() => expect(useSelection.getState().nav).toBe("Flow"));
    expect(useSelection.getState().pipelineVersionId).toBe(trail.walk.head_pipeline_version_id);
  });

  it("is offered on the Objective page for the current question", async () => {
    server.use(http.get("/api/question_versions", () => HttpResponse.json([question])));
    renderWithApi(<ObjectivePage />);

    expect(await screen.findByRole("button", { name: "Start walk" })).toBeInTheDocument();
  });
});
