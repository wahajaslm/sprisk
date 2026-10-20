import type { LoadedTable, PipelineVersion } from "@sprisk/contracts";
import { useState } from "react";

import { useLoadedTables } from "../../api/datasets.ts";
import { usePipelineVersions } from "../../api/hooks.ts";
import { flows } from "../../flow/flows.ts";
import { flowName } from "../../flow/labels.ts";
import { shortName } from "../../flow/stages.ts";
import { Loading } from "../../components/ui/Loading.tsx";
import { useSelection } from "../../workbench/selection.ts";
import { DatasetDetail } from "./DatasetDetail.tsx";

/** Every table the flows load, and a profile of the one picked (ADR-0038). */
export function DatasetsPage() {
  const datasets = useLoadedTables();
  const versions = usePipelineVersions();
  const showRun = useSelection((s) => s.showRun);
  const setNav = useSelection((s) => s.setNav);
  const [filter, setFilter] = useState("");
  const [picked, setPicked] = useState<string>();
  if (datasets.isError) return <p role="alert" className="error pad">{datasets.error.message}</p>;
  if (datasets.isPending) return <Loading text="Loading datasets…" pad />;
  const list = datasets.data;
  const shown = list.filter((d) => d.name.toLowerCase().includes(filter.trim().toLowerCase()));
  const current = shown.find((d) => d.artifact.id === picked) ?? shown[0];
  const usedBy = (d: LoadedTable) => uses(d, versions.data ?? []);
  const first = current?.used_by[0];

  return (
    <main className="dsx">
      <aside className="dsx-side" aria-label="Datasets">
        <header className="dsx-side-head">
          <p className="eyebrow">Datasets · {list.length === 1 ? "1 table" : `${list.length} tables`}</p>
          <input type="search" className="ds-filter" aria-label="Filter datasets" placeholder="Filter datasets" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </header>
        {list.length === 0 ? (
          <p className="muted pad">No datasets yet. Run a flow that loads a file to see it here.</p>
        ) : (
          <ul className="dsx-list" aria-label="Dataset list">
            {shown.map((d) => (
              <li key={d.artifact.id}>
                <button type="button" className={`dsx-item${d === current ? " picked" : ""}`} aria-pressed={d === current} onClick={() => setPicked(d.artifact.id)}>
                  <span className="dsx-item-name">{d.name}</span>
                  <span className="dsx-item-meta">
                    {d.total_rows.toLocaleString()} rows · {d.total_columns} cols
                  </span>
                  <span className="dsx-item-meta">{shortName(d.operator)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {current && (
          <div className="dsx-side-meta-panel" aria-label={`Metadata for ${current.name}`}>
            <div className="dsx-side-meta-head">
              <span className="dsx-side-meta-title">{current.name}</span>
              <span className="dsx-side-meta-op">Loaded by {shortName(current.operator)}</span>
            </div>
            <dl className="dsx-side-meta-list">
              <div>
                <dt>Rows</dt>
                <dd>{current.total_rows.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Columns</dt>
                <dd>{current.total_columns}</dd>
              </div>
              <div>
                <dt>Used by</dt>
                <dd className="dsx-used">{usedBy(current).join(", ") || "—"}</dd>
              </div>
            </dl>
            {first && (
              <button
                type="button"
                className="page-btn ds-open-btn"
                aria-label={`Open ${current.name} in Flow`}
                onClick={() => {
                  showRun(first.pipeline_version_id, first.run_id, first.node_id);
                  setNav("Flow");
                }}
              >
                Open in Flow
              </button>
            )}
          </div>
        )}
      </aside>
      <div className="dsx-main">{current && <DatasetDetail key={current.artifact.id} dataset={current} usedBy={usedBy(current)} />}</div>
    </main>
  );
}

/** "iris.csv · load" for each flow and step that loads the table, once each. */
function uses(dataset: LoadedTable, versions: PipelineVersion[]): string[] {
  const all = flows(versions);
  const named = dataset.used_by.map((u) => {
    const flow = all.find((f) => f.ids.includes(u.pipeline_version_id));
    return flow ? `${flowName(flow.head)} · ${u.node_id}` : u.node_id;
  });
  return [...new Set(named)];
}
