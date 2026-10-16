import * as Tabs from "@radix-ui/react-tabs";
import type { Attempt, AttemptOutput, DisplayItem } from "@sprisk/contracts";
import type { ReactNode } from "react";

import { useArtifactText, useOutputs } from "../../api/hooks.ts";
import { MAX_INLINE_BYTES, PARQUET } from "../../api/media.ts";
import { isCodeOperator } from "../../flow/edit.ts";
import { isProfileOperator } from "../../flow/stages.ts";
import { useInspectorDetail } from "../../workbench/detail.ts";
import { ColumnProfile } from "../ColumnProfile.tsx";
import { formatMetric } from "../NodeFact.tsx";
import { TablePeek } from "../TablePeek.tsx";
import { ShownTable } from "./VisualsTab.tsx";
import { ChartMenu } from "../ChartMenu.tsx";
import type { ChartSpec } from "../../flow/edit.ts";

export type Explore = ((port: string) => void) | undefined;
export type AddChart = ((port: string, spec: ChartSpec) => void) | undefined;

/** A code step's reports are shown in their own tabs, not as data. */
const REPORT_PORTS = ["display", "interface"];

type Props = {
  attempt: Attempt | undefined;
  operator: string | undefined;
  capability: string | undefined;
  /** This step's metrics in the run before the shown one, for change tiles. */
  previous: Record<string, number> | undefined;
  explore: Explore;
  addChart: AddChart;
  /** Tables a code step showed; they count as data even when it passes nothing on. */
  shown: DisplayItem[];
};

/** What the step produces, drawn for people: tables, metrics, the model. Code steps also
 * choose what they pass on and list the other values they hold. */
export function DataTab({ attempt, operator, capability, previous, explore, addChart, shown, children }: Props & { children?: ReactNode }) {
  const outputs = useOutputs(attempt?.id);
  if (!attempt) return <p className="muted">No data yet. Run the flow to see what this step produces.</p>;
  if (outputs.isPending) return <p className="muted">Loading…</p>;
  if (outputs.isError) return <p role="alert" className="error">{outputs.error.message}</p>;
  const data = outputs.data.filter((o) => !(isCodeOperator(operator) && REPORT_PORTS.includes(o.port)));
  const parts: Part[] = [
    ...data.map((o) => ({
      key: o.port,
      label: o.port,
      body: <Output output={o} view={viewOf(o, operator, capability)} previous={previous} explore={explore} addChart={addChart} />,
    })),
    ...shown.map((item, i) => ({
      key: `shown-${i}`,
      label: `shown ${i + 1}`,
      body: (
        <section className="output" aria-label={`Shown table ${i + 1}`}>
          <ShownTable item={item} index={i} />
        </section>
      ),
    })),
  ];
  return (
    <div className="outputs">
      {parts.length === 0 && <p className="muted">This step produces no data.</p>}
      {parts.length === 1 && parts[0]!.body}
      {parts.length > 1 && <SubTabs parts={parts} />}
      {children}
    </div>
  );
}

type Part = { key: string; label: string; body: ReactNode };

/** Several tables or results: one at a time, picked by name. */
function SubTabs({ parts }: { parts: Part[] }) {
  return (
    <Tabs.Root defaultValue={parts[0]!.key} className="sub-tabs">
      <Tabs.List className="strip-tabs" aria-label="Outputs">
        {parts.map((p) => (
          <Tabs.Trigger key={p.key} value={p.key}>
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
  previous,
  explore,
  addChart,
}: {
  output: AttemptOutput;
  view: OutputView;
  previous: Props["previous"];
  explore: Explore;
  addChart: AddChart;
}) {
  const technical = useInspectorDetail((s) => s.technical);
  const isJson = view === "json" || view === "metrics";
  const small = output.artifact.size_bytes <= MAX_INLINE_BYTES;
  const text = useArtifactText(isJson && small ? output.artifact.id : undefined);
  const a = output.artifact;
  return (
    <section className="output" aria-label={TITLE[view](output.port)}>
      {view === "table" ? (
        <TablePeek
          artifactId={a.id}
          port={output.port}
          actions={(columns) => (
            <>
              {addChart && <ChartMenu columns={columns} busy={false} onAdd={(spec) => addChart(output.port, spec)} />}
              {technical && <span className="tech">{a.content_hash.slice(0, 19)}… · {a.id}</span>}
              {explore && (
                <button type="button" className="page-btn" aria-label={`Explore ${output.port} in code`} onClick={() => explore(output.port)}>
                  Explore in code
                </button>
              )}
            </>
          )}
        />
      ) : (
      <>
      <div className="output-head">
        <p className="output-title">{TITLE[view](output.port)}</p>
        {technical && (
          <p className="tech">
            {a.media_type} · {a.size_bytes} bytes · {a.content_hash.slice(0, 19)}… · {a.id}
          </p>
        )}
      </div>
      {isJson && !small ? (
        <p className="muted">Output too large to show here ({a.size_bytes} bytes).</p>
      ) : isJson && text.isError ? (
        <p role="alert" className="error">{text.error.message}</p>
      ) : view === "metrics" ? (
        <MetricTiles text={text.data} previous={previous} />
      ) : isJson ? (
        <pre className="code">{prettyJson(text.data)}</pre>
      ) : view === "profile" ? (
        <ColumnProfile artifactId={a.id} />
      ) : view === "model" ? (
        <p className="muted">A fitted scikit-learn model, saved for the steps that use it.</p>
      ) : (
        <p className="muted">Saved output. Turn on technical details to see its type and hash.</p>
      )}
      </>
      )}
    </section>
  );
}

/** Each numeric metric as a tile, with its change since the previous run. */
function MetricTiles({ text, previous }: { text: string | undefined; previous: Record<string, number> | undefined }) {
  if (text === undefined) return <p className="muted">Loading metrics…</p>;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return <pre className="code">{text}</pre>; // not JSON metrics; show it as written
  }
  if (typeof raw !== "object" || raw === null) return <pre className="code">{text}</pre>;
  const entries = Object.entries(raw as Record<string, unknown>);
  const tiles = entries.filter((e): e is [string, number] => typeof e[1] === "number" && e[0] !== "n_rows");
  const rows = (raw as Record<string, unknown>).n_rows;
  const estimator = (raw as Record<string, unknown>).estimator;
  return (
    <div className="metrics">
      <div className="metric-tiles">
        {tiles.map(([name, value]) => {
          const before = previous?.[name];
          const delta = before === undefined ? undefined : value - before;
          return (
            <div key={name} className="metric-tile" role="group" aria-label={name}>
              <span className="metric-name">{name.replaceAll("_", " ")}</span>
              <span className="metric-value">{formatMetric(value)}</span>
              <span className="metric-delta">
                {delta === undefined ? "first run" : delta === 0 ? "same as last run" : `${delta > 0 ? "▲" : "▼"} ${formatMetric(Math.abs(delta))} vs last run`}
              </span>
            </div>
          );
        })}
      </div>
      {(typeof rows === "number" || typeof estimator === "string") && (
        <p className="metric-caption">
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
