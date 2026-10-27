import type { DatasetVersion, LoadedTable, PipelineVersion } from "@sprisk/contracts";
import { type ReactNode, useState } from "react";

import { ApiError } from "../../api/client.ts";
import { useAddDataSource, useDatasetProfile, useDatasetVersions, useLoadedTables } from "../../api/datasets.ts";
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
import { LineageTab, type Use } from "./DatasetDetail.tsx";
import { ExploreTab, SourceExploreTab, type DatasetExploreView } from "./ExploreTab.tsx";
import { InvestigationTab } from "./InvestigationTab.tsx";
import { SearchField } from "../../components/ui/SearchField.tsx";
import { InfoDock } from "../../components/ui/InfoDock.tsx";

/** Every table the flows load and every data source added by reference, and an exploration
 * and investigations of the one picked (ADR-0038, ADR-0061, ADR-0065, ADR-0067). */
export function DatasetsPage() {
  const datasets = useLoadedTables();
  const sources = useDatasetVersions();
  const versions = usePipelineVersions();
  const showRun = useSelection((s) => s.showRun);
  const setNav = useSelection((s) => s.setNav);
  const [tab, setTab] = useState<Tab>("Overview");
  const [filter, setFilter] = useState("");
  const [picked, setPicked] = useState<string>();
  if (datasets.isError) return <p role="alert" className="error pad">{datasets.error.message}</p>;
  if (sources.isError) return <p role="alert" className="error pad">{sources.error.message}</p>;
  if (datasets.isPending || sources.isPending) return <Loading text="Loading datasets…" pad />;
  const list = datasets.data;
  const matches = (name: string) => name.toLowerCase().includes(filter.trim().toLowerCase());
  const shown = list.filter((d) => matches(d.name));
  const shownSources = sources.data.filter((s) => matches(s.name));
  const source = shownSources.find((s) => s.id === picked);
  const current = source ? undefined : (shown.find((d) => d.artifact.id === picked) ?? shown[0]);
  const added = (version: DatasetVersion) => {
    setPicked(version.id);
    setTab("Overview");
  };
  if (source || (!current && shownSources[0])) {
    const open = source ?? shownSources[0]!;
    return (
      <PageFrame
        sidebar={<DatasetSidebar filter={filter} onFilter={setFilter} tables={shown} sources={shownSources} picked={open.id} onPick={setPicked} onAdded={added} empty={list.length === 0} />}
        header={{ eyebrow: "Data source · added by reference", title: open.name, description: open.location }}
      >
        <SourceExploreTab key={open.id} source={open} />
      </PageFrame>
    );
  }

  const lineage = current ? uses(current, versions.data ?? []) : [];
  const open = (use: Use["use"]) => {
    showRun(use.pipeline_version_id, use.run_id, use.node_id);
    setNav("Flow");
  };
  const first = current?.used_by[0];

  return (
    <PageFrame
      sidebar={
        <DatasetSidebar
          filter={filter}
          onFilter={setFilter}
          tables={shown}
          sources={shownSources}
          picked={current?.artifact.id}
          onPick={setPicked}
          onAdded={added}
          empty={list.length === 0}
          dock={current && <DatasetDock dataset={current} flows={plural(flowCount(current, versions.data ?? []), "pipeline")} />}
        />
      }
      header={
        current
          ? {
              eyebrow: `Dataset · loaded by ${shortName(current.operator)}`,
              title: current.name,
              description: `Used by ${lineage.map((l) => l.label).join(", ") || "no pipeline"}`,
              ...(first ? { actions: <Button variant="primary" onClick={() => open(first)}>Open in pipeline</Button> } : {}),
            }
          : { eyebrow: "Datasets", title: "No dataset yet", description: "Add a data source by its path or URI, or run a pipeline that loads a file." }
      }
      {...(current ? { tabs: { label: "Dataset", items: TABS.map((t) => ({ value: t, label: t })), value: tab, onChange: (t: string) => setTab(t as Tab) } } : {})}
    >
      {current && (tab === "Lineage" ? (
        <LineageTab lineage={lineage} onOpen={open} />
      ) : tab === "Investigation" ? (
        <InvestigationTab key={current.artifact.id} dataset={current} versions={versions.data ?? []} />
      ) : (
        <ExploreTab key={`${current.artifact.id}-${tab}`} dataset={current} target={labelOf(current, versions.data ?? [])} questionVersionId={questionOf(current, versions.data ?? [])} view={tab} />
      ))}
    </PageFrame>
  );
}

const TABS = ["Overview", "Quality", "Relationships", "Modalities", "Investigation", "Lineage"] as const;

/** The add-a-source form, the sources added by reference, then the tables flows load. */
function DatasetSidebar({ filter, onFilter, tables, sources, picked, onPick, onAdded, empty, dock }: {
  filter: string;
  onFilter: (f: string) => void;
  tables: LoadedTable[];
  sources: DatasetVersion[];
  picked: string | undefined;
  onPick: (id: string) => void;
  onAdded: (v: DatasetVersion) => void;
  empty: boolean;
  dock?: ReactNode;
}) {
  return (
    <Sidebar title="Datasets" search={<SearchField value={filter} onChange={onFilter} placeholder="Search datasets" ariaLabel="Filter datasets" />} dock={dock}>
      <AddDataSource onAdded={onAdded} />
      {empty && sources.length === 0 ? (
        <p className="muted pad">No datasets yet. Add a data source above, or run a pipeline that loads a file.</p>
      ) : (
        <div role="list" aria-label="Dataset list">
          {sources.map((s) => (
            <div key={s.id} role="listitem">
              <ListRow title={s.name} meta={`${s.format} · ${plural(s.file_count, "file")} · ${bytes(s.size_bytes)} · by reference`} selected={s.id === picked} onClick={() => onPick(s.id)} />
            </div>
          ))}
          {tables.map((d) => (
            <div key={d.artifact.id} role="listitem">
              <ListRow title={d.name} meta={`${tableSize(d)} · ${shortName(d.operator)}`} selected={d.artifact.id === picked} onClick={() => onPick(d.artifact.id)} />
            </div>
          ))}
        </div>
      )}
    </Sidebar>
  );
}

/** One field for a local path or an object-store URI. The server checks it: inside the data
 * roots, there, and a supported scheme. Nothing is uploaded or copied (ADR-0067). */
function AddDataSource({ onAdded }: { onAdded: (v: DatasetVersion) => void }) {
  const [location, setLocation] = useState("");
  const add = useAddDataSource();
  const submit = () => {
    if (location.trim() === "") return;
    add.mutate(location.trim(), {
      onSuccess: (v) => {
        setLocation("");
        onAdded(v);
      },
    });
  };
  return (
    <form
      className="add-source"
      aria-label="Add data source"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <input type="text" aria-label="Data source path or URI" placeholder="/data/file.csv or s3://bucket/prefix/" value={location} onChange={(e) => setLocation(e.target.value)} />
      <Button size="sm" disabled={location.trim() === "" || add.isPending} onClick={submit}>
        Add
      </Button>
      {add.isError && (
        <p role="alert" className="error">
          {add.error instanceof ApiError && add.error.errors.length > 0 ? add.error.errors.map((e) => e.message).join(" ") : add.error.message}
        </p>
      )}
    </form>
  );
}

/** 2.5 GB, 120 MB, 900 B: a source's size, in decimal units. */
function bytes(n: number): string {
  for (const [unit, size] of [["PB", 1e15], ["TB", 1e12], ["GB", 1e9], ["MB", 1e6], ["kB", 1e3]] as const) {
    if (n >= size) return `${Math.round((n / size) * 10) / 10} ${unit}`;
  }
  return `${n} B`;
}

/** A table's numbers go in the Info dock, not in a row under the header (design rule: stats go
 * in the Info dock). The profile's are added once it is read. */
function DatasetDock({ dataset, flows }: { dataset: LoadedTable; flows: string }) {
  const profile = useDatasetProfile(dataset.artifact.id).data;
  const cells = profile ? profile.profiled_rows * profile.columns.length : 0;
  const empty = profile ? profile.columns.reduce((n, c) => n + c.missing + (c.blank ?? 0), 0) : 0;
  return (
    <InfoDock
      rows={[
        { k: "Rows", v: dataset.total_rows.toLocaleString() },
        { k: "Columns", v: String(dataset.total_columns) },
        ...(profile ? [{ k: "Empty cells", v: cells === 0 ? "—" : `${Math.round((empty / cells) * 1000) / 10}%` }] : []),
        ...(profile?.duplicate_rows !== undefined ? [{ k: "Duplicate rows", v: profile.duplicate_rows.toLocaleString() }] : []),
        { k: "Used by", v: flows },
      ]}
    />
  );
}
type Tab = DatasetExploreView | "Investigation" | "Lineage";

const plural = (n: number, word: string) => `${n} ${n === 1 ? word : `${word}s`}`;

/** The label the flows that load the table predict: the first step's `target` setting. */
function labelOf(dataset: LoadedTable, versions: PipelineVersion[]): string | undefined {
  for (const use of dataset.used_by) {
    const version = versions.find((v) => v.id === use.pipeline_version_id);
    const target = version?.nodes.map((n) => n.params["target"]).find((t) => typeof t === "string");
    if (typeof target === "string") return target;
  }
  return undefined;
}

/** The loaded table may be used by more than one flow; use the first version that pins a
 * question ledger revision, matching the existing target selection rule above. */
function questionOf(dataset: LoadedTable, versions: PipelineVersion[]): string | undefined {
  for (const use of dataset.used_by) {
    const question = versions.find((version) => version.id === use.pipeline_version_id)?.question_version_id;
    if (question) return question;
  }
  return undefined;
}

/** "iris.csv · load" for each flow and step that loads the table, once each, with where it ran. */
function uses(dataset: LoadedTable, versions: PipelineVersion[]): Use[] {
  const all = flows(versions);
  const named = dataset.used_by.map((use) => {
    const flow = flowOfVersion(all, use.pipeline_version_id);
    return { label: flow ? `${flowName(flow.head)} · ${use.node_id}` : use.node_id, use };
  });
  return named.filter((n, i) => named.findIndex((m) => m.label === n.label) === i);
}
