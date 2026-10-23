import type { PipelineVersion, QuestionVersion } from "@sprisk/contracts";

/** The question the Objective page shows: the open flow's, else the newest. */
export function currentQuestion(
  questions: QuestionVersion[],
  pipeline: PipelineVersion | undefined,
): QuestionVersion | undefined {
  if (pipeline?.question_version_id) return questions.find((q) => q.id === pipeline.question_version_id);
  return questions[0];
}

/** Ledger entries still open: each unset core fact (target, unit, horizon) and each unknown. */
export const openEntries = (question: QuestionVersion): number =>
  [question.target, question.unit_of_analysis, question.prediction_horizon].filter((f) => f === undefined).length +
  question.unknowns.length;
