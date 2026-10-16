import { useEffect } from "react";

import { usePipelineVersions, useRuns, useStartRun } from "../api/hooks.ts";
import { NAV, useSelection } from "../workbench/selection.ts";

export function TopBar() {
  const { nav, setNav, pipelineVersionId, selectPipelineVersion, selectRun } = useSelection();
  const versions = usePipelineVersions();
  const runs = useRuns(pipelineVersionId);
  const startRun = useStartRun();

  // Open the newest pipeline version and its newest run by default.
  useEffect(() => {
    const newest = versions.data?.[0];
    if (pipelineVersionId === undefined && newest) selectPipelineVersion(newest.id);
  }, [versions.data, pipelineVersionId, selectPipelineVersion]);
  const latestRun = runs.data?.[0];
  useEffect(() => {
    if (latestRun) selectRun(latestRun.id);
  }, [latestRun, selectRun]);

  const runState = startRun.isPending
    ? "Starting run…"
    : latestRun === undefined
      ? "Not run yet"
      : latestRun.status === "succeeded"
        ? "Graph up to date"
        : `Run ${latestRun.status}`;

  return (
    <header className="topbar" role="banner">
      <select
        className="switcher"
        aria-label="Project and flow"
        value={pipelineVersionId ?? ""}
        onChange={(e) => selectPipelineVersion(e.target.value)}
      >
        {versions.isPending && <option value="">Loading…</option>}
        {versions.data?.length === 0 && <option value="">No pipelines yet</option>}
        {versions.data?.map((v) => (
          <option key={v.id} value={v.id}>
            Local project / {v.nodes.map((n) => n.id).slice(0, 3).join(" → ")}
            {v.nodes.length > 3 ? " …" : ""}
          </option>
        ))}
      </select>
      <nav className="nav">
        {NAV.map((item) => (
          <button key={item} type="button" aria-current={nav === item ? "page" : undefined} onClick={() => setNav(item)}>
            {item}
          </button>
        ))}
      </nav>
      <div className="runbar">
        {versions.isError && <span role="alert">{versions.error.message}</span>}
        {startRun.isError && <span role="alert">{startRun.error.message}</span>}
        <span className={`runstate ${latestRun?.status ?? "none"}`}>● {runState}</span>
        <button
          type="button"
          className="primary"
          disabled={pipelineVersionId === undefined || startRun.isPending}
          onClick={() => {
            if (pipelineVersionId) startRun.mutate(pipelineVersionId, { onSuccess: (run) => selectRun(run.id) });
          }}
        >
          ▶ Run graph
        </button>
      </div>
    </header>
  );
}
