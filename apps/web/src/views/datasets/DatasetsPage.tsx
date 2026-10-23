import type { LoadedTable, PipelineVersion } from "@sprisk/contracts";
import { useState } from "react";

import { useLoadedTables } from "../../api/datasets.ts";
import { usePipelineVersions } from "../../api/hooks.ts";
import { flowCount, flows } from "../../flow/flows.ts";
import { flowName } from "../../flow/labels.ts";
import { shortName } from "../../flow/stages.ts";
import { Loading } from "../../components/ui/Loading.tsx";
import { useSelection } from "../../workbench/selection.ts";
import { useWorkbench } from "../../workbench/workbench.ts";
import { PanelToggleIcon } from "../Icons.tsx";
import { DatasetDetail } from "./DatasetDetail.tsx";
import { SearchField } from "../../components/ui/SearchField.tsx";
import { InfoDock } from "../../components/ui/InfoDock.tsx";

/** Every table the flows load, and a profile of the one picked (ADR-0038, ADR-0061). */
export function DatasetsPage() {
  const datasets = useLoadedTables();
  const versions = usePipelineVersions();
  const showRun = useSelection((s) => s.showRun);
  const setNav = useSelection((s) => s.setNav);
  const { sidebarOpen, toggleSidebar } = useWorkbench();
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
    <div className={`datasets-page-layout dsx ${sidebarOpen ? "with-sidebar" : "folded-sidebar"}`}>
      <aside className={`main-sidebar dsx-side ${sidebarOpen ? "" : "sidebar-rail-wrap"}`} aria-label="Datasets">
        {!sidebarOpen ? (
          <div className="sidebar-rail" aria-label="Datasets rail">
            <button
              type="button"
              className="sidebar-toggle-btn"
              title="Expand Datasets sidebar"
              aria-label="Expand Datasets sidebar"
              onClick={toggleSidebar}
            >
              <PanelToggleIcon size={14} style={{ transform: "scaleX(-1)" }} />
            </button>
            <span
              className="sidebar-rail-label"
              role="button"
              tabIndex={0}
              onClick={toggleSidebar}
            >
              Datasets
            </span>
          </div>
        ) : (
          <>
            <div className="sidebar-header">
              <div className="sidebar-title-row">
                <h2 className="sidebar-title">Datasets</h2>
                <span className="sidebar-meta">{list.length === 1 ? "1 table" : `${list.length} tables`}</span>
                <div style={{ flex: 1 }} />
                <button
                  type="button"
                  className="sidebar-toggle-btn"
                  title="Collapse Datasets sidebar"
                  aria-label="Collapse Datasets sidebar"
                  onClick={toggleSidebar}
                >
                  <PanelToggleIcon size={14} style={{ transform: "scaleX(-1)" }} />
                </button>
              </div>
              <div className="sidebar-search">
                <SearchField
                  value={filter}
                  onChange={setFilter}
                  placeholder="Search datasets"
                  ariaLabel="Filter datasets"
                />
              </div>
            </div>
            {list.length === 0 ? (
              <p className="muted pad" style={{ fontSize: "var(--fs-12)" }}>
                No datasets yet. Run a flow that loads a file to see it here.
              </p>
            ) : (
              <div className="sidebar-list dsx-list" role="list" aria-label="Dataset list">
                {shown.map((d) => (
                  <button
                    key={d.artifact.id}
                    type="button"
                    className={`step-item dsx-item ${d === current ? "selected" : ""}`}
                    aria-pressed={d === current}
                    onClick={() => setPicked(d.artifact.id)}
                    style={{ width: "100%", height: "auto", padding: "8px 10px", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 3 }}
                  >
                    <span className="step-item-name">{d.name}</span>
                    <span className="step-item-meta">
                      {d.total_rows.toLocaleString()} rows · {d.total_columns} cols · {shortName(d.operator)}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {current && (
              <InfoDock
                title="Info"
                rows={[
                  { k: "Rows", v: current.total_rows.toLocaleString() },
                  { k: "Columns", v: String(current.total_columns) },
                  { k: "Used by", v: plural(flowCount(current, versions.data ?? []), "flow") },
                ]}
              />
            )}
          </>
        )}
      </aside>

      <main className="center-screen dsx-main">
        {current && <DatasetDetail key={current.artifact.id} dataset={current} usedBy={usedBy(current)} />}
      </main>
    </div>
  );
}

const plural = (n: number, word: string) => `${n} ${n === 1 ? word : `${word}s`}`;

/** "iris.csv · load" for each flow and step that loads the table, once each. */
function uses(dataset: LoadedTable, versions: PipelineVersion[]): string[] {
  const all = flows(versions);
  const named = dataset.used_by.map((u) => {
    const flow = all.find((f) => f.ids.includes(u.pipeline_version_id));
    return flow ? `${flowName(flow.head)} · ${u.node_id}` : u.node_id;
  });
  return [...new Set(named)];
}
