// Every valid fixture must round-trip unchanged; every invalid one must be rejected.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type Entities, parse } from "../src/index.ts";

const fixtureRoot = join(import.meta.dirname, "../../../tests/contract");

const entities: [keyof Entities, string][] = [
  ["Artifact", "artifact"],
  ["Operator", "operator"],
  ["PipelineVersion", "pipeline_version"],
  ["Run", "run"],
  ["Attempt", "attempt"],
  ["WorkerMessage", "worker_message"],
  ["QuestionVersion", "question_version"],
  ["MethodologyCheck", "methodology_check"],
  ["DecisionProposal", "decision_proposal"],
  ["ApplyMethodologyDecision", "apply_methodology_decision"],
  ["MethodologyDecision", "methodology_decision"],
  ["AppliedMethodologyDecision", "applied_methodology_decision"],
  ["CreateRun", "create_run"],
  ["AttemptOutput", "attempt_output"],
  ["Problem", "problem"],
  ["TablePage", "table_page"],
  ["CodeDisplay", "code_display"],
  ["OperatorSource", "operator_source"],
  ["MethodologyRule", "methodology_rule"],
  ["MethodologyRuleSource", "methodology_rule_source"],
  ["RuleObservation", "rule_observation"],
  ["RuleDecision", "rule_decision"],
  ["FigureSet", "figure_set"],
  ["LoadedTable", "loaded_table"],
  ["DatasetProfile", "dataset_profile"],
  ["CodeInterface", "code_interface"],
  ["CodeSplitRequest", "code_split_request"],
  ["CellStepsRequest", "cell_steps_request"],
  ["CellSteps", "cell_steps"],
  ["CodeSplit", "code_split"],
  ["NotebookCodeRequest", "notebook_code_request"],
  ["NotebookSettings", "notebook_settings"],
  ["NotebookSettingsRequest", "notebook_settings_request"],
  ["NotebookCode", "notebook_code"],
  ["NotebookVersion", "notebook_version"],
  ["NotebookExecute", "notebook_execute"],
  ["NotebookExecution", "notebook_execution"],
  ["NotebookExecutionEvent", "notebook_execution_event"],
  ["NotebookVariables", "notebook_variables"],
  ["NotebookKernelRequest", "notebook_kernel_request"],
  ["SelectionDecision", "selection_decision"],
  ["ModelSelection", "model_selection"],
  ["CreateStudy", "create_study"],
  ["Study", "study"],
  ["StudyDetail", "study_detail"],
  ["Trial", "trial"],
];

it("every fixture dir has an entity", () => {
  const dirs = readdirSync(fixtureRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  expect(dirs).toEqual(entities.map(([, dir]) => dir).sort());
});

function fixtures(dir: string, kind: "valid" | "invalid"): [string, unknown][] {
  const path = join(fixtureRoot, dir, kind);
  const files = readdirSync(path).filter((f) => f.endsWith(".json")).sort();
  expect(files.length).toBeGreaterThan(0);
  return files.map((f) => [f, JSON.parse(readFileSync(join(path, f), "utf8"))]);
}

describe.each(entities)("%s contract", (entity, dir) => {
  it.each(fixtures(dir, "valid"))("accepts and round-trips %s", (_name, json) => {
    expect(JSON.parse(JSON.stringify(parse(entity, json)))).toEqual(json);
  });

  it.each(fixtures(dir, "invalid"))("rejects %s", (_name, json) => {
    expect(() => parse(entity, json)).toThrow(`Invalid ${entity}`);
  });
});
