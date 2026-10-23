import { useState } from "react";
import type { Operator } from "@sprisk/contracts";

import { useLoadedTables } from "../../api/datasets.ts";
import { useOperators, usePipelineVersions } from "../../api/hooks.ts";
import { useMethodologyRules } from "../../api/methodology.ts";
import { Button } from "../../components/ui/Button.tsx";
import { InfoDock } from "../../components/ui/InfoDock.tsx";
import { ListRow } from "../../components/ui/ListRow.tsx";
import { Loading } from "../../components/ui/Loading.tsx";
import { PageHeader } from "../../components/ui/PageHeader.tsx";
import { SectionLabel } from "../../components/ui/SectionLabel.tsx";
import { Sidebar } from "../../components/ui/Sidebar.tsx";
import { flowCount } from "../../flow/flows.ts";
import { stepTitle } from "../../flow/stages.ts";
import { useSelection } from "../../workbench/selection.ts";
import { useWorkbench } from "../../workbench/workbench.ts";

const PLATFORM = ["Packs", "Plugins", "Environments", "Compute", "Data"] as const;
const ACCESS = ["Members"] as const;
type Page = (typeof PLATFORM)[number] | (typeof ACCESS)[number];

/** Pages local mode has no API for yet: they say so instead of showing made-up status. */
const NOT_YET: Partial<Record<Page, { description: string; note: string }>> = {
  Environments: {
    description: "The Python environments steps run in.",
    note: "Local mode runs every step in the Python environment Sprisk started with. Named environments are not available yet.",
  },
  Compute: {
    description: "Where steps run, and how much they may use.",
    note: "Local mode runs every step on this machine. Compute pools are not available yet.",
  },
  Members: {
    description: "Who can open this project.",
    note: "Local mode has one user. Members come with hosted mode.",
  },
};

/** What is installed: methodology packs, operator plugins and loaded data. */
export function SettingsPage() {
  const operators = useOperators();
  const rules = useMethodologyRules();
  const tables = useLoadedTables();
  const sidebarOpen = useWorkbench((s) => s.sidebarOpen);
  const [page, setPage] = useState<Page>("Packs");

  if (operators.isError) return <p role="alert" className="error pad">{operators.error.message}</p>;
  if (operators.isPending) return <Loading text="Loading settings…" pad />;

  const meta: Record<Page, string> = {
    Packs: String(packs(rules.data ?? []).length),
    Plugins: String(plugins(operators.data).length),
    Environments: "",
    Compute: "",
    Data: String(tables.data?.length ?? 0),
    Members: "",
  };
  const row = (p: Page) => <ListRow key={p} title={p} meta={meta[p] || "Not in local mode"} selected={p === page} onClick={() => setPage(p)} />;

  return (
    <div className={`settings-page-layout ${sidebarOpen ? "with-sidebar" : "folded-sidebar"}`}>
      <Sidebar
        title="Settings"
        dock={
          <InfoDock
            title="Installed"
            rows={[
              { k: "Operators", v: String(operators.data.length) },
              { k: "Rules", v: String(rules.data?.length ?? 0) },
              { k: "Datasets", v: String(tables.data?.length ?? 0) },
            ]}
          />
        }
      >
        <SectionLabel>Platform</SectionLabel>
        {PLATFORM.map(row)}
        <SectionLabel>Access</SectionLabel>
        {ACCESS.map(row)}
      </Sidebar>

      <main className="center-screen set-main">
        {page === "Packs" && <Packs />}
        {page === "Plugins" && <Plugins operators={operators.data} reload={() => void operators.refetch()} />}
        {page === "Data" && <Data />}
        {NOT_YET[page] && (
          <>
            <PageHeader eyebrow="Settings" title={page} description={NOT_YET[page].description} />
            <p className="muted pad">{NOT_YET[page].note}</p>
          </>
        )}
      </main>
    </div>
  );
}

/** Rule ids are `methodology.<pack>.<rule>@<version>`. */
const packOf = (ruleId: string) => ruleId.split(".")[1] ?? ruleId;
const packs = (rules: { id: string; status: string }[]) => [...new Set(rules.map((r) => packOf(r.id)))].sort();

/** Operator ids are `sprisk.<plugin>.<operator>@<version>`. */
const pluginOf = (op: Operator) => op.id.split(".")[1] ?? op.id;
const plugins = (ops: Operator[]) => [...new Set(ops.map(pluginOf))].sort();

function Packs() {
  const rules = useMethodologyRules();
  const setNav = useSelection((s) => s.setNav);
  return (
    <>
      <PageHeader
        eyebrow="Settings · Platform"
        title="Packs"
        description="Methodology packs: the rules Sprisk checks a flow against."
        actions={<Button variant="primary" onClick={() => setNav("Methodology")}>Open methodology</Button>}
      />
      {rules.isError && <p role="alert" className="error pad">{rules.error.message}</p>}
      {rules.isPending && <Loading text="Loading packs…" pad />}
      {rules.data && (
        <ul className="set-rows" aria-label="Packs">
          {packs(rules.data).map((pack) => {
            const mine = rules.data.filter((r) => packOf(r.id) === pack);
            const active = mine.filter((r) => r.status === "active").length;
            return (
              <li key={pack} className="set-row">
                <span className="set-row-name">{pack}</span>
                <span className="set-row-meta">{active} active · {mine.length - active} draft</span>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function Plugins({ operators, reload }: { operators: Operator[]; reload: () => void }) {
  const [open, setOpen] = useState<string>();
  return (
    <>
      <PageHeader
        eyebrow="Settings · Platform"
        title="Plugins"
        description="The operators the registry loaded, by plugin. Each runs in the Python worker."
        actions={<Button onClick={reload}>Reload registry</Button>}
      />
      <div className="set-scroll">
        {plugins(operators).map((plugin) => (
          <section key={plugin} className="set-group">
            <h2 className="set-group-title">{plugin}</h2>
            <ul className="set-rows" aria-label={plugin}>
              {operators.filter((op) => pluginOf(op) === plugin).map((op) => (
                <li key={op.id}>
                  <button type="button" className="set-row" aria-expanded={open === op.id} onClick={() => setOpen(open === op.id ? undefined : op.id)}>
                    <span className="set-row-name">{stepTitle(op.id)}</span>
                    <span className="set-row-meta">{op.capability_class} · {op.inputs.length} in · {op.outputs.length} out</span>
                  </button>
                  {open === op.id && <OperatorDetail op={op} />}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}

function OperatorDetail({ op }: { op: Operator }) {
  const ports = (list: Operator["inputs"]) => (list.length === 0 ? "None" : list.map((p) => `${p.name} (${p.kind})`).join(" · "));
  return (
    <section className="set-detail" aria-label={op.id}>
      {op.description && <p>{op.description}</p>}
      <dl>
        <dt>Id</dt>
        <dd className="mono">{op.id}</dd>
        <dt>Entrypoint</dt>
        <dd className="mono">{op.entrypoint}</dd>
        <dt>Inputs</dt>
        <dd>{ports(op.inputs)}</dd>
        <dt>Outputs</dt>
        <dd>{ports(op.outputs)}</dd>
        <dt>Effects</dt>
        <dd>{op.effects} · network {op.network}</dd>
      </dl>
      <pre className="set-schema">{JSON.stringify(op.params_schema, null, 2)}</pre>
    </section>
  );
}

function Data() {
  const tables = useLoadedTables();
  const versions = usePipelineVersions();
  const setNav = useSelection((s) => s.setNav);
  return (
    <>
      <PageHeader
        eyebrow="Settings · Platform"
        title="Data"
        description="Tables loaded by a flow's steps. Sprisk reads files in place; it keeps only what steps write."
        actions={<Button variant="primary" onClick={() => setNav("Datasets")}>Open datasets</Button>}
      />
      {tables.isError && <p role="alert" className="error pad">{tables.error.message}</p>}
      {tables.isPending && <Loading text="Loading data…" pad />}
      {tables.data?.length === 0 && <p className="muted pad">No data loaded yet.</p>}
      {tables.data && tables.data.length > 0 && (
        <ul className="set-rows" aria-label="Data">
          {tables.data.map((t) => {
            const used = flowCount(t, versions.data ?? []);
            return (
              <li key={t.artifact.id} className="set-row">
                <span className="set-row-name">{t.name}</span>
                <span className="set-row-meta">
                  {t.total_rows.toLocaleString()} rows · {t.total_columns} columns · used by {used} {used === 1 ? "flow" : "flows"}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
