import type { PipelineVersion, Run } from "@sprisk/contracts";

import { PageHeader } from "../components/ui/PageHeader.tsx";
import { Button } from "../components/ui/Button.tsx";
import { useOperators, usePipelineVersions } from "../api/hooks.ts";
import { type NodeInRun, useFlowRuns, useRunNodes } from "../api/runs.ts";
import { settingChanges, showValue } from "../flow/diff.ts";
import { flows } from "../flow/flows.ts";
import { flowName } from "../flow/labels.ts";
import { useSelection } from "../workbench/selection.ts";
import { useStudies } from "../api/studies.ts";
import { ModelComparisons } from "./ModelComparison.tsx";
import { Studies } from "./Studies.tsx";
import { formatMetric } from "./NodeFact.tsx";
import { ExperimentsIcon } from "./Icons.tsx";

/** Runs shown in the table. Each costs a few cached reads per evaluator. */
const MAX_RUNS = 20;
const HEADLINE = ["accuracy", "r2", "rmse", "mae"];

/** Every run of the current flow, with what changed and how it scored; two runs compared. */
export function Experiments() {
  const { pipelineVersionId, compare, setCompare, setNav } = useSelection();
  const versions = usePipelineVersions();
  const operators = useOperators();
  const all = versions.data ?? [];
  const flow = flows(all).find((f) => pipelineVersionId !== undefined && f.ids.includes(pipelineVersionId));
  const runs = useFlowRuns(flow?.ids ?? [], MAX_RUNS);
  const byId = new Map(all.map((v) => [v.id, v]));
  const evaluators = [
    ...new Set(
      (flow ? flow.ids : [])
        .flatMap((id) => byId.get(id)?.nodes ?? [])
        .filter((n) => operators.data?.find((o) => o.id === n.operator)?.capability_class === "evaluator")
        .map((n) => n.id),
    ),
  ].sort();
  const nodes = useRunNodes(runs, evaluators);
  const studies = useStudies(flow?.head.id);

  if (versions.isError) return <p role="alert" className="error pad">{versions.error.message}</p>;
  if (!flow) {
    return (
      <div className="single-panel-layout experiments-page-layout">
        <main className="center-screen experiments-main experiments">
          <PageHeader eyebrow="Flow Experiments" title="Experiments & Model Tracking" description="Systematic comparison of pipeline versions, evaluation metrics, and studies." />
          <div className="experiments-empty-viewport">
            <div className="experiments-empty-card">
              <div className="experiments-empty-icon">
                <ExperimentsIcon size={28} />
              </div>
              <h3 className="experiments-empty-title">No Flow Selected</h3>
              <p className="experiments-empty-sub">
                Select or open a pipeline flow in Flow Studio to track training runs, compare metric deltas, and analyze model studies.
              </p>
              <Button variant="primary" onClick={() => setNav("Flow")}>
                Open Flow Studio
              </Button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  const picked = compare.filter((id) => runs.some((r) => r.id === id));
  const pair = (picked.length === 2 ? picked : runs.slice(0, 2).map((r) => r.id)).map((id) => runs.findIndex((r) => r.id === id));
  // Older run first, so changes read "before → after".
  const [olderAt, newerAt] = [...pair].sort((a, b) => b - a) as [number, number];
  const toggle = (id: string) =>
    setCompare(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id].slice(-2));

  return (
    <div className="single-panel-layout experiments-page-layout">
      <main className="center-screen experiments-main experiments">
        <PageHeader
          eyebrow={runs.length === 1 ? "1 run" : `${runs.length} runs`}
          title={`${flowName(flow.head)}: every run, with what changed`}
        />
        <div className="exp-scroll">
          {studies.isError && <p role="alert" className="error pad">The flow's studies cannot be shown: {studies.error.message}</p>}
          {/* Wait for the studies, so a study's comparison is never shown first as a plain one. */}
          {!studies.isPending && (
            <>
              <Studies head={flow.head} versions={all} studies={studies.data ?? []} />
              <ModelComparisons flowIds={flow.ids} head={flow.head} versions={all} studied={new Set((studies.data ?? []).map((s) => s.comparison_id))} />
            </>
          )}
          <RunTable runs={runs} nodes={nodes} evaluators={evaluators} byId={byId} picked={pair.map((i) => runs[i]?.id ?? "")} toggle={toggle} />
        </div>
        {runs.length < 2 ? (
          <p className="muted pad">Run the flow again, or change a setting and run it, to compare two runs.</p>
        ) : (
          <Compare
            older={runs[olderAt]}
            newer={runs[newerAt]}
            olderNodes={nodes[olderAt] ?? {}}
            newerNodes={nodes[newerAt] ?? {}}
            byId={byId}
            evaluators={evaluators}
            labelOf={(run) => `#${runs.length - runs.indexOf(run)}`}
          />
        )}
      </main>
    </div>
  );
}

type TableProps = {
  runs: Run[];
  nodes: Record<string, NodeInRun>[];
  evaluators: string[];
  byId: Map<string, PipelineVersion>;
  picked: string[];
  toggle: (id: string) => void;
};

function RunTable({ runs, nodes, evaluators, byId, picked, toggle }: TableProps) {
  const { selectPipelineVersion, selectRun, setNav } = useSelection();
  return (
    <table className="exp-table" aria-label="Runs">
      <thead>
        <tr>
          <th scope="col"><span className="sr-only">Compare</span></th>
          <th scope="col">Run</th>
          <th scope="col">Started</th>
          <th scope="col">What changed</th>
          <th scope="col">Status</th>
          {evaluators.map((e) => (
            <th key={e} scope="col" className="num">{e}</th>
          ))}
          <th scope="col"><span className="sr-only">Open</span></th>
        </tr>
      </thead>
      <tbody>
        {runs.map((run, i) => {
          const version = byId.get(run.pipeline_version_id);
          const parent = version?.parent_id ? byId.get(version.parent_id) : undefined;
          const changes = version && parent ? settingChanges(parent, version) : [];
          const label = `#${runs.length - i}`;
          return (
            <tr key={run.id} className={picked.includes(run.id) ? "picked" : undefined}>
              <td>
                <input type="checkbox" aria-label={`Compare run ${label}`} checked={picked.includes(run.id)} onChange={() => toggle(run.id)} />
              </td>
              <td className="mono">{label}</td>
              <td className="mono muted">{when(run.created_at)}</td>
              <td className="changed">
                {changes.length === 0
                  ? <span className="muted">{parent ? "re-run" : "first version"}</span>
                  : `${describe(changes[0]!)}${changes.length > 1 ? ` +${changes.length - 1}` : ""}`}
              </td>
              <td className={`mono status-${run.status}`}>{run.status}</td>
              {evaluators.map((e) => (
                <td key={e} className="num">
                  <MetricCell metrics={nodes[i]?.[e]?.metrics} />
                </td>
              ))}
              <td>
                <button
                  type="button"
                  className="page-btn"
                  aria-label="Open in Flow"
                  onClick={() => {
                    selectPipelineVersion(run.pipeline_version_id);
                    selectRun(run.id);
                    setNav("Flow");
                  }}
                >
                  Open
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

const describe = (c: { node: string; key: string; before: unknown; after: unknown }) =>
  c.key === "step"
    ? `${c.after ? "added" : "removed"} ${c.node}`
    : c.key === "source"
      ? `${c.node}: code edited`
      : `${c.node} ${c.key} ${showValue(c.before)} → ${showValue(c.after)}`;

function headlineOf(metrics: Record<string, number> | undefined) {
  const name = HEADLINE.find((m) => metrics?.[m] !== undefined);
  return name && metrics ? { name, value: metrics[name]! } : undefined;
}

/** A dotted bar, like Studio's, plus the value. Bars are on a 0–1 scale for scores. */
function MetricCell({ metrics }: { metrics: Record<string, number> | undefined }) {
  const headline = headlineOf(metrics);
  if (!headline) return <span className="muted">—</span>;
  const share = headline.name === "accuracy" || headline.name === "r2" ? Math.max(0, Math.min(1, headline.value)) : undefined;
  return (
    <span className="metric-cell" title={headline.name}>
      {share !== undefined && (
        <span className="dots" aria-hidden="true">
          <span style={{ width: `${share * 100}%` }} />
        </span>
      )}
      {formatMetric(headline.value)}
    </span>
  );
}

type CompareProps = {
  older: Run | undefined;
  newer: Run | undefined;
  olderNodes: Record<string, NodeInRun>;
  newerNodes: Record<string, NodeInRun>;
  byId: Map<string, PipelineVersion>;
  evaluators: string[];
  labelOf: (run: Run) => string;
};

function Compare({ older, newer, olderNodes, newerNodes, byId, evaluators, labelOf }: CompareProps) {
  if (!older || !newer) return null;
  const a = byId.get(older.pipeline_version_id);
  const b = byId.get(newer.pipeline_version_id);
  const changes = a && b ? settingChanges(a, b) : [];
  return (
    <section className="compare" aria-label="Compare runs">
      <section className="compare-col" aria-label="Settings that differ">
        <p className="eyebrow">Settings that differ</p>
        <div className="compare-grid">
          <span />
          <span className="compare-run">{labelOf(older)}</span>
          <span className="compare-run">{labelOf(newer)}</span>
          {changes.length === 0 ? (
            <span className="muted compare-none">Same settings. Only the run differs.</span>
          ) : (
            changes.map((c) => (
              <div key={`${c.node}.${c.key}`} className="compare-row">
                <span>{c.key === "step" ? c.node : `${c.node} · ${c.key}`}</span>
                <span className="mono">{c.key === "step" ? (c.before ? "present" : "—") : showValue(c.before)}</span>
                <span className="mono changed-value">{c.key === "step" ? (c.after ? "present" : "—") : showValue(c.after)}</span>
              </div>
            ))
          )}
        </div>
      </section>
      <section className="compare-col" aria-label="Metrics">
        <p className="eyebrow">Metrics · held-out data</p>
        <Cautions changes={changes} byId={byId} older={older} olderNodes={olderNodes} newerNodes={newerNodes} evaluators={evaluators} />
        <div className="compare-metrics head">
          <span />
          <span className="compare-run">{labelOf(older)}</span>
          <span className="compare-run">{labelOf(newer)}</span>
          <span className="compare-run">change</span>
        </div>
        {evaluators.map((e) => {
          const before = olderNodes[e]?.metrics ?? {};
          const after = newerNodes[e]?.metrics ?? {};
          const names = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((n) => n !== "n_rows");
          return (
            <div key={e} className="compare-metrics">
              <p className="compare-node">{e}</p>
              {names.map((n) => {
                const x = before[n];
                const y = after[n];
                const delta = x !== undefined && y !== undefined ? y - x : undefined;
                return (
                  <div key={n} className="compare-row metric">
                    <span>{n.replaceAll("_", " ")}</span>
                    <span className="mono">{x === undefined ? "—" : formatMetric(x)}</span>
                    <span className="mono">{y === undefined ? "—" : formatMetric(y)}</span>
                    <span className="mono muted">
                      {delta === undefined || delta === 0 ? "" : `${delta > 0 ? "▲" : "▼"} ${formatMetric(Math.abs(delta))}`}
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </section>
    </section>
  );
}

function when(timestamp: string): string {
  const d = new Date(timestamp);
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} · ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
}

/** Why two metrics may not be comparable: different test rows, or too few of them. */
function Cautions({ changes, byId, older, olderNodes, newerNodes, evaluators }: {
  changes: { node: string }[];
  byId: Map<string, PipelineVersion>;
  older: Run;
  olderNodes: Record<string, NodeInRun>;
  newerNodes: Record<string, NodeInRun>;
  evaluators: string[];
}) {
  const nodes = byId.get(older.pipeline_version_id)?.nodes ?? [];
  const splitChanged = changes.some((c) => nodes.find((n) => n.id === c.node)?.operator.includes(".validation."));
  const rows = evaluators
    .flatMap((e) => [olderNodes[e]?.metrics?.n_rows, newerNodes[e]?.metrics?.n_rows])
    .filter((n): n is number => n !== undefined && n > 0);
  const fewest = rows.length > 0 ? Math.min(...rows) : undefined;
  if (!splitChanged && (fewest === undefined || fewest >= 200)) return null;
  return (
    <div className="cautions">
      {splitChanged && (
        <p>⚠ The split changed, so the two runs were scored on different test rows. Their metrics are not a like-for-like comparison.</p>
      )}
      {fewest !== undefined && fewest < 200 && (
        <p>
          Scored on {fewest} rows. One test row moves accuracy by about {formatMetric(1 / fewest)}, so small changes may be noise.
        </p>
      )}
    </div>
  );
}
