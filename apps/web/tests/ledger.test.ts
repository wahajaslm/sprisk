import type { PipelineVersion, QuestionVersion } from "@sprisk/contracts";
import { parse } from "@sprisk/contracts";
import { describe, expect, it } from "vitest";

import questionJson from "../../../tests/contract/question_version/valid/classification-all-fields.json";
import pipelineJson from "../../../tests/contract/pipeline_version/valid/linked-question.json";
import { beforeWalk, currentQuestion, withAnswers } from "../src/views/objective/ledger.ts";

const { parent_id: _parent, ...first } = questionJson;
const base = parse("QuestionVersion", first);
const revise = (of: QuestionVersion, id: string): QuestionVersion => ({ ...of, id, parent_id: of.id });
const flowOf = (question: QuestionVersion): PipelineVersion =>
  parse("PipelineVersion", { ...pipelineJson, question_version_id: question.id });

describe("currentQuestion", () => {
  it("is the open flow's question when nothing revises it", () => {
    expect(currentQuestion([base], flowOf(base))?.id).toBe(base.id);
  });

  it("is the newest revision of the open flow's question", () => {
    const first = revise(base, "qv_01JABCDEFGHJKMNPQRSTVWXYZ8");
    const second = revise(first, "qv_01JABCDEFGHJKMNPQRSTVWXYZ9");
    // The API lists the newest first.
    expect(currentQuestion([second, first, base], flowOf(base))?.id).toBe(second.id);
  });

  it("never follows a question that revises another one", () => {
    const other = { ...base, id: "qv_01JABCDEFGHJKMNPQRSTVWXYZ7" };
    const elsewhere = revise(other, "qv_01JABCDEFGHJKMNPQRSTVWXYZ6");
    expect(currentQuestion([elsewhere, other, base], flowOf(base))?.id).toBe(base.id);
  });

  it("is the newest question when no flow is open", () => {
    const newer = { ...base, id: "qv_01JABCDEFGHJKMNPQRSTVWXYZ5" };
    expect(currentQuestion([newer, base], undefined)?.id).toBe(newer.id);
  });
});

describe("beforeWalk", () => {
  const bar = { value: { metric: "weighted_f1" as const, score: 0.8 }, origin: "explicit" as const };
  const constraint = { value: "low" as const, origin: "explicit" as const };

  it("names each fact a walk needs that no data can give", () => {
    const { success_bar: _bar, interpretability: _constraint, ...bare } = base;
    expect(beforeWalk(bare)).toEqual(["the success bar", "how far a person must follow each prediction"]);
  });

  it("is empty once the bar and the constraint are stated", () => {
    expect(beforeWalk({ ...base, success_bar: bar, interpretability: constraint })).toEqual([]);
  });

  it("asks for a stated target and a supervised task first", () => {
    const { target: _target, ...untargeted } = { ...base, success_bar: bar, interpretability: constraint };
    expect(beforeWalk(untargeted)).toEqual(["the target column"]);
    const guessed = { ...base, success_bar: bar, interpretability: constraint, task: { value: "undetermined" as const, origin: "inferred" as const } };
    expect(beforeWalk(guessed)).toEqual(["whether it predicts a class or a number"]);
  });
});

describe("withAnswers", () => {
  it("revises the question with the answers and keeps every other fact", () => {
    const answered = withAnswers(base, { "data.repeated_items": "group_by_title" }, "qv_01JABCDEFGHJKMNPQRSTVWXYZ9", "2026-10-24T10:00:00Z");
    const { id, parent_id, answers, created_at, ...kept } = answered;
    const { id: _id, parent_id: _parent, created_at: _at, answers: _answers, ...was } = base;
    expect(kept).toEqual(was);
    expect({ id, parent_id, created_at }).toEqual({
      id: "qv_01JABCDEFGHJKMNPQRSTVWXYZ9",
      parent_id: base.id,
      created_at: "2026-10-24T10:00:00Z",
    });
    expect(answers).toEqual([{ decides: "data.repeated_items", option: "group_by_title" }]);
  });

  it("replaces an earlier answer to the same decision", () => {
    const first = withAnswers(base, { "data.repeated_items": "group_by_title" }, "qv_01JABCDEFGHJKMNPQRSTVWXYZ8", "2026-10-24T10:00:00Z");
    const second = withAnswers(first, { "data.repeated_items": "independent_rows" }, "qv_01JABCDEFGHJKMNPQRSTVWXYZ9", "2026-10-24T10:01:00Z");
    expect(second.answers).toEqual([{ decides: "data.repeated_items", option: "independent_rows" }]);
  });
});
