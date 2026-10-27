import * as Tabs from "@radix-ui/react-tabs";
import type { Attempt, AttemptOutput, CodeInterface, DisplayItem } from "@sprisk/contracts";
import { type ReactNode, useState } from "react";

import { parseIf } from "../../api/client.ts";
import type { Read } from "../../api/code.ts";
import { useArtifactText, useOutputs } from "../../api/hooks.ts";
import { MAX_INLINE_BYTES, PARQUET } from "../../api/media.ts";
import { isCodeOperator } from "../../flow/edit.ts";
import { isProfileOperator } from "../../flow/stages.ts";
import { ColumnProfile } from "../ColumnProfile.tsx";
import { TablePeek } from "../TablePeek.tsx";
import { Variables } from "./Variables.tsx";
import { ShownTable } from "./VisualsTab.tsx";
import { Loading } from "../../components/ui/Loading.tsx";
import { ink, P } from "../../styles/palette.ts";
import { METRIC_CAPTION, METRIC_ROW, MetricTile } from "./MetricTile.tsx";
import { ModelResults } from "./ModelResults.tsx";

export type Explore = ((port: string) => void) | undefined;

/** A code step's reports are shown in their own tabs, not as data. */
const REPORT_PORTS = ["display", "interface"];

const LABEL = { margin: "0", fontSize: "12.5px", color: "var(--t-label,#959595)" } as const;
const NOTE = { margin: "0", fontSize: "12.5px", color: "var(--t-faint,#8c8c8c)" } as const;
const BUTTON = { alignSelf: "flex-start", height: "28px", padding: "0 10px", borderRadius: "var(--r-sm,6px)", border: "1px solid rgba(var(--ink-rgb,255,255,255),0.14)", display: "flex", alignItems: "center", fontSize: "12.5px", fontWeight: "500", color: "var(--t-secondary,#d4d4d4)", cursor: "pointer" } as const;
/** The design's segmented pill, as in the sidebar's Pipeline · Operators · Plugins switch. */
const PILL = { alignSelf: "flex-start", display: "grid", gridAutoFlow: "column", gridAutoColumns: "max-content", gap: "2px", padding: "3px", borderRadius: "var(--r-md,8px)", background: "rgba(var(--ink-rgb,255,255,255),0.045)", maxWidth: "100%", overflowX: "auto" } as const;
const pillButton = (on: boolean) => ({ height: "26px", padding: "0 10px", borderRadius: "var(--r-sm,6px)", display: "flex", alignItems: "center", justifyContent: "center", gap: "4px", fontSize: "12.5px", fontWeight: "500", cursor: "pointer", whiteSpace: "nowrap", background: on ? ink(0.1) : "transparent", color: on ? P.t0 : P.t3 }) as const;

type Props = {
  attempt: Attempt | undefined;
  operator: string | undefined;
  capability: string | undefined;
  /** This step's metrics in the run before the shown one, for change tiles. */
  previous: Record<string, number> | undefined;
  explore: Explore;
  /** Ports that carry figures: shown in Visualizations, never as data (ADR-0025). */
  figurePorts: string[];
  /** Tables a code step showed; they count as data even when it passes nothing on. */
  shown: DisplayItem[];
  /** The step's output ports in the order its operator lists them (train before test). */
  portOrder: string[];
  /** A code step's variables (ADR-0030), and for older code steps the choice of what passes on. */
  code?: { found: Read<CodeInterface>; passOn?: ReactNode } | undefined;
};

/** What the step produces, drawn for people: tables, metrics, the model. Code steps also
 * show every variable they ended with and choose what they pass on (ADR-0030). Charts are
 * made in Visualizations. */
export function DataTab({ attempt, operator, capability, previous, explore, figurePorts, shown, portOrder, code }: Props) {
  const outputs = useOutputs(attempt?.id);
  if (!attempt) return <p className="muted" style={NOTE}>No data yet. Run the pipeline to see what this step produces.</p>;
  if (outputs.isPending) return <Loading />;
  if (outputs.isError) return <p role="alert" className="error">{outputs.error.message}</p>;
  // Console output is shown in Console, for every step (ADR-0025).
  const rank = (port: string) => (portOrder.includes(port) ? portOrder.indexOf(port) : portOrder.length);
  const data = outputs.data
    .filter((o) => o.port !== "console" && !figurePorts.includes(o.port) && !(isCodeOperator(operator) && REPORT_PORTS.includes(o.port)))
    .sort((a, b) => rank(a.port) - rank(b.port));
  const parts: Part[] = [
    // What the step passes on, then what its code showed, named by the code that showed it.
    ...data.map((o) => ({
      key: o.port,
      label: o.port,
      body: <Output output={o} view={viewOf(o, operator, capability)} nodeId={attempt?.node_id} previous={previous} explore={explore} />,
    })),
    ...shown.map((item, i) => ({
      key: `shown-${i}`,
      label: item.label ? (
        <>
          {item.label} <span style={{ color: P.t3, fontWeight: "400" }}>shown</span>
        </>
      ) : (
        `shown ${i + 1}`
      ),
      body: (
        <section className="output" aria-label={item.label ? `Shown table ${item.label}` : `Shown table ${i + 1}`} style={{ display: "flex", flexDirection: "column", gap: "10px", minWidth: "0" }}>
          <ShownTable item={item} index={i} />
        </section>
      ),
    })),
    ...(code ? [variablesPart(code, [...data.map((o) => o.port), ...shown.flatMap((i) => (i.label ? [i.label] : []))])] : []),
  ];
  return (
    <div className="outputs" style={{ display: "flex", flexDirection: "column", gap: "16px", minWidth: "0" }}>
      {parts.length === 0 && <p className="muted" style={NOTE}>This step produces no data.</p>}
      {parts.length === 1 && parts[0]!.body}
      {parts.length > 1 && <SubTabs parts={parts} />}
    </div>
  );
}

type Part = { key: string; label: ReactNode; body: ReactNode };

/** Everything the code ended with, except what already has a tab above: no table twice. */
function variablesPart({ found, passOn }: NonNullable<Props["code"]>, tabbed: string[]): Part {
  if (found.status !== "ready") {
    const body = found.status === "error" ? <p role="alert" className="error">{found.message}</p> : <Loading />;
    return { key: "variables", label: "variables", body };
  }
  const listed = found.value.outputs.filter((v) => !tabbed.includes(v.name));
  const omitted = found.value.outputs.filter((v) => tabbed.includes(v.name)).map((v) => v.name);
  return {
    key: "variables",
    label: (
      <>
        variables <span style={{ color: P.t3, fontWeight: "400", fontVariantNumeric: "tabular-nums" }}>{listed.length}</span>
      </>
    ),
    body: (
      <div className="code-data" style={{ display: "flex", flexDirection: "column", gap: "16px", minWidth: "0" }}>
        {passOn}
        <Variables found={listed} omitted={omitted} />
      </div>
    ),
  };
}

/** Several tables or results: one at a time, picked by name in the design's segmented pill. */
function SubTabs({ parts }: { parts: Part[] }) {
  const [picked, setPicked] = useState(parts[0]!.key);
  // A part that is gone (a rerun produced other ports) falls back to the first.
  const value = parts.some((p) => p.key === picked) ? picked : parts[0]!.key;
  return (
    <Tabs.Root value={value} onValueChange={setPicked} className="sub-tabs" style={{ display: "flex", flexDirection: "column", gap: "16px", minWidth: "0" }}>
      <Tabs.List aria-label="Outputs" style={PILL}>
        {parts.map((p) => (
          <Tabs.Trigger key={p.key} value={p.key} className="dx-btn dx-h-text" style={pillButton(p.key === value)}>
            {p.label}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      {parts.map((p) => (
        <Tabs.Content key={p.key} value={p.key}>
          {p.body}
        </Tabs.Content>
      ))}
    </Tabs.Root>
  );
}

type OutputView = "profile" | "table" | "metrics" | "json" | "model" | "other";

function viewOf(output: AttemptOutput, operator: string | undefined, capability: string | undefined): OutputView {
  const media = output.artifact.media_type;
  if (isProfileOperator(operator) && output.port === "profile") return "profile";
  if (media === PARQUET) return "table";
  if (media === "application/json") return capability === "evaluator" ? "metrics" : "json";
  if (media === "application/vnd.skops") return "model";
  return "other";
}

const TITLE: Record<OutputView, (port: string) => string> = {
  profile: () => "Columns",
  table: (port) => `Table · ${port}`,
  metrics: () => "Metrics",
  json: (port) => port,
  model: () => "Model",
  other: (port) => port,
};

function Output({
  output,
  view,
  nodeId,
  previous,
  explore,
}: {
  output: AttemptOutput;
  view: OutputView;
  nodeId: string | undefined;
  previous: Props["previous"];
  explore: Explore;
}) {
  const [profileMode, setProfileMode] = useState<"table" | "cards">(nodeId === "profile" ? "cards" : "table");
  const isJson = view === "json" || view === "metrics";
  const small = output.artifact.size_bytes <= MAX_INLINE_BYTES;
  const text = useArtifactText(isJson && small ? output.artifact.id : undefined);
  const a = output.artifact;
  const exploreButton = explore && (
    <button type="button" className="dx-btn dx-h-06" aria-label={`Explore ${output.port} in code`} onClick={() => explore(output.port)} style={BUTTON}>
      Explore in code
    </button>
  );
  const peek = <TablePeek artifactId={a.id} port={output.port} actions={() => exploreButton} />;
  return (
    <section className="output" aria-label={TITLE[view](output.port)} style={{ display: "flex", flexDirection: "column", gap: "12px", minWidth: "0" }}>
      {view === "table" ? (
        peek
      ) : view === "profile" ? (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
            <p style={LABEL}>Table · {output.port}</p>
            <div role="group" aria-label="Profile view options" style={PILL}>
              <button type="button" className="dx-btn dx-h-text" aria-pressed={profileMode === "table"} onClick={() => setProfileMode("table")} title="View actual raw tabular data from DuckDB SUMMARIZE" style={pillButton(profileMode === "table")}>
                Data Table
              </button>
              <button type="button" className="dx-btn dx-h-text" aria-pressed={profileMode === "cards"} onClick={() => setProfileMode("cards")} title="View per-column summary cards" style={pillButton(profileMode === "cards")}>
                Column Cards
              </button>
            </div>
          </div>
          {profileMode === "table" ? peek : <ColumnProfile artifactId={a.id} />}
        </>
      ) : (
        <>
          <p style={LABEL}>{TITLE[view](output.port)}</p>
          {isJson && !small ? (
            <p className="muted" style={NOTE}>Output too large to show here ({a.size_bytes} bytes).</p>
          ) : isJson && text.isError ? (
            <p role="alert" className="error">{text.error.message}</p>
          ) : view === "metrics" ? (
            <MetricTiles text={text.data} previous={previous} />
          ) : isJson ? (
            <pre className="code">{prettyJson(text.data)}</pre>
          ) : view === "model" ? (
            <p className="muted" style={NOTE}>A fitted scikit-learn model, saved for the steps that use it.</p>
          ) : (
            <p className="muted" style={NOTE}>Saved output, used by the steps that read it.</p>
          )}
        </>
      )}
    </section>
  );
}

/** Each numeric metric as a tile, with its change since the previous run. */
function MetricTiles({ text, previous }: { text: string | undefined; previous: Record<string, number> | undefined }) {
  if (text === undefined) return <Loading text="Loading metrics…" />;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return <pre className="code">{text}</pre>; // not JSON metrics; show it as written
  }
  if (typeof raw !== "object" || raw === null) return <pre className="code">{text}</pre>;
  // Older runs wrote plain metrics; they keep the plain tiles.
  const report = parseIf("ClassificationReport", raw);
  if (report) return <ModelResults report={report} previous={previous} />;
  const entries = Object.entries(raw as Record<string, unknown>);
  const tiles = entries.filter((e): e is [string, number] => typeof e[1] === "number" && e[0] !== "n_rows");
  const rows = (raw as Record<string, unknown>).n_rows;
  const estimator = (raw as Record<string, unknown>).estimator;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <div style={METRIC_ROW}>
        {tiles.map(([name, value]) => (
          <MetricTile key={name} name={name.replaceAll("_", " ")} value={value} before={previous?.[name]} />
        ))}
      </div>
      {(typeof rows === "number" || typeof estimator === "string") && (
        <p style={METRIC_CAPTION}>
          {typeof estimator === "string" ? estimator : "Model"}
          {typeof rows === "number" ? ` · scored on ${rows} held-out rows` : ""}
        </p>
      )}
    </div>
  );
}

const prettyJson = (text: string | undefined) => {
  if (text === undefined) return "…";
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
};
