import { useState } from "react";
import type { PipelineVersion, Run } from "@sprisk/contracts";

import { Button } from "../components/ui/Button.tsx";
import { InfoDock } from "../components/ui/InfoDock.tsx";
import { ListRow } from "../components/ui/ListRow.tsx";
import { Loading } from "../components/ui/Loading.tsx";
import { PageFrame } from "../components/ui/PageFrame.tsx";
import { SearchField } from "../components/ui/SearchField.tsx";
import { SideGroup } from "../components/ui/SideGroup.tsx";
import { BodySection } from "../components/ui/RowList.tsx";
import { stepLabel } from "../flow/stages.ts";
import { Sidebar } from "../components/ui/Sidebar.tsx";
import { useOperatorsByRef, usePipelineVersions, useRunAttempts } from "../api/hooks.ts";
import { type NodeInRun, useFlowRuns, useRunNodes } from "../api/runs.ts";
import { settingChanges, showValue } from "../flow/diff.ts";
import { flows } from "../flow/flows.ts";
import { flowName } from "../flow/labels.ts";
import { EXPERIMENTS_TABS, type ExperimentsTab, useSelection } from "../workbench/selection.ts";
import { useStudies } from "../api/studies.ts";
import { ModelComparisons } from "./ModelComparison.tsx";
import { RunComparison } from "./experiments/CompareTab.tsx";
import { ModelVersus, useLatestSelection } from "./experiments/ModelVersus.tsx";
import { defaultVersus, foldsWon } from "./experiments/versus.ts";
import { Studies } from "./Studies.tsx";
import { formatMetric } from "./NodeFact.tsx";
import { ExperimentsIcon } from "./Icons.tsx";
import { when } from "./when.ts";

/** Runs shown in the table. Each costs a few cached reads per evaluator. */
const MAX_RUNS = 20;
const HEADLINE = ["accuracy", "r2", "rmse", "mae"];

/** Every run of the current flow: one run's steps, two runs compared, and the flow's studies. */
export function Experiments() {
  const { pipelineVersionId, runId, compare, setCompare, setNav, showRun, experimentsTab, setExperimentsTab } = useSelection();
  const versions = usePipelineVersions();
  const operators = useOperatorsByRef();
  const all = versions.data ?? [];
  const flow = flows(all).find((f) => pipelineVersionId !== undefined && f.ids.includes(pipelineVersionId));
  const runs = useFlowRuns(flow?.ids ?? [], MAX_RUNS);
  const byId = new Map(all.map((v) => [v.id, v]));
  const evaluators = [
    ...new Set(
      (flow ? flow.ids : [])
        .flatMap((id) => byId.get(id)?.nodes ?? [])
        .filter((n) => operators.data?.get(n.operator)?.capability_class === "evaluator")
        .map((n) => n.id),
    ),
  ].sort();
  const nodes = useRunNodes(runs, evaluators);
  const [search, setSearch] = useState("");
  const [swapped, setSwapped] = useState(false);
  const studies = useStudies(flow?.head.id);
  const selection = useLatestSelection(flow?.ids ?? [], all, new Set((studies.data ?? []).map((s) => s.comparison_id)));
  const [versus, setVersus] = useState<[string, string]>();

  if (versions.isError) return <p role="alert" className="error pad">{versions.error.message}</p>;
  if (!flow) {
    return (
      <PageFrame header={{ eyebrow: "Experiments", title: "No flow selected", description: "Open a flow to see its runs, compare them and follow its studies." }}>
        <div className="empty-state">
          <ExperimentsIcon size={28} />
          <Button variant="primary" onClick={() => setNav("Flow")}>
            Open Flow
          </Button>
        </div>
      </PageFrame>
    );
  }

  const label = (run: Run) => `#${runs.length - runs.indexOf(run)}`;
  const latestStudy = studies.data?.[0];
  const shown = runs.find((r) => r.id === runId) ?? runs[0];
  const shownAt = shown ? runs.indexOf(shown) : -1;
  const picked = compare.filter((id) => runs.some((r) => r.id === id));
  const pair = (picked.length === 2 ? picked : runs.slice(0, 2).map((r) => r.id)).map((id) => runs.findIndex((r) => r.id === id));
  // Older run first, so changes read "before → after"; Swap reads them the other way.
  const [olderAt, newerAt] = [...pair].sort((a, b) => b - a) as [number, number];
  const [firstAt, secondAt] = swapped ? [newerAt, olderAt] : [olderAt, newerAt];
  const models = selection ? (versus ?? defaultVersus(selection.decision)) : undefined;
  const pairWon = selection && models ? foldsWon(selection.decision, models[0], models[1]) : undefined;
  const toggle = (id: string) =>
    setCompare(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id].slice(-2));
  const header =
    experimentsTab === "Monitor"
      ? {
          eyebrow: shown ? `Run ${label(shown)} · ${flowName(flow.head)} · started ${when(shown.created_at)}` : flowName(flow.head),
          title: shown ? sentence(shown.status) : "No runs yet",
          description: shown ? whatChanged(shown, byId) : "Run the flow to see each step here.",
        }
      : experimentsTab === "Compare" && models && pairWon
        ? {
            eyebrow: `Compare · ${flowName(flow.head)} · model selection`,
            title: `${models[0]} vs ${models[1]}`,
            description: `Same ${pairWon.folds} folds of the train rows. ${models[0]} scored better on ${pairWon.a}, ${models[1]} on ${pairWon.b}.`,
          }
        : experimentsTab === "Compare"
        ? {
            eyebrow: `Compare · ${flowName(flow.head)}`,
            title: runs.length < 2 ? "Compare runs" : `Run ${label(runs[firstAt]!)} vs run ${label(runs[secondAt]!)}`,
            description: runs.length < 2 ? "Run the flow twice to compare two runs." : compareLine(runs[firstAt]!, runs[secondAt]!, byId),
          }
        : {
            eyebrow: latestStudy ? `Sweep · ${latestStudy.node_id} · up to ${latestStudy.max_trials} trials` : `Sweep · ${flowName(flow.head)}`,
            title: "Hyperparameter search",
            description: latestStudy ? "Each study searches a model's settings within a budget, then recommends one. The bright line is the best so far." : "No study yet. Start one to search a model's settings within a budget.",
          };

  return (
    <PageFrame
      sidebar={
        <Sidebar
          title="Runs"
          search={<SearchField value={search} onChange={setSearch} placeholder="Search runs" />}
          dock={shown && <RunDock run={shown} label={label(shown)} metrics={nodes[shownAt]} before={runs[shownAt + 1]} beforeMetrics={nodes[shownAt + 1]} beforeLabel={runs[shownAt + 1] && label(runs[shownAt + 1]!)} />}
        >
          <SideGroup num={1} label="Runs" meta={runs.length}>
          {runs.length === 0 && <p className="muted pad">No runs yet.</p>}
          {runs
            .filter((run) => `run ${label(run)} ${whatChanged(run, byId)}`.toLowerCase().includes(search.trim().toLowerCase()))
            .map((run) => (
              <ListRow
                key={run.id}
                title={`Run ${label(run)}`}
                meta={`${when(run.created_at)} · ${whatChanged(run, byId)}`}
                {...(run.status === "failed" ? { badge: "Issue", warn: true } : run.status === "running" ? { badge: "Running" } : run.status === "queued" ? { badge: "Queued" } : {})}
                selected={run.id === shown?.id}
                onClick={() => showRun(run.pipeline_version_id, run.id)}
              />
            ))}
          </SideGroup>
          {(studies.data ?? []).length > 0 && (
            <SideGroup num={2} label="Sweeps" meta={studies.data!.length}>
              {studies.data!.map((study) => (
                <ListRow
                  key={study.id}
                  title={`Study of ${study.node_id}`}
                  meta={`up to ${study.max_trials} trials`}
                  {...(study.status === "running" ? { badge: "Running" } : study.status === "failed" ? { badge: "Issue", warn: true } : {})}
                  onClick={() => setExperimentsTab("Sweep")}
                />
              ))}
            </SideGroup>
          )}
        </Sidebar>
      }
      header={{
        ...header,
        ...(experimentsTab === "Compare" && models
          ? { actions: <Button onClick={() => setVersus([models[1], models[0]])}>Swap</Button> }
          : experimentsTab === "Compare" && runs.length >= 2
            ? { actions: <Button onClick={() => setSwapped(!swapped)}>Swap</Button> }
            : {}),
        ...(experimentsTab === "Monitor" && shown
          ? {
              actions: (
                <Button variant="primary" onClick={() => { showRun(shown.pipeline_version_id, shown.id); setNav("Flow"); }}>
                  Open in flow
                </Button>
              ),
            }
          : {}),
      }}
      tabs={{ label: "Experiments", items: EXPERIMENTS_TABS.map((t) => ({ value: t, label: t })), value: experimentsTab, onChange: (t) => setExperimentsTab(t as ExperimentsTab) }}
    >
      {experimentsTab === "Monitor" && shown && <Monitor run={shown} version={byId.get(shown.pipeline_version_id)} />}
      {experimentsTab === "Compare" && (
        <div className="exp-body">
          {selection && models ? (
            <>
              <div className="exp-pickers" role="group" aria-label="Models to compare">
                {(["A", "B"] as const).map((side, i) => (
                  <label key={side}>
                    <span>{`Model ${side}`}</span>
                    <select value={models[i]} onChange={(e) => setVersus(i === 0 ? [e.target.value, models[1]] : [models[0], e.target.value])}>
                      {selection.decision.candidates.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.id}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <ModelVersus decision={selection.decision} attempts={selection.attempts} proposal={selection.proposal} a={models[0]} b={models[1]} />
            </>
          ) : runs.length < 2 ? (
            <p className="muted">Run the flow again, or change a setting and run it, to compare two runs.</p>
          ) : (
            <RunComparison
              older={runs[firstAt]!}
              newer={runs[secondAt]!}
              olderNodes={nodes[firstAt] ?? {}}
              newerNodes={nodes[secondAt] ?? {}}
              byId={byId}
              evaluators={evaluators}
              labelOf={label}
            />
          )}
          <BodySection title="Runs" note="Every run of this flow. Tick two runs to compare their scores and settings.">
            <RunTable runs={runs} nodes={nodes} evaluators={evaluators} byId={byId} picked={pair.map((i) => runs[i]?.id ?? "")} toggle={toggle} />
          </BodySection>
          {/* Wait for the studies, so a study's comparison is never shown first as a plain one. */}
          {!studies.isPending && (
            <BodySection title="All candidates" note="Every shortlisted model, cross-validated on the train rows, with the choice to use one.">
              <ModelComparisons flowIds={flow.ids} head={flow.head} versions={all} studied={new Set((studies.data ?? []).map((s) => s.comparison_id))} />
            </BodySection>
          )}
        </div>
      )}
      {experimentsTab === "Sweep" && (
        <>
          {studies.isError && <p role="alert" className="error pad">The flow's studies cannot be shown: {studies.error.message}</p>}
          {!studies.isPending && <Studies head={flow.head} versions={all} studies={studies.data ?? []} />}
        </>
      )}
    </PageFrame>
  );
}

const sentence = (status: string) => status[0]!.toUpperCase() + status.slice(1).replaceAll("_", " ");

/** The two runs in one line: how many settings differ and how the headline metric moved. */
function compareLine(a: Run, b: Run, byId: Map<string, PipelineVersion>): string {
  const va = byId.get(a.pipeline_version_id);
  const vb = byId.get(b.pipeline_version_id);
  const n = va && vb ? settingChanges(va, vb).length : 0;
  return n === 0 ? "Same settings; only the run differs." : `${n} ${n === 1 ? "setting differs" : "settings differ"} between the two runs.`;
}

/** What the run's version changed from its parent, in a few words. */
function whatChanged(run: Run, byId: Map<string, PipelineVersion>): string {
  const version = byId.get(run.pipeline_version_id);
  const parent = version?.parent_id ? byId.get(version.parent_id) : undefined;
  const changes = version && parent ? settingChanges(parent, version) : [];
  if (changes.length === 0) return parent ? "re-run" : "first version";
  return `${describe(changes[0]!)}${changes.length > 1 ? ` +${changes.length - 1}` : ""}`;
}

/** The run's steps in flow order, each with its latest attempt's state; a failed step says why. */
function Monitor({ run, version }: { run: Run; version: PipelineVersion | undefined }) {
  const attempts = useRunAttempts(run.pipeline_version_id, run.id);
  const operators = useOperatorsByRef();
  if (attempts.isError) return <p role="alert" className="error pad">{attempts.error.message}</p>;
  if (attempts.isPending) return <Loading text="Loading the run's steps…" pad />;
  const latest = (node: string) => attempts.data.filter((a) => a.node_id === node).sort((a, b) => b.number - a.number)[0];
  const steps = (version?.nodes ?? []).map((n) => ({ id: n.id, title: stepLabel(n, operators.data?.get(n.operator)).title, attempt: latest(n.id) }));
  const failed = steps.filter((s) => s.attempt?.state === "failed");
  const done = steps.filter((s) => s.attempt !== undefined && FINISHED.has(s.attempt.state)).length;
  return (
    <div className="exp-monitor">
      <div className="exp-progress">
        <span className="exp-progress-bar" aria-hidden="true">
          <span style={{ width: `${steps.length === 0 ? 0 : (done / steps.length) * 100}%` }} />
        </span>
        <span>
          {done} of {steps.length} steps
        </span>
      </div>
      {failed.map((s) => (
        <p key={s.id} role="alert" className="exp-failure">
          {s.id} failed: {s.attempt?.error?.message ?? "no message"}
        </p>
      ))}
      <BodySection title="Steps">
        <ul className="exp-steps" aria-label="Steps">
          {steps.map((s) => {
            const state = s.attempt?.state;
            const tone = state === "failed" ? "failed" : state === "running" || state === "leased" ? "running" : state && FINISHED.has(state) ? "done" : "waiting";
            return (
              <li key={s.id} className={tone}>
                <span className="exp-step-name">
                  {s.title} <span className="exp-step-subject">{s.id}</span>
                </span>
                <span className="exp-step-state">
                  <span className="exp-step-dot" aria-hidden="true" />
                  {state ? state.replaceAll("_", " ") : "not started"}
                </span>
                <span className="exp-step-bar" aria-hidden="true">
                  <span />
                </span>
              </li>
            );
          })}
        </ul>
      </BodySection>
    </div>
  );
}

/** Attempt states after which a step has its outputs. */
const FINISHED = new Set(["succeeded", "cache_hit"]);

/** The shown run's headline metric, and how far it moved from the run before. */
function RunDock({ run, label, metrics, before, beforeMetrics, beforeLabel }: {
  run: Run;
  label: string;
  metrics: Record<string, NodeInRun> | undefined;
  before: Run | undefined;
  beforeMetrics: Record<string, NodeInRun> | undefined;
  beforeLabel: string | undefined;
}) {
  const now = firstHeadline(metrics);
  const then = now && before ? firstHeadline(beforeMetrics, now.name) : undefined;
  const rows: { k: string; v: string }[] = [{ k: "Run", v: label }, { k: "Status", v: run.status }];
  if (now) rows.push({ k: now.name, v: formatMetric(now.value) });
  if (now && then && beforeLabel) {
    const delta = now.value - then.value;
    rows.push({ k: "Change", v: `${delta < 0 ? "−" : "+"}${formatMetric(Math.abs(delta))} from run ${beforeLabel}` });
  }
  return <InfoDock rows={rows} />;
}

/** The first evaluator's headline metric, or the one named. */
function firstHeadline(nodes: Record<string, NodeInRun> | undefined, name?: string) {
  for (const node of Object.values(nodes ?? {})) {
    const found = name ? (node.metrics?.[name] !== undefined ? { name, value: node.metrics[name]! } : undefined) : headlineOf(node.metrics);
    if (found) return found;
  }
  return undefined;
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
