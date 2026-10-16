import { useRuns } from "../api/hooks.ts";
import { useSelection } from "../workbench/selection.ts";
import { Loading } from "../components/ui/Loading.tsx";

/** Runs of the selected flow, newest first (the API pages and caps this list). */
export function RunsList() {
  const { pipelineVersionId, runId, selectRun } = useSelection();
  const runs = useRuns(pipelineVersionId);
  return (
    <div className="sidebar-panel">
      <p className="sidebar-title">Runs</p>
      <div className="sidebar-list">
        {pipelineVersionId === undefined && <p className="muted">Select a flow first.</p>}
        {runs.isPending && pipelineVersionId !== undefined && <Loading />}
        {runs.isError && <p role="alert" className="error">{runs.error.message}</p>}
        {runs.isSuccess && runs.data.length === 0 && <p className="muted">This flow has not run yet.</p>}
        {runs.data?.map((run) => (
          <button
            key={run.id}
            type="button"
            className="list-row"
            aria-current={run.id === runId ? "true" : undefined}
            onClick={() => selectRun(run.id)}
          >
            <span className={`dot status-${run.status}`} aria-hidden="true" />
            <span className="row-main">
              <span className="row-title mono">{run.id.slice(-8)}</span>
              <span className="row-meta">{run.created_at.replace("T", " ").replace("Z", "")}</span>
            </span>
            <span className={`row-state status-${run.status}`}>{run.status}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
