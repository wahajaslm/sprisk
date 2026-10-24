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

/** What a person must state before a walk, since no data can give it (ADR-0063 amendment):
 * the walk asks nothing else of the question up front. */
export function beforeWalk(question: QuestionVersion): string[] {
  const task = question.task.value;
  if (task !== "classification" && task !== "regression") return ["whether it predicts a class or a number"];
  const stated = (fact: { origin: string } | undefined) => fact !== undefined && fact.origin !== "inferred";
  if (!stated(question.target)) return ["the target column"];
  return [
    ...(question.success_bar ? [] : ["the success bar"]),
    ...(question.interpretability ? [] : ["how far a person must follow each prediction"]),
  ];
}

/** A revision of `question` carrying `answers` (decision key to option), replacing any earlier
 * answer to the same decision and keeping every other fact. */
export function withAnswers(
  question: QuestionVersion,
  answers: Record<string, string>,
  id: string,
  createdAt: string,
): QuestionVersion {
  const kept = (question.answers ?? []).filter((a) => !(a.decides in answers));
  const given = Object.entries(answers).map(([decides, option]) => ({ decides, option }));
  return { ...question, id, parent_id: question.id, answers: [...kept, ...given], created_at: createdAt };
}
