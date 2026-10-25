import type { Attempt, FlowDecision, FlowDecisions, LoadedTable, Operator, PipelineVersion, Report, ReportEvidence, Walk } from "@sprisk/contracts";
import { useState } from "react";

import { useOperatorsByRef, useOutputs, useRunAttempts } from "../../api/hooks.ts";
import { useMethodologyRules } from "../../api/methodology.ts";
import { useQuestionVersions } from "../../api/questions.ts";
import { useFlowDecisionsOf, useWalk, useWalkReport } from "../../api/walks.ts";
import { Button } from "../../components/ui/Button.tsx";
import { ListRow } from "../../components/ui/ListRow.tsx";
import { Loading } from "../../components/ui/Loading.tsx";
import { BodySection } from "../../components/ui/RowList.tsx";
import { latestByNode } from "../../flow/latest.ts";
import { useSelection } from "../../workbench/selection.ts";
import { FigurePort } from "../inspector/FiguresTab.tsx";
import { PromiseList } from "../PromiseList.tsx";
import { when } from "../when.ts";
import { type DecidedBy, type StoryDecision, walkStory } from "./walkStory.ts";

/** Flow versions whose decisions are read for one table. */
const MAX_VERSIONS = 20;

/** One walk that loaded the table: the flow version and run that show its decisions. */
type Investigation = { walkId: string; pipelineVersionId: string; runId: string; decisions: FlowDecision[] };

/** The investigations that used a table, each as its decisions and its report (ADR-0065). A
 * view over records: it decides nothing and runs nothing. */
export function InvestigationTab({ dataset, versions }: { dataset: LoadedTable; versions: PipelineVersion[] }) {
  const [picked, setPicked] = useState<string>();
  const all = [...new Set(dataset.used_by.map((u) => u.pipeline_version_id))];
  // One request per version: a bounded number, said on screen when more load the table.
  const ids = all.slice(0, MAX_VERSIONS);
  const read = useFlowDecisionsOf(ids);
  const failed = read.find((r) => r.isError);
  if (failed?.error) return <p role="alert" className="error">The decisions could not be read: {failed.error.message}</p>;
  if (read.some((r) => r.isPending)) return <Loading text="Reading the investigations…" />;
  const found = investigations(dataset, read.flatMap((r) => (r.data ? [r.data] : [])));
  if (found.length === 0)
    return <p className="muted">No investigation has used this table yet. Start one on the Objective page; its findings and decisions show here.</p>;
  const current = found.find((i) => i.walkId === picked) ?? found[0]!;
  return (
    <div className="ds-investigation">
      {all.length > ids.length && <p className="muted">{`Showing the investigations of the first ${ids.length} of ${all.length} pipeline versions that load this table.`}</p>}
      {found.length > 1 && (
        <div role="list" aria-label="Investigations" className="ds-investigations">
          {found.map((i) => (
            <div key={i.walkId} role="listitem">
              <WalkRow investigation={i} selected={i === current} onPick={() => setPicked(i.walkId)} />
            </div>
          ))}
        </div>
      )}
      <InvestigationView key={current.walkId} dataset={dataset} investigation={current} pipeline={versions.find((v) => v.id === current.pipelineVersionId)} />
    </div>
  );
}

/** Each walk once, shown on the use whose version carries the most of its decisions. A walk's
 * later versions keep every earlier decision, so that is the furthest one a run loaded. */
function investigations(dataset: LoadedTable, decided: FlowDecisions[]): Investigation[] {
  const byWalk = new Map<string, Investigation>();
  for (const use of dataset.used_by) {
    const flow = decided.find((d) => d.pipeline_version_id === use.pipeline_version_id);
    if (!flow?.walk_id) continue;
    const seen = byWalk.get(flow.walk_id);
    if (seen && seen.decisions.length >= flow.decisions.length) continue;
    byWalk.set(flow.walk_id, { walkId: flow.walk_id, pipelineVersionId: use.pipeline_version_id, runId: use.run_id, decisions: flow.decisions });
  }
  // Walk ids are ULIDs, so the newest walk sorts first.
  return [...byWalk.values()].sort((a, b) => b.walkId.localeCompare(a.walkId));
}

/** One walk in the list: when it started, how many decisions it made, and where it is. */
function WalkRow({ investigation, selected, onPick }: { investigation: Investigation; selected: boolean; onPick: () => void }) {
  const walk = useWalk(investigation.walkId).data?.walk;
  const n = investigation.decisions.length;
  const decisions = n === 0 ? "no decision yet" : `${n} ${n === 1 ? "decision" : "decisions"}`;
  return (
    <ListRow
      title={walk ? `Auto run · ${when(walk.created_at)}` : `Auto run ${investigation.walkId.slice(-6)}`}
      meta={walk ? `${decisions} · ${walkState(walk)}` : decisions}
      selected={selected}
      onClick={onPick}
    />
  );
}

function InvestigationView({ dataset, investigation, pipeline }: { dataset: LoadedTable; investigation: Investigation; pipeline: PipelineVersion | undefined }) {
  const walk = useWalk(investigation.walkId);
  const questions = useQuestionVersions();
  const operators = useOperatorsByRef();
  const rules = useMethodologyRules();
  const attempts = useRunAttempts(investigation.pipelineVersionId, investigation.runId);
  const stopped = walk.data?.walk;
  const report = useWalkReport(stopped?.stop?.reason === "complete" ? investigation.walkId : undefined);
  const question = report.data?.question ?? questions.data?.find((q) => q.id === stopped?.question_version_id)?.objective.value;
  const latest = latestByNode(attempts.data ?? []);
  const operatorOf = (step: string) => {
    const node = pipeline?.nodes.find((n) => n.id === step);
    return node ? operators.data?.get(node.operator) : undefined;
  };
  if (walk.isError) return <p role="alert" className="error">The auto run could not be read: {walk.error.message}</p>;
  if (!walk.data) return <Loading text="Reading the auto run…" />;
  const story = walkStory(walk.data.steps, investigation.decisions, rules.data ?? []);
  const promises = investigation.decisions.flatMap((d) => d.promises.map((p) => ({ ...p, question: d.question })));
  const holding = promises.filter((p) => p.status === "pass").length;
  const looked = investigation.decisions.flatMap((d) =>
    (d.evidence ?? []).flatMap((e) => {
      const operator = operatorOf(e.step);
      const scope = operator && scopeWords(operator);
      return operator && scope ? [{ key: `${d.decides}:${e.step}`, name: d.name, question: d.question, text: `${operator.title} ${scope}` }] : [];
    }),
  );
  return (
    <>
      <BodySection title="Summary" note="What the auto run set out to answer, what it did, and what it found.">
        <dl role="group" aria-label="Investigation context" className="ds-context">
          <div>
            <dt>Dataset</dt>
            <dd>{dataset.name}</dd>
          </div>
          <div>
            <dt>Question</dt>
            <dd>{question ?? `Auto run ${investigation.walkId.slice(-6)}`}</dd>
          </div>
          <div>
            <dt>Auto run</dt>
            <dd>{walkState(walk.data.walk)}</dd>
          </div>
        </dl>

        <div className="ds-story-summary">
          <p>
            {`The auto run read ${dataset.name} (${dataset.total_rows.toLocaleString()} rows) to answer this question. It looked at the data once before deciding anything, asked you ${count(story.asked, "question")}, made ${count(story.decisions.length, "decision")} and ran the pipeline ${count(story.runs, "time")}. `}
            {story.scored ? "It then scored the model on the held-out test rows, once." : "It has not scored the test rows."}
          </p>
          {report.data ? <p className="ds-result">{report.data.answer.statement}</p> : walk.data.walk.stop && <p className="ds-result muted">{walk.data.walk.stop.detail}</p>}
        </div>

        <ol className="ds-glance" aria-label="The auto run at a glance">
          <li>
            <strong>Set up</strong>
            <span>Load, split, baseline</span>
          </li>
          <li>
            <strong>First look</strong>
            <span>{count(looked.length, "measurement")}</span>
          </li>
          <li>
            <strong>Asked you</strong>
            <span>{count(story.asked, "question")}</span>
          </li>
          <li>
            <strong>Decided</strong>
            <span>{count(story.decisions.length, "decision")}</span>
          </li>
          <li>
            <strong>Checked</strong>
            <span>{promises.length === 0 ? "no promises" : `${holding} of ${count(promises.length, "promise")} hold`}</span>
          </li>
          <li>
            <strong>Scored</strong>
            <span>{story.scored ? "once, on test rows" : "not yet"}</span>
          </li>
        </ol>
      </BodySection>

      {looked.length > 0 && (
        <BodySection title="What the first look measured" note="Before deciding anything, the auto run ran the pipeline once and measured what each question needs.">
          <ul className="ds-looked">
            {looked.map((l) => (
              <li key={l.key}>
                <span>
                  <span className="ds-looked-question">{l.name}</span>
                  <span className="ds-line muted">{l.question}</span>
                </span>
                <span className="muted">{l.text}</span>
              </li>
            ))}
          </ul>
        </BodySection>
      )}

      <BodySection title="Findings and decisions" note="In the order the auto run made them. Each says what was found, what was measured, and what was decided, by whom.">
        {story.decisions.length === 0 && <p className="muted">The auto run made no decision yet.</p>}
        {story.decisions.map((d, i) => (
          <Finding key={d.round} number={i + 1} entry={d} investigation={investigation} operatorOf={operatorOf} latest={latest} />
        ))}
      </BodySection>

      {promises.length > 0 && (
        <BodySection title="Checks" note="What the decisions promised, checked on what the pipeline actually wrote. Stale is never shown as holding.">
          <PromiseList promises={promises} />
        </BodySection>
      )}

      <ReportSection walk={stopped} report={report.data} failure={report.error?.message} />
    </>
  );
}

const walkState = (walk: Walk) => (walk.stop ? walk.stop.reason.replaceAll("_", " ") : "running");

const count = (n: number, word: string) => `${n} ${n === 1 ? word : `${word}s`}`;

const BY: Record<DecidedBy, string> = { person: "You answered", method: "The method decided", rule: "A rule decided" };

/** One decision of the walk: the chart its evidence drew, large, then what was found, what was
 * measured and what was decided, by whom. */
function Finding({
  number,
  entry,
  investigation,
  operatorOf,
  latest,
}: {
  number: number;
  entry: StoryDecision;
  investigation: Investigation;
  operatorOf: (step: string) => Operator | undefined;
  latest: Map<string, Attempt>;
}) {
  const showRun = useSelection((s) => s.showRun);
  const setNav = useSelection((s) => s.setNav);
  const decision = entry.decision;
  const producers = [...new Set([...(decision?.evidence ?? []).map((e) => e.step), ...(decision?.steps ?? [])])];
  const charts = producers.flatMap((step) => (operatorOf(step)?.outputs ?? []).filter((o) => o.kind === "figure").map((o) => ({ step, port: o.name })));
  const measured = (decision?.evidence ?? []).flatMap((e) => Object.entries(e.fields).map(([name, value]) => ({ key: `${e.step}:${name}`, name: name.replaceAll("_", " "), value: valueWords(value) })));
  const first = decision?.steps[0];
  return (
    <article className="ds-finding" aria-label={entry.title}>
      <header className="ds-finding-head">
        <span className="ds-finding-number">{number}</span>
        <div>
          <h3 className="ds-finding-title">{entry.title}</h3>
          {entry.question && <p className="ds-finding-question">{entry.question}</p>}
          <p className="ds-finding-by">{BY[entry.by]}</p>
        </div>
      </header>
      {charts.length > 0 && (
        <div className="ds-finding-charts">
          {charts.map((c) => (
            <AnalysisChart key={`${c.step}:${c.port}`} attempt={latest.get(c.step)} port={c.port} />
          ))}
        </div>
      )}
      <div className="ds-finding-body">
        <div>
          <p className="rd-label">Found</p>
          <p>{entry.finding}</p>
        </div>
        {measured.length > 0 && (
          <div>
            <p className="rd-label">Measured</p>
            <table className="ds-measured" aria-label="Measured">
              <tbody>
                {measured.map((m) => (
                  <tr key={m.key}>
                    <th scope="row">{m.name}</th>
                    <td className="mono">{m.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div>
          <p className="rd-label">Decided</p>
          <p className="ds-choice">{entry.choice || "—"}</p>
          {decision && decision.steps.length === 0 && <p className="muted">Leaves the pipeline unchanged.</p>}
          {first && (
            <Button
              size="sm"
              onClick={() => {
                showRun(investigation.pipelineVersionId, investigation.runId, first);
                setNav("Flow");
              }}
            >
              Open in pipeline
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}

/** A producer's chart, when its run drew one. A run from before the producer drew charts
 * has no such output, and an empty frame would only say so. */
function AnalysisChart({ attempt, port }: { attempt: Attempt | undefined; port: string }) {
  const outputs = useOutputs(attempt?.id);
  if (outputs.isError) return <p role="alert" className="error">The step's outputs could not be read: {outputs.error.message}</p>;
  if (!outputs.data?.some((o) => o.port === port)) return null;
  return (
    <figure className="result-tile plot">
      <FigurePort attempt={attempt} port={port} />
    </figure>
  );
}

function valueWords(value: unknown): string {
  if (Array.isArray(value)) return value.length === 0 ? "none" : value.join(", ");
  if (typeof value === "boolean") return value ? "yes" : "no";
  // Shares arrive with every digit a float has; three significant ones say the same.
  if (typeof value === "number" && !Number.isInteger(value)) return String(Number(value.toPrecision(3)));
  if (typeof value === "number") return value.toLocaleString();
  return String(value);
}

/** Which rows an evidence producer read, from its manifest. A step that is not a producer has
 * none to say. */
function scopeWords(operator: Operator): string | undefined {
  if (!operator.attach) return undefined;
  if (operator.attach.side === "output") return "read what the split wrote.";
  return operator.scope === "train" ? "read the training rows only." : "read every row, before the split.";
}

function ReportSection({ walk, report, failure }: { walk: Walk | undefined; report: Report | undefined; failure: string | undefined }) {
  if (!walk) return null;
  if (walk.stop?.reason !== "complete") {
    const why = walk.stop ? `The auto run stopped: ${walk.stop.detail}` : "The auto run is still running.";
    return (
      <BodySection title="Report">
        <p className="muted">No report yet. {why}</p>
      </BodySection>
    );
  }
  if (failure) return <p role="alert" className="error">The report could not be read: {failure}</p>;
  if (!report) return <Loading text="Reading the report…" />;
  return (
    <BodySection title="Report" note="Built from the auto run's records, never written by a model. It does not change once saved.">
      <p className="ds-answer">{report.answer.statement}</p>
      <ul className="ds-claims" aria-label="Claims">
        {report.claims.map((c) => (
          <li key={c.statement}>
            <span className="ds-line">{c.statement}</span>
            <small className="mono muted">{c.evidence.map(evidenceWords).join(" · ")}</small>
          </li>
        ))}
      </ul>
      <p className="rd-label">Limitations</p>
      <ul className="ds-limitations" aria-label="Limitations">
        {report.limitations.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </BodySection>
  );
}

function evidenceWords(e: ReportEvidence): string {
  if ("decision" in e) return `decision ${e.decision}`;
  if ("run" in e) return `run ${e.run}`;
  if ("pipeline_version" in e) return `version ${e.pipeline_version}`;
  return `auto run step ${e.walk_step.round}`;
}
