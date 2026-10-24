import type { Attempt, AttemptOutput, FlowDecision, FlowDecisions, LoadedTable, PipelineVersion, Report, Walk, WalkStep } from "@sprisk/contracts";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import groupSplit from "../../../tests/contract/flow_decisions/valid/group-split.json";
import report from "../../../tests/contract/report/valid/complete.json";
import stopped from "../../../tests/contract/walk/valid/stopped.json";
import { DatasetsPage } from "../src/views/datasets/DatasetsPage.tsx";
import { loadOutputs, operators } from "./fixtures.ts";
import { renderWithApi } from "./render.tsx";
import { server } from "./server.ts";

const decided = groupSplit as FlowDecisions;
const PV = decided.pipeline_version_id;
const RUN = "run_01JABCDEFGHJKMNPQRSTVWXYZ9";
const walk: Walk = { ...(stopped as Walk), id: decided.walk_id!, stop: { reason: "complete", detail: "The walk scored the test rows once." } };

const table: LoadedTable = {
  name: "listings.csv",
  operator: "sprisk.io.file_source@1.0.0",
  artifact: loadOutputs[0]!.artifact,
  total_rows: 596,
  total_columns: 4,
  used_by: [{ pipeline_version_id: PV, run_id: RUN, node_id: "load" }],
};

const flow: PipelineVersion = {
  schema_version: "sprisk.pipeline_version/v1",
  id: PV,
  project_id: "prj_01JABCDEFGHJKMNPQRSTVWXYZ0",
  nodes: [
    { id: "load", operator: "sprisk.io.file_source@1.0.0", params: {} },
    { id: "near_duplicates", operator: "sprisk.profile.near_duplicates@1.0.0", params: {} },
    { id: "split", operator: "sprisk.validation.group_split@1.0.0", params: {} },
    { id: "group_overlap", operator: "sprisk.validation.group_overlap@1.0.0", params: {} },
  ],
  edges: [],
  created_at: "2026-10-24T10:00:00Z",
};

const nearDuplicates = {
  ...operators[0]!,
  id: "sprisk.profile.near_duplicates@1.0.0",
  title: "Duplicate titles (normalized)",
  scope: "all" as const,
  attach: { role: "split" as const, side: "input" as const },
  outputs: [
    { name: "data", kind: "table" as const },
    { name: "evidence", kind: "report" as const },
    { name: "figures", kind: "figure" as const },
  ],
};

const measured: Attempt = {
  schema_version: "sprisk.attempt/v1",
  id: "att_01JABCDEFGHJKMNPQRSTVWXY90",
  run_id: RUN,
  node_id: "near_duplicates",
  number: 1,
  state: "succeeded",
  created_at: "2026-10-24T10:00:00Z",
};
const drawn: AttemptOutput = {
  port: "figures",
  artifact: { ...loadOutputs[0]!.artifact, id: "art_01JABCDEFGHJKMNPQRSTVWXY91", media_type: "application/json", size_bytes: 900 },
};
const titleGroups = { items: [{ library: "plotly", format: "plotly_json", title: "Rows per title group (designation)", content: "{}" }] };

const unchanged: FlowDecision = {
  decides: "data.class_balance",
  method: "methodology.common.class_balance@1.0.0",
  activity: "Class balance",
  question: "Are some classes much rarer than others?",
  option: "balanced",
  label: "Classes are close enough in size",
  reason: "The rarest class holds 18% of the train rows.",
  assurance: "rule",
  steps: [],
  promises: [],
};

/** The walk's trail: built, ran its look, one decide step per method decision, a rule's
 * apply, and the score. */
function trailOf(decisions: FlowDecision[]): WalkStep[] {
  const at = { schema_version: "sprisk.walk_step/v1" as const, walk_id: walk.id, created_at: "2026-10-24T10:00:00Z" };
  return [
    { ...at, round: 0, action: "build", reason: "Load, Split and a baseline model." },
    { ...at, round: 1, action: "run", reason: "The look." },
    ...decisions.map((d, i): WalkStep => ({ ...at, round: 2 + i, action: "decide", reason: d.reason, decides: d.decides, option: d.option, assurance: d.assurance })),
    { ...at, round: 50, action: "apply", reason: "id holds a different value in every row: it names rows, so leave it out.", decides: "data.column_roles", alternative_id: "drop_identifiers" },
    { ...at, round: 51, action: "run", reason: "Runs again." },
    { ...at, round: 52, action: "score", reason: "Scored once." },
  ];
}

const withEvidence: FlowDecisions = {
  ...decided,
  decisions: decided.decisions.map((d) =>
    d.decides === "data.repeated_items" ? { ...d, evidence: [{ kind: "data.near_duplicate_groups", step: "near_duplicates", fields: { rows: 600, groups: 84, rows_in_groups: 206, largest_group: 6 } }] } : d,
  ),
};

function serve(decisions: FlowDecisions = decided, theWalk: Walk = walk) {
  server.use(
    http.get("/api/loaded_tables", () => HttpResponse.json([table])),
    http.get("/api/pipeline_versions", () => HttpResponse.json([flow])),
    http.get("/api/operators", () => HttpResponse.json([...operators, nearDuplicates])),
    http.get(`/api/pipeline_versions/${PV}/decisions`, () => HttpResponse.json(decisions)),
    http.get(`/api/walks/${walk.id}`, () => HttpResponse.json({ walk: theWalk, steps: trailOf(decisions.decisions) })),
    http.get(`/api/walks/${walk.id}/report`, () => HttpResponse.json(report)),
    http.get("/api/runs", () => HttpResponse.json([{ schema_version: "sprisk.run/v1", id: RUN, project_id: flow.project_id, pipeline_version_id: PV, status: "succeeded", created_at: flow.created_at }])),
    http.get(`/api/runs/${RUN}/attempts`, () => HttpResponse.json([measured])),
    http.get(`/api/attempts/${measured.id}/outputs`, () => HttpResponse.json([drawn])),
    http.get(`/api/artifacts/${drawn.artifact.id}/content`, () => HttpResponse.json(titleGroups)),
  );
  renderWithApi(<DatasetsPage />);
}

async function openInvestigation() {
  await userEvent.click(await screen.findByRole("tab", { name: "Investigation" }));
}

describe("a dataset's investigation (ADR-0065)", () => {
  it("says which dataset, which question and which walk the analysis belongs to", async () => {
    serve();
    await openInvestigation();
    const context = await screen.findByRole("group", { name: "Investigation context" });
    expect(within(context).getByText("listings.csv")).toBeInTheDocument();
    expect(await within(context).findByText((report as Report).question)).toBeInTheDocument();
  });

  it("opens with a summary of what the walk did and what it found", async () => {
    serve();
    await openInvestigation();
    const summary = await screen.findByRole("region", { name: "Summary" });
    expect(summary).toHaveTextContent("asked you 1 question, made 3 decisions and ran the flow 2 times");
    expect(summary).toHaveTextContent("It then scored the model on the held-out test rows, once.");
    expect(within(summary).getByText((report as Report).answer.statement)).toBeInTheDocument();
  });

  it("shows the walk at a glance: set up, first look, asked, decided, checked, scored", async () => {
    serve();
    await openInvestigation();
    const glance = await screen.findByRole("list", { name: "The walk at a glance" });
    expect(within(glance).getAllByRole("listitem").map((i) => i.textContent)).toEqual([
      "Set upLoad, split, baseline",
      "First look0 measurements",
      "Asked you1 question",
      "Decided3 decisions",
      "Checked0 of 1 promise hold",
      "Scoredonce, on test rows",
    ]);
  });

  it("tells each decision in walk order: what was found, what was decided, and by whom", async () => {
    serve();
    await openInvestigation();
    const findings = await screen.findByRole("region", { name: "Findings and decisions" });
    const cards = within(findings).getAllByRole("article");
    expect(cards.map((c) => c.getAttribute("aria-label"))).toEqual(["Repeated observations", "Fair evaluation", "Column roles"]);
    expect(within(cards[0]!).getByText("Does the same item appear in more than one row?")).toBeInTheDocument();
    expect(cards[0]).toHaveTextContent("You answered");
    expect(within(cards[0]!).getByText("A person answered: Treat rows with matching titles as one item.")).toBeInTheDocument();
    expect(within(cards[0]!).getByText("Treat rows with matching titles as one item")).toBeInTheDocument();
    expect(cards[1]).toHaveTextContent("The method decided");
    expect(cards[2]).toHaveTextContent("A rule decided");
    expect(within(cards[2]!).getByText("drop identifiers")).toBeInTheDocument();
  });

  it("draws the chart the evidence's producer drew, large, in its decision", async () => {
    serve();
    await openInvestigation();
    const card = await screen.findByRole("article", { name: "Repeated observations" });
    expect(await within(card).findByRole("img", { name: "Rows per title group (designation)" })).toBeInTheDocument();
  });

  it("says what the first look measured, for which question, and which rows it read", async () => {
    serve(withEvidence);
    await openInvestigation();
    const looked = await screen.findByRole("region", { name: "What the first look measured" });
    expect(within(looked).getByText("Does the same item appear in more than one row?")).toBeInTheDocument();
    expect(await within(looked).findByText("Duplicate titles (normalized) read every row, before the split.")).toBeInTheDocument();
  });

  it("lists what the method measured, field by field", async () => {
    serve(withEvidence);
    await openInvestigation();
    const card = await screen.findByRole("article", { name: "Repeated observations" });
    const table = within(card).getByRole("table", { name: "Measured" });
    expect(within(table).getByRole("row", { name: "rows in groups 206" })).toBeInTheDocument();
    expect(within(table).getByRole("row", { name: "largest group 6" })).toBeInTheDocument();
  });

  it("never shows a stale promise as holding", async () => {
    serve();
    await openInvestigation();
    const checks = await screen.findByRole("region", { name: "Checks" });
    expect(within(checks).getByRole("listitem", { name: "No item has rows in both train and test." })).toHaveTextContent("Stale");
  });

  it("shows a decision that changed nothing, so a finding is not lost", async () => {
    serve({ ...decided, decisions: [...decided.decisions, unchanged] });
    await openInvestigation();
    const card = await screen.findByRole("article", { name: "Class balance" });
    expect(within(card).getByText("Leaves the flow unchanged.")).toBeInTheDocument();
  });

  it("shows the walk's report: its answer, each claim and its limitations", async () => {
    serve();
    await openInvestigation();
    const shown = await screen.findByRole("region", { name: "Report" });
    expect(within(shown).getByText((report as Report).answer.statement)).toBeInTheDocument();
    expect(within(shown).getByText(/split\.method: stratified_random/)).toBeInTheDocument();
    expect(within(shown).getByText("A predictive score, not a causal effect.")).toBeInTheDocument();
  });

  it("says a walk that has not completed has no report yet", async () => {
    serve(decided, { ...walk, stop: { reason: "needs_person", detail: "Two questions are open." } });
    await openInvestigation();
    expect(await screen.findByText("No report yet. The walk stopped: Two questions are open.")).toBeInTheDocument();
  });

  it("says when no investigation has used the table", async () => {
    serve({ schema_version: "sprisk.flow_decisions/v1", pipeline_version_id: PV, decisions: [] });
    await openInvestigation();
    expect(await screen.findByText(/No investigation has used this table yet/)).toBeInTheDocument();
  });

  it("says why the decisions could not be read", async () => {
    serve();
    server.use(http.get(`/api/pipeline_versions/${PV}/decisions`, () => HttpResponse.json({ errors: [{ code: "unknown_method", message: "method gone" }] }, { status: 422 })));
    await openInvestigation();
    expect(await screen.findByRole("alert")).toHaveTextContent("The decisions could not be read");
  });

  it("says why the report could not be read", async () => {
    serve();
    server.use(http.get(`/api/walks/${walk.id}/report`, () => HttpResponse.json({ errors: [{ code: "not_found", message: "no report" }] }, { status: 404 })));
    await openInvestigation();
    expect(await screen.findByRole("alert")).toHaveTextContent("The report could not be read");
  });

  it("lists each walk once, newest first, with its decisions and state, and opens the one picked", async () => {
    const OLDER = "plv_01JABCDEFGHJKMNPQRSTVWXYZ2";
    const OTHER = "plv_01JABCDEFGHJKMNPQRSTVWXYZ3";
    const newer = "wlk_01JABCDEFGHJKMNPQRSTVWXYZ7";
    serve();
    server.use(
      http.get("/api/loaded_tables", () =>
        HttpResponse.json([
          { ...table, used_by: [{ pipeline_version_id: OLDER, run_id: RUN, node_id: "load" }, ...table.used_by, { pipeline_version_id: OTHER, run_id: RUN, node_id: "load" }] },
        ]),
      ),
      http.get(`/api/pipeline_versions/${OLDER}/decisions`, () => HttpResponse.json({ ...decided, pipeline_version_id: OLDER, decisions: decided.decisions.slice(0, 1) })),
      http.get(`/api/pipeline_versions/${OTHER}/decisions`, () => HttpResponse.json({ ...decided, pipeline_version_id: OTHER, walk_id: newer, decisions: [unchanged] })),
      http.get(`/api/walks/${newer}`, () => HttpResponse.json({ walk: { ...walk, id: newer, stop: { reason: "needs_person", detail: "One question is open." } }, steps: trailOf([unchanged]) })),
    );
    await openInvestigation();
    const walks = await screen.findByRole("list", { name: "Investigations" });
    const rows = within(walks).getAllByRole("button");
    expect(rows).toHaveLength(2);
    expect(await within(rows[0]!).findByText(/1 decision · needs person/)).toBeInTheDocument();
    expect(await within(rows[1]!).findByText(/2 decisions · complete/)).toBeInTheDocument();
    expect(await screen.findByRole("article", { name: "Class balance" })).toBeInTheDocument();
    await userEvent.click(rows[1]!);
    expect(await screen.findByRole("article", { name: "Repeated observations" })).toBeInTheDocument();
    expect(screen.queryByRole("article", { name: "Class balance" })).toBeNull();
  });

  it("leaves the chart out when the run that measured the evidence drew none", async () => {
    serve();
    server.use(http.get(`/api/attempts/${measured.id}/outputs`, () => HttpResponse.json([])));
    await openInvestigation();
    const card = await screen.findByRole("article", { name: "Repeated observations" });
    await within(card).findByText("A person answered: Treat rows with matching titles as one item.");
    expect(within(card).queryByRole("img")).toBeNull();
    expect(within(card).queryByText(/Edit and run it/)).toBeNull();
  });

});
