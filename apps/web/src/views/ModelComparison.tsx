import type { DecisionProposal, PipelineVersion, SelectionDecision } from "@sprisk/contracts";

import { useApplyMethodology, useMethodologyProposals } from "../api/methodology.ts";
import { useFlowRuns, useSelectionDecision } from "../api/runs.ts";
import { useSelection } from "../workbench/selection.ts";
import { formatMetric } from "./NodeFact.tsx";

const METRIC_LABEL: Record<SelectionDecision["metric"], string> = { balanced_accuracy: "balanced accuracy", rmse: "RMSE" };

/** The model comparisons of this flow (ADR-0044): versions that cross-validate a shortlist
 * of one of its versions. */
export function ModelComparisons({ flowIds, versions }: { flowIds: string[]; versions: PipelineVersion[] }) {
  const comparisons = versions.flatMap((v) => (v.compares === undefined ? [] : [{ version: v, proposalId: v.compares }]));
  const proposals = useMethodologyProposals(comparisons.map((c) => c.proposalId));
  const mine = comparisons.flatMap((c, i) => {
    const proposal = proposals[i]?.data;
    return proposal && flowIds.includes(proposal.pipeline_version_id) ? [{ version: c.version, proposal }] : [];
  });
  const failed = proposals.find((p) => p.isError)?.error;
  return (
    <>
      {failed && <p role="alert" className="error pad">A model comparison cannot be shown: {failed.message}</p>}
      {mine.map(({ version, proposal }) => (
        <Comparison key={version.id} comparison={version} proposal={proposal} />
      ))}
    </>
  );
}

function Comparison({ comparison, proposal }: { comparison: PipelineVersion; proposal: DecisionProposal }) {
  const [latest] = useFlowRuns([comparison.id], 1);
  const selectNode = comparison.nodes.find((n) => n.operator.startsWith("sprisk.ml.select_model@"))?.id;
  const result = useSelectionDecision(latest, selectNode);
  return (
    <section className="model-comparison" aria-label="Model comparison">
      <p className="eyebrow">
        Model comparison · {proposal.subject_node_id}
        {result.status === "decided" && ` · ${result.decision.folds} folds · ${METRIC_LABEL[result.decision.metric]}`}
      </p>
      <p className="muted">Cross-validated on the split's train rows only. The test rows stay for the chosen model.</p>
      {result.status === "decided" ? (
        <Decided decision={result.decision} artifactId={result.artifactId} proposal={proposal} />
      ) : result.status === "failed" ? (
        <p role="alert" className="error">The comparison failed: {result.message}</p>
      ) : (
        <p className="muted">
          {result.status === "not_run" ? "Not run yet." : result.status === "running" ? `Cross-validating ${proposal.shortlist?.length ?? 0} models…` : "Loading…"}
        </p>
      )}
    </section>
  );
}

function Decided({ decision, artifactId, proposal }: { decision: SelectionDecision; artifactId: string; proposal: DecisionProposal }) {
  const apply = useApplyMethodology();
  const selectPipelineVersion = useSelection((s) => s.selectPipelineVersion);
  const reason = `Selected by cross-validation (${artifactId}): ${decision.reason}`;
  return (
    <>
      <table className="exp-table" aria-label="Candidates">
        <thead>
          <tr>
            <th scope="col">Model</th>
            <th scope="col" className="num">Mean ± spread</th>
            <th scope="col" className="num">Gain over baseline ± corrected SE</th>
            <th scope="col">Verdict</th>
          </tr>
        </thead>
        <tbody>
          {decision.candidates.map((c) => {
            const versus = c.versus_baseline;
            const verdict =
              c.id === decision.baseline ? "baseline (the floor)" : c.id === decision.winner ? "winner" : versus ? standing(versus) : "—";
            return (
              <tr key={c.id} className={c.id === decision.winner ? "picked" : undefined}>
                <td className="mono">{c.id}</td>
                <td className="num mono">{formatMetric(c.mean)} ± {formatMetric(c.spread)}</td>
                <td className="num mono">
                  {versus ? `${versus.mean_difference >= 0 ? "+" : "−"}${formatMetric(Math.abs(versus.mean_difference))} ± ${formatMetric(versus.corrected_se)}` : "—"}
                </td>
                <td>{verdict}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p>{decision.reason}</p>
      {decision.limitations.length > 0 && (
        <div className="cautions">
          {decision.limitations.map((l) => (
            <p key={l}>⚠ {l}</p>
          ))}
        </div>
      )}
      {decision.winner && (
        <div className="settings-actions">
          <span className="spacer" />
          <button
            type="button"
            className="run-code"
            disabled={apply.isPending}
            onClick={() =>
              decision.winner &&
              apply.mutate(
                { proposalId: proposal.id, alternativeId: decision.winner, reason },
                { onSuccess: (applied) => selectPipelineVersion(applied.pipeline.id) },
              )
            }
          >
            {apply.isPending ? "Applying…" : `Apply ${decision.winner}`}
          </button>
        </div>
      )}
      {apply.isError && <p role="alert" className="error">{apply.error.message}</p>}
    </>
  );
}

/** Where a candidate stands against the baseline: one corrected SE is a screening bar, not a test. */
function standing(versus: NonNullable<SelectionDecision["candidates"][number]["versus_baseline"]>): string {
  if (versus.beats_baseline) return "clears the 1-SE bar";
  if (versus.mean_difference < -versus.corrected_se) return "worse than baseline";
  return "within 1 SE of baseline";
}
