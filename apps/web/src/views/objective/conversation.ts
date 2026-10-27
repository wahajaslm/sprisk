import type { ColumnProfile, DatasetProfile, Fact, QuestionVersion, SelectionMetric } from "@sprisk/contracts";

/** The question conversation (ADR-0068): one ledger slot at a time, in a fixed order, with
 * choices built from the dataset profile. Plain code reads every answer; a model never fills a
 * slot. Column names are dataset text (rule 7): they are shown, never run. */

export type Slot = "target" | "task" | "unit" | "metric" | "score" | "interpretability";

const ORDER: Slot[] = ["target", "task", "unit", "metric", "score", "interpretability"];

/** A chip the page suggested and the person picked is `confirmed`; typed words are `explicit`. */
export type Said = "confirmed" | "explicit";

type Draft = Partial<
  Pick<QuestionVersion, "objective" | "task" | "target" | "unit_of_analysis" | "success_bar" | "interpretability">
>;

export interface Chat {
  draft: Draft;
  /** Slots answered or skipped. */
  done: Slot[];
  /** The metric picked, until its score makes the success bar. */
  metric?: SelectionMetric;
}

export interface Chip {
  label: string;
  /** Read exactly as if typed. */
  value: string;
}

type Interpretability = NonNullable<QuestionVersion["interpretability"]>["value"];

const METRIC_NAME: Record<SelectionMetric, string> = {
  weighted_f1: "weighted F1",
  balanced_accuracy: "balanced accuracy",
  rmse: "RMSE",
  expected_cost: "expected cost",
};
const sentenceCase = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

// Expected cost needs stated costs, which this conversation does not ask for.
const CLASS_METRICS: SelectionMetric[] = ["weighted_f1", "balanced_accuracy"];

const LEVELS: { value: Interpretability; label: string }[] = [
  { value: "high", label: "Must read the model" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "No limit on the model" },
];

// The profiler reads integer columns with more distinct values than this as measured numbers.
const MAX_CLASSES = 30;

const isNumeric = (c: ColumnProfile) => /int|float|decimal/i.test(c.data_type);

/** A column's role, or a guess from its counts for a profile made before roles were kept. */
function roleOf(c: ColumnProfile): string {
  if (c.role) return c.role;
  if (c.distinct <= 1) return "constant";
  if (c.distinct <= MAX_CLASSES) return "category";
  return isNumeric(c) ? "number" : "text";
}

/** Columns that could be the target, most likely first: categories, then measured numbers. */
function candidates(profile: DatasetProfile): ColumnProfile[] {
  const of = (roles: string[]) => profile.columns.filter((c) => roles.includes(roleOf(c)) && c.distinct > 1);
  return [...of(["category", "boolean"]), ...of(["number"])].slice(0, 3);
}

const predictsNumber = (c: ColumnProfile) => roleOf(c) === "number";

function features(profile: DatasetProfile, target?: string): string {
  const text = profile.columns.filter((c) => roleOf(c) === "text" && c.name !== target).map((c) => c.name);
  if (text.length === 0) return "the other columns";
  if (text.length <= 2) return text.join(" and ");
  return `${text[0]}, ${text[1]} and ${text.length - 2} more`;
}

function size(profile: DatasetProfile): string {
  const rows =
    profile.total_rows !== undefined
      ? `${profile.total_rows.toLocaleString("en-US")} rows`
      : `first ${profile.profiled_rows.toLocaleString("en-US")} rows`;
  return `${rows} · ${profile.total_columns} columns`;
}

/** The first message, from the profile alone: no model is asked. */
export function opening(name: string, profile: DatasetProfile): string {
  const target = candidates(profile)[0];
  if (!target) return `${name} · ${size(profile)}. Which column should be predicted?`;
  const what = predictsNumber(target) ? `${target.name} is a number.` : `${target.name} has ${target.distinct} classes.`;
  return `${name} · ${size(profile)}. ${what} Predict it from ${features(profile, target.name)}?`;
}

export function nextSlot(chat: Chat): Slot | undefined {
  return ORDER.find((slot) => !chat.done.includes(slot));
}

/** The question for the next slot. The target's question is the opening. */
export function prompt(chat: Chat): string {
  switch (nextSlot(chat)) {
    case "target":
      return "Which column should be predicted?";
    case "task":
      return `Is ${chat.draft.target?.value ?? "the target"} a class to pick or a number to estimate?`;
    case "unit":
      return "What does one row describe? For example, one product.";
    case "metric":
      return "How should models be compared?";
    case "score":
      return `What ${METRIC_NAME[chat.metric ?? "weighted_f1"]} counts as good enough?`;
    case "interpretability":
      return "Must a person be able to follow each prediction?";
    case undefined:
      return "That is enough to start. Check the ledger, then start the auto run.";
  }
}

const targetColumn = (chat: Chat, profile: DatasetProfile) =>
  profile.columns.find((c) => c.name === chat.draft.target?.value);

const classMetrics = (chat: Chat) => (chat.draft.task?.value === "regression" ? ["rmse" as const] : CLASS_METRICS);

/** The choices for the next slot, suggested one first. */
export function chips(chat: Chat, profile: DatasetProfile): Chip[] {
  switch (nextSlot(chat)) {
    case "target":
      return candidates(profile).map((c) => ({ label: `Predict ${c.name}`, value: c.name }));
    case "task": {
      const column = targetColumn(chat, profile);
      const both = [
        { label: "Classification", value: "classification" },
        { label: "Regression", value: "regression" },
      ];
      return column && predictsNumber(column) ? both.reverse() : both;
    }
    case "unit":
      return [{ label: "Skip", value: "" }];
    case "metric":
      return classMetrics(chat).map((m) => ({ label: sentenceCase(METRIC_NAME[m]), value: m }));
    case "score":
      return chat.metric === "rmse" ? [] : ["0.7", "0.8", "0.9"].map((s) => ({ label: s, value: s }));
    case "interpretability":
      return LEVELS.map((l) => ({ label: l.label, value: l.value }));
    case undefined:
      return [];
  }
}

const fact = (value: string, origin: Fact["origin"]): Fact => ({ value, origin });
const words = (text: string) => text.toLowerCase().split(/[^a-z0-9_]+/).filter(Boolean);

function readTarget(chat: Chat, profile: DatasetProfile, text: string, said: Said): Chat | undefined {
  const typed = new Set(words(text));
  const named = profile.columns.filter((c) => typed.has(c.name.toLowerCase()));
  if (named.length !== 1) return undefined;
  const target = named[0]!.name;
  // A sentence is the person's own objective; a bare name gets the page's sentence.
  const sentence = text.trim().toLowerCase() !== target.toLowerCase();
  const objective = sentence
    ? fact(text.trim(), "explicit")
    : fact(`Predict ${target} from ${features(profile, target)}`, said === "confirmed" ? "confirmed" : "inferred");
  return { ...chat, draft: { ...chat.draft, target: fact(target, said), objective } };
}

function readTask(text: string): "classification" | "regression" | undefined {
  const t = text.toLowerCase();
  if (/class|categor/.test(t)) return "classification";
  if (/regress|number|numeric|continuous|amount/.test(t)) return "regression";
  return undefined;
}

function readMetric(chat: Chat, text: string): SelectionMetric | undefined {
  const t = text.toLowerCase();
  const metric: SelectionMetric | undefined = /balanced/.test(t)
    ? "balanced_accuracy"
    : /f1/.test(t)
      ? "weighted_f1"
      : /rmse|root mean/.test(t)
        ? "rmse"
        : undefined;
  return metric && classMetrics(chat).includes(metric) ? metric : undefined;
}

function readScore(metric: SelectionMetric, text: string): number | undefined {
  const match = /^\s*(-?\d+(?:\.\d+)?)\s*(%?)\s*$/.exec(text);
  if (!match) return undefined;
  const score = Number(match[1]);
  if (metric === "rmse") return score >= 0 && !match[2] ? score : undefined;
  const share = match[2] ? score / 100 : score;
  return share >= 0 && share <= 1 ? share : undefined;
}

function readLevel(text: string): Interpretability | undefined {
  return LEVELS.find((l) => words(text).includes(l.value))?.value;
}

/** The chat after the person answers the next slot, or undefined when the answer cannot be read. */
export function answer(chat: Chat, profile: DatasetProfile, text: string, said: Said): Chat | undefined {
  const slot = nextSlot(chat);
  if (!slot) return undefined;
  const next = (changed: Partial<Chat>): Chat => ({ ...chat, ...changed, done: [...chat.done, slot] });
  switch (slot) {
    case "target": {
      const read = readTarget(chat, profile, text, said);
      return read && next(read);
    }
    case "task": {
      const task = readTask(text);
      return task && next({ draft: { ...chat.draft, task: { value: task, origin: said } } });
    }
    case "unit": {
      const unit = text.trim();
      return next(unit ? { draft: { ...chat.draft, unit_of_analysis: fact(unit, said) } } : {});
    }
    case "metric": {
      const metric = readMetric(chat, text);
      return metric && next({ metric });
    }
    case "score": {
      const metric = chat.metric!;
      const score = readScore(metric, text);
      // A success bar is only ever stated by a person: its origin is explicit.
      return score === undefined
        ? undefined
        : next({ draft: { ...chat.draft, success_bar: { value: { metric, score }, origin: "explicit" } } });
    }
    case "interpretability": {
      const level = readLevel(text);
      return level && next({ draft: { ...chat.draft, interpretability: { value: level, origin: "explicit" } } });
    }
  }
}

/** The draft as a question version, once it has an objective and a task. */
export function toQuestion(chat: Chat, id: string, investigationId: string, createdAt: string): QuestionVersion | undefined {
  const { objective, task, ...rest } = chat.draft;
  if (!objective || !task) return undefined;
  return {
    schema_version: "sprisk.question_version/v1",
    id,
    investigation_id: investigationId,
    objective,
    task,
    ...rest,
    assumptions: [],
    unknowns: [],
    acceptance_criteria: [],
    created_at: createdAt,
  };
}
