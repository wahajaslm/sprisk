import type { Attempt, DecisionProposal, PipelineVersion, SelectionDecision } from "@sprisk/contracts";

import { useMethodologyProposal } from "../../api/methodology.ts";
import { useFlowRuns, useSelectionDecision } from "../../api/runs.ts";
import { BodySection } from "../../components/ui/RowList.tsx";
import { ChartBlock, PairedBars } from "../charts/StudioCharts.tsx";
import { FigurePort } from "../inspector/FiguresTab.tsx";
import { gain, showSettings, trialNodeOf, verdict } from "../ModelComparison.tsx";
import { formatMetric } from "../NodeFact.tsx";
import { foldsWon, METRIC_WORDS, versusRows } from "./versus.ts";

/** The flow's newest model selection: its comparison version, proposal and decision, once the
 * comparison run has decided. */
export function useLatestSelection(flowIds: string[], versions: PipelineVersion[]) {
  const mine = versions
    .filter((v) => v.compares !== undefined)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const proposal = useMethodologyProposal(mine.find(() => true)?.compares);
  const comparison = mine.find((v) => v.compares === proposal.data?.id && flowIds.includes(proposal.data?.pipeline_version_id ?? ""));
  const [latest] = useFlowRuns(comparison ? [comparison.id] : [], 1);
  const selectNode = comparison?.nodes.find((n) => n.operator.startsWith("sprisk.ml.select_model@"))?.id;
  const result = useSelectionDecision(comparison ? latest : undefined, selectNode);
  return result.status === "decided" && proposal.data ? { decision: result.decision, attempts: result.attempts, proposal: proposal.data } : undefined;
}

/** Two models on the same folds, as the design's Compare: their metrics with the change, fold
 * by fold, what each saw, and what differs between them (ADR-0050, ADR-0061). */
export function ModelVersus({ decision, attempts, proposal, a, b }: { decision: SelectionDecision; attempts: Attempt[]; proposal: DecisionProposal; a: string; b: string }) {
  const rows = versusRows(decision, a, b);
  const won = foldsWon(decision, a, b);
  const x = decision.candidates.find((c) => c.id === a);
  const y = decision.candidates.find((c) => c.id === b);
  if (!x || !y) return null;
  const attemptOf = (id: string) => attempts.filter((t) => t.node_id === trialNodeOf(decision, id) && (t.state === "succeeded" || t.state === "cache_hit")).at(-1);
  const why = (id: string) => proposal.alternatives.find((alt) => alt.id === id);
  return (
    <>
      <BodySection title="Metrics" note={`Cross-validated on the same ${decision.repeats && decision.repeats > 1 ? `${decision.repeats} × ` : ""}${decision.folds} folds of the train rows, scored by ${METRIC_WORDS[decision.metric]}. The test rows were not used.`}>
        <table className="exp-table exp-compare" aria-label="Metrics">
          <thead>
            <tr>
              <th scope="col">Metric</th>
              <th scope="col" className="num mono">{a}</th>
              <th scope="col" className="num mono">{b}</th>
              <th scope="col" className="num">Δ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <td>{r.label}</td>
                <td className="num mono">{formatMetric(r.a)}</td>
                <td className="num mono">{formatMetric(r.b)}</td>
                <td className={`num mono${r.worse ? " worse" : ""}`}>{r.delta === 0 ? "0" : `${r.delta > 0 ? "+" : "−"}${formatMetric(Math.abs(r.delta))}`}</td>
              </tr>
            ))}
            <tr>
              <td>{decision.baseline_role === "reference" ? "Gain over the recommendation ± SE" : "Gain over baseline ± SE"}</td>
              <td className="num mono">{gain(x)}</td>
              <td className="num mono">{gain(y)}</td>
              <td />
            </tr>
            <tr>
              <td>Verdict</td>
              <td className="num">{verdict(x, decision)}</td>
              <td className="num">{verdict(y, decision)}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </BodySection>
      <BodySection title="Fold by fold" note={`The same rows in each fold, so each pair is a fair contest. ${a} scored better on ${won.a} of ${won.folds} folds, ${b} on ${won.b}.`}>
        <ChartBlock
          title={`${METRIC_WORDS[decision.metric]} per fold`}
          sub={`${won.folds} folds`}
          legend={[
            { tone: "primary", text: a },
            { tone: "secondary", text: b },
          ]}
        >
          <PairedBars name={`${a} and ${b} per fold`} a={x.fold_scores} b={y.fold_scores} labels={x.fold_scores.map((_, i) => String(i + 1))} />
        </ChartBlock>
      </BodySection>
      <BodySection title="What each model saw" note="Each model's out-of-fold figures from the train rows: its confusion and which features its predictions leaned on (predictive, not causal).">
        <div className="exp-side-by-side">
          {[a, b].map((id) => (
            <section key={id} aria-label={`Figures of ${id}`}>
              <h3 className="mono">{id}</h3>
              {decision.candidates.find((c) => c.id === id)?.search ? (
                <p className="muted">No figure: its setting was tuned on these train rows, so its out-of-fold figure would look better than it is.</p>
              ) : (
                <FigurePort attempt={attemptOf(id)} port="figures" />
              )}
            </section>
          ))}
        </div>
      </BodySection>
      <BodySection title="Decision diff" note="What differs between the two choices.">
        <table className="exp-table exp-compare" aria-label="Decision diff">
          <thead>
            <tr>
              <th scope="col">Decision</th>
              <th scope="col" className="mono">{a}</th>
              <th scope="col" className="mono">{b}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Model</td>
              <td className="mono">{why(a)?.label ?? a}</td>
              <td className="mono changed-value">{why(b)?.label ?? b}</td>
            </tr>
            <tr>
              <td>Settings</td>
              <td className="mono">{x.search ? showSettings(x.search.settings) : "the flow's"}</td>
              <td className="mono">{y.search ? showSettings(y.search.settings) : "the flow's"}</td>
            </tr>
            <tr>
              <td>Why on the shortlist</td>
              <td>{why(a)?.reason ?? "—"}</td>
              <td>{why(b)?.reason ?? "—"}</td>
            </tr>
          </tbody>
        </table>
      </BodySection>
    </>
  );
}
