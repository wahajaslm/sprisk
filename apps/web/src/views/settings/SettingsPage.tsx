import { useState } from "react";
import type { Operator } from "@sprisk/contracts";

import { useLoadedTables } from "../../api/datasets.ts";
import { useOperators, usePipelineVersions } from "../../api/hooks.ts";
import { useMethodologyRules } from "../../api/methodology.ts";
import { Button } from "../../components/ui/Button.tsx";
import { InfoDock } from "../../components/ui/InfoDock.tsx";
import { ListRow } from "../../components/ui/ListRow.tsx";
import { Loading } from "../../components/ui/Loading.tsx";
import { PageFrame } from "../../components/ui/PageFrame.tsx";
import { SearchField } from "../../components/ui/SearchField.tsx";
import { SideGroup } from "../../components/ui/SideGroup.tsx";
import { BodySection, RowItem, RowList } from "../../components/ui/RowList.tsx";
import { Sidebar } from "../../components/ui/Sidebar.tsx";
import { flowCount } from "../../flow/flows.ts";
import { pluginOf, plugins } from "../../flow/plugins.ts";
import { stepTitle } from "../../flow/stages.ts";
import { tableSize } from "../datasets/tableSize.ts";
import { useSelection } from "../../workbench/selection.ts";

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
  const setNav = useSelection((s) => s.setNav);
  const [page, setPage] = useState<Page>("Packs");
  const [search, setSearch] = useState("");
  const matches = (p: Page) => p.toLowerCase().includes(search.trim().toLowerCase());

  if (operators.isError) return <p role="alert" className="error pad">{operators.error.message}</p>;
  if (operators.isPending) return <Loading text="Loading settings…" pad />;

  const meta: Record<Page, string> = {
    Packs: count(rules, (r) => packs(r).length),
    Plugins: String(plugins(operators.data).length),
    Environments: "",
    Compute: "",
    Data: count(tables, (t) => t.length),
    Members: "",
  };
  const row = (p: Page) => <ListRow key={p} title={p} meta={meta[p] || "Not in local mode"} selected={p === page} onClick={() => setPage(p)} />;

  const header = {
    Packs: {
      eyebrow: "Settings · Platform",
      title: "Packs",
      description: "Methodology packs: the rules Sprisk checks a flow against.",
      actions: <Button variant="primary" onClick={() => setNav("Methodology")}>Open methodology</Button>,
    },
    Plugins: {
      eyebrow: "Settings · Platform",
      title: "Plugins",
      description: "The operators the registry loaded, by plugin. Each runs in the Python worker.",
      actions: <Button onClick={() => void operators.refetch()}>Refresh</Button>,
    },
    Data: {
      eyebrow: "Settings · Platform",
      title: "Data",
      description: "Tables loaded by a flow's steps. Sprisk reads files in place; it keeps only what steps write.",
      actions: <Button variant="primary" onClick={() => setNav("Datasets")}>Open datasets</Button>,
    },
  }[page as "Packs" | "Plugins" | "Data"] ?? { eyebrow: `Settings · ${ACCESS.includes(page as "Members") ? "Access" : "Platform"}`, title: page, description: NOT_YET[page]?.description ?? "" };

  return (
    <PageFrame
      sidebar={
        <Sidebar
          title="Settings"
          search={<SearchField value={search} onChange={setSearch} placeholder="Search settings" />}
          dock={
            <InfoDock
              rows={[
                { k: "Operators", v: String(operators.data.length) },
                { k: "Rules", v: count(rules, (r) => r.length) },
                { k: "Datasets", v: count(tables, (t) => t.length) },
              ]}
            />
          }
        >
          <SideGroup num={1} label="Platform" meta={PLATFORM.filter(matches).length}>
            {PLATFORM.filter(matches).map(row)}
          </SideGroup>
          <SideGroup num={2} label="Access" meta={ACCESS.filter(matches).length}>
            {ACCESS.filter(matches).map(row)}
          </SideGroup>
        </Sidebar>
      }
      header={header}
      view={page === "Data" ? "Tables" : NOT_YET[page] ? "Overview" : "Installed"}
    >
      {page === "Packs" && <Packs />}
      {page === "Plugins" && <Plugins operators={operators.data} />}
      {page === "Data" && <Data />}
      {NOT_YET[page] && <p className="muted">{NOT_YET[page].note}</p>}
    </PageFrame>
  );
}

/** A count from a read, or why there is none: never a 0 that only means "not read". */
function count<T>(query: { isError: boolean; isPending: boolean; data: T | undefined }, of: (data: T) => number): string {
  if (query.isError) return "Could not read";
  if (query.isPending || query.data === undefined) return "…";
  return String(of(query.data));
}

/** Rule ids are `methodology.<pack>.<rule>@<version>`. */
const packOf = (ruleId: string) => ruleId.split(".")[1] ?? ruleId;
const packs = (rules: { id: string; status: string }[]) => [...new Set(rules.map((r) => packOf(r.id)))].sort();


function Packs() {
  const rules = useMethodologyRules();
  return (
    <>
      {rules.isError && <p role="alert" className="error pad">{rules.error.message}</p>}
      {rules.isPending && <Loading text="Loading packs…" pad />}
      {rules.data && (
        <BodySection title="Installed" note="Each pack holds the rules for one kind of question.">
          <RowList label="Packs">
            {packs(rules.data).map((pack) => {
              const mine = rules.data.filter((r) => packOf(r.id) === pack);
              const active = mine.filter((r) => r.status === "active").length;
              return <RowItem key={pack} name={pack} meta={`${active} active · ${mine.length - active} draft`} />;
            })}
          </RowList>
        </BodySection>
      )}
    </>
  );
}

function Plugins({ operators }: { operators: Operator[] }) {
  const [open, setOpen] = useState<string>();
  return plugins(operators).map((plugin) => (
    <BodySection key={plugin} title={plugin} note={`${operators.filter((op) => pluginOf(op) === plugin).length} operators`}>
      <RowList label={plugin}>
        {operators
          .filter((op) => pluginOf(op) === plugin)
          .map((op) => (
            <RowItem
              key={op.id}
              name={stepTitle(op.id, op)}
              meta={`${op.capability_class} · ${op.inputs.length} in · ${op.outputs.length} out`}
              open={open === op.id}
              onToggle={() => setOpen(open === op.id ? undefined : op.id)}
            >
              <OperatorDetail op={op} />
            </RowItem>
          ))}
      </RowList>
    </BodySection>
  ));
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
  return (
    <>
      {tables.isError && <p role="alert" className="error pad">{tables.error.message}</p>}
      {tables.isPending && <Loading text="Loading data…" pad />}
      {tables.data?.length === 0 && <p className="muted pad">No data loaded yet.</p>}
      {tables.data && tables.data.length > 0 && (
        <BodySection title="Tables" note="The latest table each source step loaded.">
          <RowList label="Data">
            {tables.data.map((t) => {
              const used = flowCount(t, versions.data ?? []);
              return <RowItem key={t.artifact.id} name={t.name} meta={`${tableSize(t)} · used by ${used} ${used === 1 ? "flow" : "flows"}`} />;
            })}
          </RowList>
        </BodySection>
      )}
    </>
  );
}
