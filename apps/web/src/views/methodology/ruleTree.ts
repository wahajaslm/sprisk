import type { FlowDecision, MethodologyRule, MethodologyStage } from "@sprisk/contracts";
import type { Edge, Node } from "@xyflow/react";

/** Decision order (ADR-0059): the split comes before cleaning, since cleaning measures train rows. */
export const STAGES: MethodologyStage[] = ["question", "data", "split", "cleaning", "features", "models", "evaluation", "reporting"];
const STAGE_NAME: Record<MethodologyStage, string> = {
  question: "Problem definition",
  data: "Data preparation",
  split: "Data splitting",
  cleaning: "Data cleaning",
  features: "Feature engineering",
  models: "Modelling",
  evaluation: "Evaluation",
  reporting: "Reporting",
};
export const stageName = (stage: MethodologyStage) => STAGE_NAME[stage];

/** Sizes given up front: a tree has no need to measure its nodes before placing them. A route
 * grows to fit its reason, wrapped onto up to three lines; every other node has one height. */
const HEIGHT = 36;
const SIZE = { root: { width: 64 }, stage: { width: 180 }, rule: { width: 300 }, route: { width: 340 } };
const WHEN_LINE = 15;
const WHEN_LINES = 3;
/** Characters of the condition's monospace text that fit one line of a route. */
const WHEN_CHARS = 48;
const ROUTE_GAP = 6;
const RULE_GAP = 10;
const GAP = 72;
const LANE_GAP = 96;
/** Stages every methodology goes through before the lanes fork. */
const SHARED: MethodologyStage[] = ["question", "data"];
/** Lanes in this order first; any other pack follows by name. */
const LANE_ORDER = ["supervised", "unsupervised"];

type Kind = "trunk" | "branch" | "skip";
/** Why a route is taken: the selected flow's own reason when its rule chose the route, else
 * the condition that leads to it, else the route's rationale. */
export type RouteReason = { kind: "because" | "when" | "why"; text: string };

/** What sends a question down each lane. */
export const LANE_NOTE: Record<string, string> = { supervised: "the question has a target", unsupervised: "the question has no target" };
type Tail = { id: string; lit: boolean; kind: Kind };

export type TreeNode =
  | Node<{ count: number }, "root">
  | Node<{ lane: string; code: string; dimmed: boolean }, "lane">
  | Node<{ stage: MethodologyStage; count: number; code: string; dimmed: boolean }, "stage">
  | Node<{ rule: MethodologyRule; decided: OnFlow | undefined; code: string; dimmed: boolean }, "rule">
  | Node<{ route: MethodologyRule["alternatives"][number]; reason: RouteReason; code: string; picked: boolean; dimmed: boolean }, "route">;

/** The pack a rule comes from (`methodology/<pack>/`), named in its id. */
export const packOf = (rule: MethodologyRule) => rule.id.split(".")[1] ?? "";

const routeHeight = (reason: RouteReason) => 24 + Math.min(WHEN_LINES, Math.ceil((reason.text.length + 9) / WHEN_CHARS)) * WHEN_LINE + 6;

export function routeReason(rule: MethodologyRule, route: MethodologyRule["alternatives"][number], decided: OnFlow | undefined): RouteReason {
  if (decided?.option === route.id) return { kind: "because", text: decided.reason };
  if (route.when) return { kind: "when", text: withSettings(route.when, rule.policy_thresholds) };
  const when = routeWhen(rule, route.id);
  return when ? { kind: "when", text: when } : { kind: "why", text: route.rationale };
}

/** A rule's words with each `{setting}` replaced by the setting's value, so the words never
 * disagree with the rule's settings (ADR-0045 amendment). */
export const withSettings = (text: string, settings: Record<string, unknown> | undefined) =>
  text.replace(/\{(\w+)\}/g, (whole, name: string) => (settings && name in settings ? String(settings[name]) : whole));

/** What a rule looks at, in plain words, from the facts it declares it reads: the test run
 * fails a rule that reads anything else, so this cannot drift from its logic. */
export function lookedAt(rule: MethodologyRule): string[] {
  const plain = (fact: string) => {
    if (fact === "rows") return "the number of rows";
    if (fact.startsWith("question.costs.")) return "the stated error costs";
    const column = /^(?:input\.)?column\.\*\.(.+)$/.exec(fact);
    if (column) return `each column's ${words(column[1]!)}`;
    if (fact.startsWith("input.")) return `the table's ${words(fact.split(".").at(-1)!)}`;
    const [scope, ...rest] = fact.split(".");
    const what = words(rest.join(" ").replace("*", "each"));
    if (scope === "question") return `the ${what}`;
    if (scope === "target") return `the target's ${words(rest.join("_"))}`;
    if (scope === "step") return what === "each" ? "the step's settings" : `the step's ${what}`;
    if (scope === "candidate") return `each candidate's ${words(rest.at(-1)!)}`;
    if (scope === "cv") return `cross-validation ${what}`;
    if (scope === "join") return "how the tables' keys match";
    return what;
  };
  return [...new Set((rule.reads ?? []).map(plain))];
}

/** Measures as people say them; any other name is read with its underscores as spaces. */
const MEASURE: Record<string, string> = {
  distinct: "number of distinct values",
  missing_share: "share of missing values",
  rarest_share: "rarest class's share",
  data_type: "type",
  outlier_share: "share of outliers",
  iqr: "middle spread (IQR)",
  kurtosis: "tail heaviness",
  numeric_share: "share of values that read as numbers",
  word_share: "share of one-word values",
  unconverted: "values that do not read as numbers",
  leading_zero_values: "codes with leading zeros",
  case_variants: "values differing only in case or spaces",
  accent_variants: "values differing only in accents",
  duplicate_rows: "number of repeated rows",
};
const words = (name: string) => MEASURE[name] ?? name.replace(/[._]/g, " ");

/** The methodology as a connected tree (ADR-0059), every possibility, left to right. The
 * question and data stages are shared; then the tree forks into one lane per pack (supervised:
 * the question has a target; unsupervised: it has none). In each lane the stages run in
 * decision order on one line, each fanning out into its decisions, each decision into its
 * routes, and the routes join into the next stage. Every node is numbered: stage "4",
 * decision "4.1", route "4.1a". A tree of fixed shape is placed directly, without a layout
 * engine. `decided` holds what the selected flow's walk decided per method: the route it took
 * is picked. With `path`, the flow's path is marked (`data.onPath`): its lane, up to the last stage
 * it reaches, through the decisions it has a step for and the routes it takes, and straight on
 * (a "skip" link) from a stage it takes no route in. All else is dimmed. View state only. */
/** Where a route's branches meet it: the middle of its label line, which the stylesheet puts
 * 16px from its top (8px padding, then a 15px line). */
export const ROUTE_LINE = 16;

export function ruleTree(rules: MethodologyRule[], decided: Map<string, OnFlow>, { path }: { path: boolean }): { nodes: TreeNode[]; edges: Edge[] } {
  const nodes: TreeNode[] = [];
  const edges: Edge<{ onPath: boolean; kind: Kind }>[] = [];
  const onPath = (rule: MethodologyRule) => decided.get(rule.id)?.step !== undefined;
  const link = (tails: Tail[], target: string, reach: boolean, label?: string) => {
    for (const tail of tails) edges.push({ id: `${tail.id}>${target}`, source: tail.id, target, data: { onPath: tail.lit && reach, kind: tail.kind }, ...(label ? { label } : {}) });
  };
  const fanHeight = (mine: MethodologyRule[]) =>
    mine.reduce((h, rule) => h + Math.max(HEIGHT, rule.alternatives.reduce((r, a) => r + routeHeight(routeReason(rule, a, decided.get(rule.id))) + ROUTE_GAP, -ROUTE_GAP)) + RULE_GAP, -RULE_GAP);

  /** Places one stage centred on `centre` at `x`: its node, then its fan. Returns the tails the
   * next stage is reached from and the x after it. */
  const stage = (stageId: string, stageName: MethodologyStage, code: string, mine: MethodologyRule[], x: number, centre: number, reach: boolean, tails: Tail[]) => {
    link(tails, stageId, reach);
    nodes.push({ id: stageId, type: "stage", position: { x, y: centre - HEIGHT / 2 }, width: SIZE.stage.width, height: HEIGHT, data: { stage: stageName, count: mine.length, code, dimmed: path && !reach } });
    x += SIZE.stage.width + GAP;
    if (mine.length === 0) return { tails: [{ id: stageId, lit: reach, kind: "trunk" as Kind }], x };

    const next: Tail[] = [];
    let y = centre - fanHeight(mine) / 2;
    mine.forEach((rule, k) => {
      const chosen = decided.get(rule.id);
      const ruleOnPath = onPath(rule);
      const ruleCode = `${code}.${k + 1}`;
      edges.push({ id: `${stageId}>${rule.id}`, source: stageId, target: rule.id, data: { onPath: reach && ruleOnPath, kind: "branch" } });
      const top = y;
      const lines = rule.alternatives.map((route, i) => {
        const id = `${rule.id}#${route.id}`;
        const reason = routeReason(rule, route, chosen);
        const height = routeHeight(reason);
        const picked = chosen?.option === route.id;
        const taken = ruleOnPath && picked;
        nodes.push({ id, type: "route", position: { x: x + SIZE.rule.width + GAP, y }, width: SIZE.route.width, height, data: { route, reason, code: `${ruleCode}${String.fromCharCode(97 + i)}`, picked, dimmed: path && !taken } });
        edges.push({ id: `${rule.id}>${id}`, source: rule.id, target: id, data: { onPath: reach && taken, kind: "branch" } });
        next.push({ id, lit: reach && taken, kind: "trunk" });
        // Branches meet a route at its label line, the top row, above its wrapped condition.
        const line = y + ROUTE_LINE;
        y += height + ROUTE_GAP;
        return line;
      });
      if (lines.length === 0) {
        next.push({ id: rule.id, lit: reach && ruleOnPath, kind: "trunk" });
        lines.push(y + HEIGHT / 2);
        y += HEIGHT + ROUTE_GAP;
      }
      const middle = (lines[0]! + lines[lines.length - 1]!) / 2;
      nodes.push({ id: rule.id, type: "rule", position: { x, y: middle - HEIGHT / 2 }, width: SIZE.rule.width, height: HEIGHT, data: { rule, decided: chosen, code: ruleCode, dimmed: path && !ruleOnPath } });
      y = Math.max(y, top + HEIGHT + ROUTE_GAP) - ROUTE_GAP + RULE_GAP;
    });
    x += SIZE.rule.width + GAP + SIZE.route.width + GAP;
    // The path goes straight on from a stage it takes no route in.
    const tailsOut = reach && !next.some((t) => t.lit) ? [...next, { id: stageId, lit: true, kind: "skip" as Kind }] : next;
    return { tails: tailsOut, x };
  };

  const lanes = [...new Set(rules.filter((r) => !SHARED.includes(r.stage)).map(packOf))].sort(
    (p, q) => (LANE_ORDER.indexOf(p) + 1 || 99) - (LANE_ORDER.indexOf(q) + 1 || 99) || p.localeCompare(q),
  );
  const laneStages = (lane: string) => STAGES.filter((s) => !SHARED.includes(s) && rules.some((r) => r.stage === s && packOf(r) === lane));
  const laneRules = (lane: string, s: MethodologyStage) => rules.filter((r) => r.stage === s && packOf(r) === lane);
  const laneReached = (lane: string) => laneStages(lane).reduce((last, s, at) => (laneRules(lane, s).some(onPath) ? at : last), -1);
  const anyOnPath = rules.some(onPath);

  // Shared stages on the middle line.
  nodes.push({ id: "root", type: "root", position: { x: 0, y: -HEIGHT / 2 }, width: SIZE.root.width, height: HEIGHT, data: { count: rules.length } });
  let tails: Tail[] = [{ id: "root", lit: path && anyOnPath, kind: "trunk" }];
  let x = SIZE.root.width + GAP;
  SHARED.forEach((s, at) => {
    const placed = stage(`stage:${s}`, s, `${at + 1}`, rules.filter((r) => r.stage === s), x, 0, path && anyOnPath, tails);
    tails = placed.tails;
    x = placed.x;
  });

  // Lanes stacked around the middle line, each as tall as its tallest fan.
  const spans = lanes.map((lane) => Math.max(HEIGHT, ...laneStages(lane).map((s) => fanHeight(laneRules(lane, s)))));
  let top = -(spans.reduce((a, b) => a + b, 0) + LANE_GAP * (lanes.length - 1)) / 2;
  const forkTails = tails;
  lanes.forEach((lane, i) => {
    const centre = top + spans[i]! / 2;
    top += spans[i]! + LANE_GAP;
    const reached = laneReached(lane);
    const laneId = `lane:${lane}`;
    link(forkTails, laneId, path && reached >= 0, LANE_NOTE[lane]);
    nodes.push({ id: laneId, type: "lane", position: { x, y: centre - HEIGHT / 2 }, width: SIZE.stage.width, height: HEIGHT, data: { lane, code: "", dimmed: path && reached < 0 } });
    let laneTails: Tail[] = [{ id: laneId, lit: path && reached >= 0, kind: "trunk" }];
    let laneX = x + SIZE.stage.width + GAP;
    laneStages(lane).forEach((s, at) => {
      const placed = stage(`stage:${lane}:${s}`, s, `${SHARED.length + at + 1}`, laneRules(lane, s), laneX, centre, path && at <= reached, laneTails);
      laneTails = placed.tails;
      laneX = placed.x;
    });
  });
  return { nodes, edges };
}

/** What the selected flow's walk decided for one method (ADR-0063): the option it took, why,
 * and the first step it shaped, when it shaped one. */
export type OnFlow = { option: string; reason: string; step: string | undefined };

/** How a method the flow's walk decided is labelled. */
export const DECIDED = "Decided";

/** The flow's decisions by method id, the id the map shows the method under. */
export function decidedOnFlow(decisions: FlowDecision[]): Map<string, OnFlow> {
  return new Map(decisions.map((d) => [d.method, { option: d.option, reason: d.reason, step: d.steps[0] }]));
}

/** A fact's name as people read it: `question.time_column` → "time column",
 * `column.age.missing_share` → "age missing share". */
const factName = (name: string) =>
  name
    .replace(/^(question|flow|step|candidate)\./, "")
    .replace(/^(input\.)?column\./, "")
    .replace(/[._]/g, " ");

type Given = NonNullable<MethodologyRule["examples"]>[number]["given"][string];

/** An example's fact value as text: a list of dataset values joined, a fact with its origin
 * shown as its value only. */
export const givenText = (value: Given): string =>
  Array.isArray(value) ? value.join(", ") : typeof value === "object" ? value.value : String(value);

/** When a route is taken. A draft's route has its written condition. An active rule's logic is
 * its decide() alone (ADR-0045), so its route shows the first tested example that picks it, in
 * plain words, leaving out the target's name, which never decides a route. */
export function routeWhen(rule: MethodologyRule, routeId: string): string | undefined {
  const route = rule.alternatives.find((a) => a.id === routeId);
  if (route?.condition) return route.condition;
  const example = (rule.examples ?? []).find((e) => e.picks === routeId);
  if (!example) return undefined;
  return Object.entries(example.given)
    .filter(([name]) => name !== "question.target")
    .map(([name, value]) => `${factName(name)} = ${givenText(value)}`)
    .join(" · ");
}

/** Which steps a decision activates on: the operators it decides, without pack and version. */
export function activation(rule: MethodologyRule): string | undefined {
  const steps = (rule.applies_to ?? []).map((op) => op.split(".").slice(2).join(" ").replace(/_/g, " "));
  return steps.length ? `on ${steps.join(" or ")} steps` : undefined;
}
