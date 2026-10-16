import { useRuns } from "../api/hooks.ts";
import { useSelection } from "../workbench/selection.ts";
import { ListRow } from "../components/ui/ListRow.tsx";
import { QueryState } from "../components/ui/QueryState.tsx";

/** Runs of the selected flow, newest first (the API pages and caps this list). */
export function RunsList() {
  const { pipelineVersionId, runId, selectRun } = useSelection();
  const runs = useRuns(pipelineVersionId);
  return (
    <div className="sidebar-panel">
      <p className="sidebar-title">Runs</p>
      <div className="sidebar-list">
        {pipelineVersionId === undefined ? (
          <p className="muted">Select a flow first.</p>
        ) : (
          <QueryState query={runs} empty="This flow has not run yet.">
            {(list) =>
              list.map((run) => (
                <ListRow
                  key={run.id}
                  title={run.id.slice(-8)}
                  mono
                  meta={run.created_at.replace("T", " ").replace("Z", "")}
                  mark={<span className={`dot status-${run.status}`} aria-hidden="true" />}
                  state={<span className={`row-state status-${run.status}`}>{run.status}</span>}
                  current={run.id === runId}
                  onClick={() => selectRun(run.id)}
                />
              ))
            }
          </QueryState>
        )}
      </div>
    </div>
  );
}
