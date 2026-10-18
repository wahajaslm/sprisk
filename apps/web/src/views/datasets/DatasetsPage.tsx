import type { Dataset, PipelineVersion } from "@sprisk/contracts";
import { useState } from "react";

import { useDatasets } from "../../api/datasets.ts";
import { usePipelineVersions } from "../../api/hooks.ts";
import { flows } from "../../flow/flows.ts";
import { flowName } from "../../flow/labels.ts";
import { shortName } from "../../flow/stages.ts";
import { Loading } from "../../components/ui/Loading.tsx";
import { DatasetDetail } from "./DatasetDetail.tsx";

/** Every table the flows load, and a profile of the one picked (ADR-0038). */
export function DatasetsPage() {
  const datasets = useDatasets();
  const versions = usePipelineVersions();
  const [filter, setFilter] = useState("");
  const [picked, setPicked] = useState<string>();
  if (datasets.isError) return <p role="alert" className="error pad">{datasets.error.message}</p>;
  if (datasets.isPending) return <Loading text="Loading datasets…" pad />;
  const list = datasets.data;
  const shown = list.filter((d) => d.name.toLowerCase().includes(filter.trim().toLowerCase()));
  const current = shown.find((d) => d.artifact.id === picked) ?? shown[0];
  const usedBy = (d: Dataset) => uses(d, versions.data ?? []);
  return (
    <main className="datasets">
      <header className="exp-head ds-head">
        <div>
          <p className="eyebrow">Datasets · {list.length === 1 ? "1 table" : `${list.length} tables`}</p>
          <h1>Data in this project</h1>
        </div>
        <input type="search" className="ds-filter" aria-label="Filter datasets" placeholder="Filter datasets" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </header>
      {list.length === 0 ? (
        <p className="muted pad">No datasets yet. Run a flow that loads a file to see it here.</p>
      ) : (
        <div className="ds-body">
          <div className="ds-list">
            <table className="exp-table" aria-label="Datasets">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Origin</th>
                  <th scope="col" className="num">Rows</th>
                  <th scope="col" className="num">Cols</th>
                  <th scope="col">Used by</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((d) => (
                  <tr key={d.artifact.id} className={d === current ? "picked" : undefined}>
                    <td>
                      <button type="button" className="ds-name" aria-pressed={d === current} onClick={() => setPicked(d.artifact.id)}>
                        {d.name}
                      </button>
                    </td>
                    <td className="muted">{shortName(d.operator)}</td>
                    <td className="num mono">{d.total_rows.toLocaleString()}</td>
                    <td className="num mono">{d.total_columns}</td>
                    <td className="ds-used">{usedBy(d).join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {current && <DatasetDetail key={current.artifact.id} dataset={current} usedBy={usedBy(current)} />}
        </div>
      )}
    </main>
  );
}

/** "iris.csv · load" for each flow and step that loads the table, once each. */
function uses(dataset: Dataset, versions: PipelineVersion[]): string[] {
  const all = flows(versions);
  const named = dataset.used_by.map((u) => {
    const flow = all.find((f) => f.ids.includes(u.pipeline_version_id));
    return flow ? `${flowName(flow.head)} · ${u.node_id}` : u.node_id;
  });
  return [...new Set(named)];
}
