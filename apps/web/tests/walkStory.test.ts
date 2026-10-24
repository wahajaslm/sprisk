import type { FlowDecision, WalkStep } from "@sprisk/contracts";
import { describe, expect, it } from "vitest";

import { walkStory } from "../src/views/datasets/walkStory.ts";

const WALK = "wlk_01JABCDEFGHJKMNPQRSTVWXYZ0";
let round = 0;
const step = (action: WalkStep["action"], reason: string, more: Partial<WalkStep> = {}): WalkStep => ({
  schema_version: "sprisk.walk_step/v1",
  walk_id: WALK,
  round: round++,
  action,
  reason,
  created_at: "2026-10-24T10:00:00Z",
  ...more,
});

const repeated: FlowDecision = {
  decides: "data.repeated_items",
  method: "methodology.common.repeated_items@1.0.0",
  activity: "Repeated observations",
  question: "Does the same item appear in more than one row?",
  option: "group_by_title",
  label: "Treat rows with matching titles as one item",
  reason: "A person answered: Treat rows with matching titles as one item.",
  assurance: "confirmed",
  steps: ["near_duplicates"],
  promises: [],
  evidence: [{ kind: "data.near_duplicate_groups", step: "near_duplicates", fields: { rows: 600, groups: 84 } }],
};

function trail(): WalkStep[] {
  round = 0;
  return [
    step("build", "Load, Split and a baseline model: the steps every flow has."),
    step("measure", "Adds near_duplicates on the rows split reads."),
    step("run", "The look."),
    step("decide", "A person answered: Treat rows with matching titles as one item.", { decides: "data.repeated_items", option: "group_by_title", assurance: "confirmed" }),
    step("verify", "Checks what the decisions promise."),
    step("apply", "id hold a different value in every row: they name rows, so leave them out.", { decides: "data.column_roles", alternative_id: "drop_identifiers" }),
    step("run", "Runs again."),
    step("compare", "Compare the shortlist: ml_dummy_baseline, ml_linear_model.", { decides: "modeling.estimator_selection" }),
    step("apply", "ml_linear_model is the simplest of them.", { decides: "modeling.estimator_selection", alternative_id: "ml_linear_model" }),
    step("score", "The model is scored on the test rows, once."),
    step("stop", "Every rule that fits the question is settled."),
  ];
}

describe("a walk's trail as a story (ADR-0065)", () => {
  it("lists every decision in walk order, a method's and a rule's, each once", () => {
    const story = walkStory(trail(), [repeated]);
    expect(story.decisions.map((d) => d.title)).toEqual(["Does the same item appear in more than one row?", "Column roles", "Estimator selection"]);
  });

  it("says who decided: a person's answer, a method, or a rule", () => {
    const story = walkStory(trail(), [{ ...repeated, assurance: "rule", reason: "No two rows share a title." }]);
    expect(story.decisions.map((d) => d.by)).toEqual(["method", "rule", "rule"]);
    expect(walkStory(trail(), [repeated]).decisions[0]!.by).toBe("person");
  });

  it("keeps a method's decision record beside its story entry, for its chart, evidence and promises", () => {
    const story = walkStory(trail(), [repeated]);
    expect(story.decisions[0]!.decision).toBe(repeated);
    expect(story.decisions[1]!.decision).toBeUndefined();
  });

  it("names a rule's choice from its alternative, in words", () => {
    expect(walkStory(trail(), []).decisions[1]!.choice).toBe("drop identifiers");
  });

  it("counts runs, questions asked of a person, and whether the test rows were scored", () => {
    const story = walkStory(trail(), [repeated]);
    expect(story).toMatchObject({ runs: 2, asked: 1, scored: true });
  });

  it("says a walk that stopped before its score did not score", () => {
    expect(walkStory(trail().slice(0, 6), []).scored).toBe(false);
  });
});
