import type { LoadedTable, PipelineVersion } from "@sprisk/contracts";
import { useState } from "react";

import { useLoadedTables } from "../../api/datasets.ts";
import { usePipelineVersions } from "../../api/hooks.ts";
import { flowCount, flowOfVersion, flows } from "../../flow/flows.ts";
import { tableSize } from "./tableSize.ts";
import { flowName } from "../../flow/labels.ts";
import { shortName } from "../../flow/stages.ts";
import { Loading } from "../../components/ui/Loading.tsx";
import { useSelection } from "../../workbench/selection.ts";
import { Button } from "../../components/ui/Button.tsx";
import { PageFrame } from "../../components/ui/PageFrame.tsx";
import { ListRow } from "../../components/ui/ListRow.tsx";
import { Sidebar } from "../../components/ui/Sidebar.tsx";
import { LineageTab, PreviewTab, ProfileTab, type Use } from "./DatasetDetail.tsx";
import { InvestigationTab } from "./InvestigationTab.tsx";
import { SearchField } from "../../components/ui/SearchField.tsx";
import { InfoDock } from "../../components/ui/InfoDock.tsx";

/** Every table the flows load, and a preview, profile and investigations of the one picked
 * (ADR-0038, ADR-0061, ADR-0065). */
export function DatasetsPage() {
  const datasets = useLoadedTables();
  const versions = usePipelineVersions();
  const showRun = useSelection((s) => s.showRun);
  const setNav = useSelection((s) => s.setNav);
  const [tab, setTab] = useState<Tab>("Preview");
  const [filter, setFilter] = useState("");
  const [picked, setPicked] = useState<string>();
  if (datasets.isError) return <p role="alert" className="error pad">{datasets.error.message}</p>;
  if (datasets.isPending) return <Loading text="Loading datasets…" pad />;
  const list = datasets.data;
  const shown = list.filter((d) => d.name.toLowerCase().includes(filter.trim().toLowerCase()));
  const current = shown.find((d) => d.artifact.id === picked) ?? shown[0];

  const lineage = current ? uses(current, versions.data ?? []) : [];
  const open = (use: Use["use"]) => {
    showRun(use.pipeline_version_id, use.run_id, use.node_id);
    setNav("Flow");
  };
  const first = current?.used_by[0];

  return (
    <PageFrame
      sidebar={
        <Sidebar
          title="Datasets"
          search={<SearchField value={filter} onChange={setFilter} placeholder="Search datasets" ariaLabel="Filter datasets" />}
          dock={
            current && (
              <InfoDock
                rows={[
                  { k: "Rows", v: current.total_rows.toLocaleString() },
                  { k: "Columns", v: String(current.total_columns) },
                  { k: "Used by", v: plural(flowCount(current, versions.data ?? []), "flow") },
                ]}
              />
            )
          }
        >
          {list.length === 0 ? (
            <p className="muted pad">No datasets yet. Run a flow that loads a file to see it here.</p>
          ) : (
            <div role="list" aria-label="Dataset list">
              {shown.map((d) => (
                <div key={d.artifact.id} role="listitem">
                  <ListRow title={d.name} meta={`${tableSize(d)} · ${shortName(d.operator)}`} selected={d === current} onClick={() => setPicked(d.artifact.id)} />
                </div>
              ))}
            </div>
          )}
        </Sidebar>
      }
      header={
        current
          ? {
              eyebrow: `Dataset · loaded by ${shortName(current.operator)}`,
              title: current.name,
              description: `Used by ${lineage.map((l) => l.label).join(", ") || "no flow"}`,
              ...(first ? { actions: <Button variant="primary" onClick={() => open(first)}>Open in flow</Button> } : {}),
            }
          : { eyebrow: "Datasets", title: "No dataset yet", description: "A table appears here once a flow's step loads it." }
      }
      {...(current ? { tabs: { label: "Dataset", items: TABS.map((t) => ({ value: t, label: t })), value: tab, onChange: (t: string) => setTab(t as Tab) } } : {})}
    >
      {current && (tab === "Lineage" ? (
        <LineageTab lineage={lineage} onOpen={open} />
      ) : tab === "Investigation" ? (
        <InvestigationTab key={current.artifact.id} dataset={current} versions={versions.data ?? []} />
      ) : tab === "Preview" ? (
        <PreviewTab key={current.artifact.id} dataset={current} />
      ) : (
        <ProfileTab key={current.artifact.id} dataset={current} />
      ))}
    </PageFrame>
  );
}

const TABS = ["Preview", "Profile", "Investigation", "Lineage"] as const;
type Tab = (typeof TABS)[number];

const plural = (n: number, word: string) => `${n} ${n === 1 ? word : `${word}s`}`;

/** "iris.csv · load" for each flow and step that loads the table, once each, with where it ran. */
function uses(dataset: LoadedTable, versions: PipelineVersion[]): Use[] {
  const all = flows(versions);
  const named = dataset.used_by.map((use) => {
    const flow = flowOfVersion(all, use.pipeline_version_id);
    return { label: flow ? `${flowName(flow.head)} · ${use.node_id}` : use.node_id, use };
  });
  return named.filter((n, i) => named.findIndex((m) => m.label === n.label) === i);
}
