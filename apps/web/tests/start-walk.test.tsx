import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { parse } from "@sprisk/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import local from "../../../tests/contract/dataset_version/valid/local-csv.json";
import questionJson from "../../../tests/contract/question_version/valid/classification-all-fields.json";
import walking from "../../../tests/contract/walk/valid/walking.json";
import asking from "../../../tests/contract/walk/valid/stopped-with-asks.json";
import trail from "../../../tests/contract/walk_detail/valid/trail.json";
import { LOCAL_PROJECT } from "../src/notebook/document.ts";
import { ObjectivePage } from "../src/views/objective/ObjectivePage.tsx";
import { StartWalk } from "../src/views/objective/StartWalk.tsx";
import { useSelection } from "../src/workbench/selection.ts";
import { renderWithApi } from "./render.tsx";
import { server } from "./server.ts";

// What no data can give is stated, so a walk may start (ADR-0063 amendment).
const question = parse("QuestionVersion", {
  ...questionJson,
  success_bar: { value: { metric: "weighted_f1", score: 0.8 }, origin: "explicit" },
  interpretability: { value: "low", origin: "explicit" },
});
const WALK = trail.walk.id;
const started = { ...walking, id: WALK };
const stillWalking = { walk: started, steps: [] };

const listings = { ...local, id: "dsv_01JABCDEFGHJKMNPQRSTVWXY01", name: "listings.csv" };
const labels = { ...local, id: "dsv_01JABCDEFGHJKMNPQRSTVWXY02", name: "labels.csv" };

function withSources() {
  server.use(http.get("/api/dataset_versions", () => HttpResponse.json([listings, labels])));
}

async function startWith(...names: string[]) {
  for (const name of names) await userEvent.click(await screen.findByRole("checkbox", { name: new RegExp(name) }));
  await userEvent.click(screen.getByRole("button", { name: "Start auto run" }));
}

describe("StartWalk", () => {
  beforeEach(() => {
    useSelection.setState({ nav: "Objective", pipelineVersionId: undefined });
    withSources();
  });

  it("starts a walk in the local project on the question, with the picked sources in the order picked and a bounded budget", async () => {
    let sent: Record<string, unknown> | undefined;
    server.use(
      http.post("/api/walks", async ({ request }) => {
        sent = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(started, { status: 201 });
      }),
      http.get(`/api/walks/${WALK}`, () => HttpResponse.json(stillWalking)),
    );
    renderWithApi(<StartWalk question={question} />);

    await startWith("labels.csv", "listings.csv");

    expect(await screen.findByText("Auto run in progress")).toBeInTheDocument();
    expect(sent).toMatchObject({
      project_id: LOCAL_PROJECT,
      question_version_id: question.id,
      dataset_version_ids: [labels.id, listings.id],
    });
    expect(sent?.idempotency_key).toMatch(/^walk-/);
    expect(sent?.max_actions).toBeGreaterThan(0);
    expect(sent?.max_wall_seconds).toBeGreaterThan(0);
  });

  it("cannot start without a picked source", async () => {
    renderWithApi(<StartWalk question={question} />);

    const listed = await screen.findByRole("checkbox", { name: /listings\.csv/ });
    expect(screen.getByRole("button", { name: "Start auto run" })).toBeDisabled();
    await userEvent.click(listed);
    await userEvent.click(listed);
    expect(screen.getByRole("button", { name: "Start auto run" })).toBeDisabled();
  });

  it("shows why the API refused to start the walk", async () => {
    server.use(
      http.post("/api/walks", () =>
        HttpResponse.json({ errors: [{ code: "invalid_walk", message: "the question has no target" }] }, { status: 400 }),
      ),
    );
    renderWithApi(<StartWalk question={question} />);

    await startWith("listings.csv");

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

    await startWith("listings.csv");

    expect(await screen.findByText(`Auto run ${WALK} cannot be read: not_found: no such walk`)).toBeInTheDocument();
  });

  it("keeps reading a walking walk until it stops, then shows why and each step", async () => {
    let reads = 0;
    server.use(
      http.post("/api/walks", () => HttpResponse.json(started, { status: 201 })),
      http.get(`/api/walks/${WALK}`, () => HttpResponse.json(++reads < 2 ? stillWalking : trail)),
    );
    renderWithApi(<StartWalk question={question} />);

    await startWith("listings.csv");

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

    await startWith("listings.csv");
    await userEvent.click(await screen.findByRole("button", { name: "Open in pipeline" }));

    await waitFor(() => expect(useSelection.getState().nav).toBe("Flow"));
    expect(useSelection.getState().pipelineVersionId).toBe(trail.walk.head_pipeline_version_id);
  });

  it("cannot start until what no data can give is stated, and says what", () => {
    const { success_bar: _bar, ...unbarred } = question;
    renderWithApi(<StartWalk question={unbarred} />);

    expect(screen.getByRole("button", { name: "Start auto run" })).toBeDisabled();
    expect(screen.getByText("State before the auto run: the success bar.")).toBeInTheDocument();
  });

  it("shows every question the look found and answers them in one revision, then walks on", async () => {
    const asked = { walk: { ...asking, id: WALK }, steps: [] };
    const next = { ...started, id: "wlk_01JABCDEFGHJKMNPQRSTVWXYZ9" };
    const walks: Record<string, unknown>[] = [];
    let revision: Record<string, unknown> | undefined;
    server.use(
      http.post("/api/walks", async ({ request }) => {
        walks.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(walks.length === 1 ? started : next, { status: 201 });
      }),
      http.get(`/api/walks/${WALK}`, () => HttpResponse.json(asked)),
      http.get(`/api/walks/${next.id}`, () => HttpResponse.json({ walk: next, steps: [] })),
      http.post("/api/question_versions", async ({ request }) => {
        revision = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(revision, { status: 201 });
      }),
    );
    renderWithApi(<StartWalk question={question} />);

    await startWith("listings.csv");

    const [method, fact] = asking.stop.asks;
    if (!method || !fact) throw new Error("the fixture asks two questions");
    expect(await screen.findByText(method.question)).toBeInTheDocument();
    // The option the method would take is picked; a person may pick another.
    expect(screen.getByRole("radio", { name: /Treat rows with matching titles as one item/ })).toBeChecked();
    await userEvent.click(screen.getByRole("radio", { name: "Treat every row as its own item" }));
    // A fact the question states is answered on the question, not here.
    expect(screen.getByText(fact.question)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Answer and continue" }));

    await waitFor(() => expect(walks).toHaveLength(2));
    expect(revision).toMatchObject({
      parent_id: question.id,
      answers: [{ decides: "data.repeated_items", option: "independent_rows" }],
      success_bar: question.success_bar,
    });
    expect(walks[1]).toMatchObject({ question_version_id: revision?.id, dataset_version_ids: [listings.id] });
    expect(await screen.findByText("Auto run in progress")).toBeInTheDocument();
  });

  it("is offered on the Objective page for the current question", async () => {
    server.use(http.get("/api/question_versions", () => HttpResponse.json([question])));
    renderWithApi(<ObjectivePage />);

    expect(await screen.findByRole("button", { name: "Start auto run" })).toBeInTheDocument();
  });
});
