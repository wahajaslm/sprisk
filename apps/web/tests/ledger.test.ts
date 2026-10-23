import type { PipelineVersion, QuestionVersion } from "@sprisk/contracts";
import { parse } from "@sprisk/contracts";
import { describe, expect, it } from "vitest";

import questionJson from "../../../tests/contract/question_version/valid/classification-all-fields.json";
import pipelineJson from "../../../tests/contract/pipeline_version/valid/linked-question.json";
import { currentQuestion } from "../src/views/objective/ledger.ts";

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
