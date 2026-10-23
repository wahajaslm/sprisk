import type { PipelineVersion, QuestionVersion } from "@sprisk/contracts";

/** The question the Objective page shows: the newest revision of the open flow's question,
 * else the newest question. A flow version never changes, so a revision is followed through
 * `parent_id` rather than relinked. `questions` come newest first. */
export function currentQuestion(
  questions: QuestionVersion[],
  pipeline: PipelineVersion | undefined,
): QuestionVersion | undefined {
  if (!pipeline?.question_version_id) return questions[0];
  let current = questions.find((q) => q.id === pipeline.question_version_id);
  for (let next = current; next; next = questions.find((q) => q.parent_id === current?.id)) {
    current = next;
  }
  return current;
}

/** Ledger entries still open: each unset core fact (target, unit, horizon) and each unknown. */
export const openEntries = (question: QuestionVersion): number =>
  [question.target, question.unit_of_analysis, question.prediction_horizon].filter((f) => f === undefined).length +
  question.unknowns.length;
