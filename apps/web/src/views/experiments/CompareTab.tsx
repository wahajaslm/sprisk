import type { PipelineVersion, Run } from "@sprisk/contracts";


import type { NodeInRun } from "../../api/runs.ts";
import { BodySection } from "../../components/ui/RowList.tsx";
import { settingChanges, showValue } from "../../flow/diff.ts";
import { formatMetric } from "../NodeFact.tsx";
import { canReplace, LOWER_IS_BETTER } from "./runDiff.ts";

export type ComparedRuns = {
  older: Run;
  newer: Run;
  olderNodes: Record<string, NodeInRun>;
  newerNodes: Record<string, NodeInRun>;
  byId: Map<string, PipelineVersion>;
  evaluators: string[];
  labelOf: (run: Run) => string;
};

/** The design's Compare runs window: a reference run and the run picked against it, whether
 * that run can replace the reference, then their metrics and the decisions that differ. */
export function CompareRuns(props: ComparedRuns & { runs: Run[]; onPick: (reference: string, run: string) => void }) {
  const { runs, older, newer, olderNodes, newerNodes, byId, evaluators, labelOf, onPick } = props;
  const a = byId.get(older.pipeline_version_id);
  const b = byId.get(newer.pipeline_version_id);
  const changes = a && b ? settingChanges(a, b) : [];
  const metricsOf = (nodes: Record<string, NodeInRun>) => Object.assign({}, ...evaluators.map((e) => nodes[e]?.metrics ?? {})) as Record<string, number>;
  const verdict = canReplace(metricsOf(olderNodes), metricsOf(newerNodes), splitChanged(older, changes.map((c) => c.node), byId), { reference: labelOf(older), run: labelOf(newer) });
  const picker = (label: string, value: string, set: (id: string) => void) => (
    <label>
      <span>{label}</span>
      <select value={value} onChange={(e) => set(e.target.value)}>
        {runs.map((r) => (
          <option key={r.id} value={r.id}>
            {`Run ${labelOf(r)}`}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <>
      <BodySection title="Compare runs" note="Pick the run to keep as the reference and a run to weigh against it.">
        <div className="exp-pickers" role="group" aria-label="Runs to compare">
          {/* Picking the other side's run swaps the two. */}
          {picker("Reference run", older.id, (id) => onPick(id, id === newer.id ? older.id : newer.id))}
          {picker("Run", newer.id, (id) => onPick(id === older.id ? newer.id : older.id, id))}
        </div>
        <p className={`exp-verdict${verdict.verdict === "replaces" ? "" : verdict.verdict === "same" || verdict.verdict === "no_metrics" ? " muted" : " warn"}`} role="status">
          {verdict.text}
        </p>
      </BodySection>
      <RunComparison {...props} />
    </>
  );
}

/** Two runs side by side, as the design's Compare screen: their metrics with the change, then
 * the decisions (settings) that differ. */
export function RunComparison({ older, newer, olderNodes, newerNodes, byId, evaluators, labelOf }: ComparedRuns) {
  const a = byId.get(older.pipeline_version_id);
  const b = byId.get(newer.pipeline_version_id);
  const changes = a && b ? settingChanges(a, b) : [];
  return (
    <>
      <BodySection title="Metrics" note="Each run scored on its own held-out test rows.">
        {!evaluators.some((e) => olderNodes[e]?.metrics || newerNodes[e]?.metrics) ? (
          <p className="muted">Neither run scored a model on its test rows, so there are no metrics to compare.</p>
        ) : (
        <table className="exp-table exp-compare" aria-label="Metrics">
          <thead>
            <tr>
              <th scope="col">Metric</th>
              <th scope="col" className="num">{`Run ${labelOf(older)}`}</th>
              <th scope="col" className="num">{`Run ${labelOf(newer)}`}</th>
              <th scope="col" className="num">Δ</th>
            </tr>
          </thead>
          <tbody>
            {evaluators.flatMap((e) => {
              const before = olderNodes[e]?.metrics ?? {};
              const after = newerNodes[e]?.metrics ?? {};
              const names = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((n) => n !== "n_rows");
              return names.map((n) => {
                const x = before[n];
                const y = after[n];
                const delta = x !== undefined && y !== undefined ? y - x : undefined;
                const worse = delta !== undefined && delta !== 0 && (LOWER_IS_BETTER.has(n) ? delta > 0 : delta < 0);
                return (
                  <tr key={`${e}.${n}`}>
                    <td>{evaluators.length > 1 ? `${e} · ${words(n)}` : words(n)}</td>
                    <td className="num mono">{x === undefined ? "—" : formatMetric(x)}</td>
                    <td className="num mono">{y === undefined ? "—" : formatMetric(y)}</td>
                    <td className={`num mono${worse ? " worse" : ""}`}>{delta === undefined || delta === 0 ? "0" : `${delta > 0 ? "+" : "−"}${formatMetric(Math.abs(delta))}`}</td>
                  </tr>
                );
              });
            })}
          </tbody>
        </table>
        )}
        <Cautions older={older} olderNodes={olderNodes} newerNodes={newerNodes} byId={byId} evaluators={evaluators} changed={changes.map((c) => c.node)} />
      </BodySection>
      <BodySection title="Decision diff" note="The settings that differ between the two runs' pipeline versions.">
        {changes.length === 0 ? (
          <p className="muted">Same settings. Only the run differs.</p>
        ) : (
          <table className="exp-table exp-compare" aria-label="Decision diff">
            <thead>
              <tr>
                <th scope="col">Decision</th>
                <th scope="col">{`Run ${labelOf(older)}`}</th>
                <th scope="col">{`Run ${labelOf(newer)}`}</th>
              </tr>
            </thead>
            <tbody>
              {changes.map((c) => (
                <tr key={`${c.node}.${c.key}`}>
                  <td>{c.key === "step" ? c.node : `${c.node} · ${c.key}`}</td>
                  <td className="mono">{c.key === "step" ? (c.before ? "present" : "—") : showValue(c.before)}</td>
                  <td className="mono changed-value">{c.key === "step" ? (c.after ? "present" : "—") : showValue(c.after)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </BodySection>
    </>
  );
}

/** Why two metrics may not be comparable: different test rows, or too few of them. */
function Cautions({ older, olderNodes, newerNodes, byId, evaluators, changed }: {
  older: Run;
  olderNodes: Record<string, NodeInRun>;
  newerNodes: Record<string, NodeInRun>;
  byId: Map<string, PipelineVersion>;
  evaluators: string[];
  changed: string[];
}) {
  const split = splitChanged(older, changed, byId);
  const rows = evaluators
    .flatMap((e) => [olderNodes[e]?.metrics?.n_rows, newerNodes[e]?.metrics?.n_rows])
    .filter((n): n is number => n !== undefined && n > 0);
  const fewest = rows.length > 0 ? Math.min(...rows) : undefined;
  if (!split && (fewest === undefined || fewest >= 200)) return null;
  return (
    <ul className="exp-cautions">
      {split && <li className="warn">The split changed, so the two runs were scored on different test rows. Their metrics are not a like-for-like comparison.</li>}
      {fewest !== undefined && fewest < 200 && <li>Scored on {fewest} rows. One test row moves accuracy by about {formatMetric(1 / fewest)}, so small changes may be noise.</li>}
    </ul>
  );
}

/** Whether a changed step is the split: the two runs were then scored on different test rows. */
function splitChanged(older: Run, changed: string[], byId: Map<string, PipelineVersion>): boolean {
  const nodes = byId.get(older.pipeline_version_id)?.nodes ?? [];
  return changed.some((id) => nodes.find((n) => n.id === id)?.operator.includes(".validation."));
}

const words = (metric: string) => metric.replaceAll("_", " ");
