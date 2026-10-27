import type { Attempt, CodeInterface, Operator, PipelineVersion } from "@sprisk/contracts";

import type { ReactNode } from "react";

import type { Read } from "../../api/code.ts";

import { useOutputs, useTablePage } from "../../api/hooks.ts";
import { PARQUET } from "../../api/media.ts";
import { isCodeOperator } from "../../flow/edit.ts";
import { hasOutputs, latestByNode } from "../../flow/latest.ts";
import { namedPorts } from "../../flow/notebook.ts";
import { useSelection } from "../../workbench/selection.ts";
import { isFileInput, settingsOf } from "./ParametersTab.tsx";
import { portOf, stepOf } from "../../flow/ports.ts";

type Props = { pipeline: PipelineVersion; nodeId: string; operator: Operator | undefined; attempts: Attempt[]; found: Read<CodeInterface> };

/** What a step reads and writes: every port its operator declares, with its kind, where it
 * comes from and how big it is; and, for code, names it reads that nothing defines. */
export function InputsTab({ pipeline, nodeId, operator, attempts, found }: Props) {
  const node = pipeline.nodes.find((n) => n.id === nodeId);
  const incoming = pipeline.edges.filter((e) => stepOf(e.to) === nodeId);
  const latest = latestByNode(attempts);
  const mine = latest.get(nodeId);
  // Declared ports first; an edge to a port the manifest does not list still shows.
  const declared = [
    ...(operator?.inputs ?? []),
    ...namedPorts(operator, node?.params, "input").map((name) => ({ name, kind: "table" as const, optional: false })),
  ];
  const extra = incoming.map((e) => portOf(e.to)).filter((p) => !declared.some((d) => d.name === p));
  const inputs = [
    ...declared.map((d) => ({ name: d.name, kind: d.kind as string, optional: d.optional === true })),
    ...extra.map((name) => ({ name, kind: "", optional: false })),
  ];
  const outputs = [
    ...(operator?.outputs ?? []),
    ...namedPorts(operator, node?.params, "output").map((name) => ({ name, kind: "table" as const })),
  ];
  // Files are inputs (ADR-0025): a built-in step's path settings, a code step's file reads.
  const pathFiles = operator ? settingsOf(operator.params_schema).filter(isFileInput) : [];
  const codeFiles = found.status === "ready" ? (found.value.files ?? []) : [];
  const files = [
    ...pathFiles.map((f) => ({ name: f.name, path: String(node?.params[f.name] ?? "not set"), how: "" })),
    ...codeFiles.map((f) => ({ name: f.path.split("/").at(-1) ?? f.path, path: f.path, how: `${f.reader}, line ${f.line}` })),
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      <section aria-label="Input tables" style={TABLE}>
        {inputs.length === 0 && files.length === 0 ? (
          <p className="muted">This step reads no other step. It starts the pipeline.</p>
        ) : (
          <>
            <Head first="Input" source="Source" />
            <ul style={LIST}>
              {files.map((f) => (
                <PortRow key={`${f.name}:${f.path}`} name={f.name} kind="file" shape={f.how}>
                  <span style={{ ...MONO, color: "var(--t-secondary,#d4d4d4)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.path === f.name ? "" : f.path}</span>
                </PortRow>
              ))}
              {inputs.map((input) => {
                const edge = incoming.find((e) => portOf(e.to) === input.name);
                const [from = "", fromPort = ""] = edge?.from.split(".") ?? [];
                const producer = latest.get(from);
                return (
                  <PortRow key={input.name} name={input.name} kind={input.kind} shape={edge && <ArtifactSize attempt={hasOutputs(producer) ? producer : undefined} port={fromPort} />}>
                    {edge ? (
                      <SourceButton from={from} fromPort={fromPort} />
                    ) : input.optional ? (
                      <span className="muted">optional, not connected</span>
                    ) : (
                      <span className="error">not connected</span>
                    )}
                  </PortRow>
                );
              })}
            </ul>
          </>
        )}
      </section>
      {outputs.length > 0 && (
        <section aria-label="Outputs" style={TABLE}>
          <Head first="Output" source="" />
          <ul style={LIST}>
            {outputs.map((o) => (
              <PortRow key={o.name} name={o.name} kind={o.kind} shape={<ArtifactSize attempt={hasOutputs(mine) ? mine : undefined} port={o.name} />}>
                <span />
              </PortRow>
            ))}
          </ul>
        </section>
      )}
      {node && isCodeOperator(node.operator) && <UnboundNames found={found} />}
    </div>
  );
}

/** The design's Inputs table (main screen): Input · Type · Source · Shape, a 32px header of 12px
 * labels over rows of at least 44px, split by hairlines. */
const COLUMNS = "minmax(0,0.8fr) 90px minmax(0,1.6fr) 140px";
const TABLE = { display: "flex", flexDirection: "column", minWidth: "640px" } as const;
const HEAD = { display: "grid", gridTemplateColumns: COLUMNS, columnGap: "16px", height: "32px", alignItems: "center", fontSize: "12px", color: "var(--t-label,#959595)", borderBottom: "1px solid rgba(var(--ink-rgb,255,255,255),0.09)" } as const;
const ROW = { display: "grid", gridTemplateColumns: COLUMNS, columnGap: "16px", minHeight: "44px", alignItems: "center", fontSize: "13px", borderBottom: "1px solid rgba(var(--ink-rgb,255,255,255),0.05)" } as const;
const LIST = { listStyle: "none", margin: "0", padding: "0" } as const;
const MONO = { fontFamily: "'IBM Plex Mono',monospace", fontSize: "12.5px" } as const;

function Head({ first, source }: { first: string; source: string }) {
  return (
    <div style={HEAD}>
      <span>{first}</span>
      <span>Type</span>
      <span>{source}</span>
      <span>Shape</span>
    </div>
  );
}

function PortRow({ name, kind, shape, children }: { name: string; kind: string; shape: ReactNode; children: ReactNode }) {
  return (
    <li style={ROW}>
      <span style={{ ...MONO, color: "var(--t-primary,#f2f2f2)", minWidth: "0", overflowWrap: "anywhere" }}>{name}</span>
      <span style={{ color: "var(--t-muted,#ababab)" }}>{kind}</span>
      <div style={{ minWidth: "0" }}>{children}</div>
      <span style={{ fontVariantNumeric: "tabular-nums", color: "var(--t-secondary,#d4d4d4)" }}>{shape}</span>
    </li>
  );
}

/** The design's 30px source button; ours goes to the step that makes the input. */
function SourceButton({ from, fromPort }: { from: string; fromPort: string }) {
  const select = useSelection((s) => s.selectNode);
  return (
    <div style={{ position: "relative", minWidth: "0", maxWidth: "280px" }}>
      <button
        type="button"
        className="dx-btn dx-h-08"
        onClick={() => select(from)}
        style={{ width: "100%", height: "30px", padding: "0 8px 0 10px", borderRadius: "var(--r-sm,6px)", background: "rgba(var(--ink-rgb,255,255,255),0.06)", display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", minWidth: "0" }}
      >
        <span style={{ flex: "1", minWidth: "0", fontSize: "13px", color: "var(--t-primary,#f2f2f2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {from}.{fromPort}
        </span>
      </button>
    </div>
  );
}

/** Rows × columns of a table, or what kind of thing it is, once the producing step has run. */
function ArtifactSize({ attempt, port }: { attempt: Attempt | undefined; port: string }) {
  const outputs = useOutputs(attempt?.id);
  const artifact = outputs.data?.find((o) => o.port === port)?.artifact;
  const page = useTablePage(artifact?.media_type === PARQUET ? artifact.id : undefined, 0, 1);
  const size = artifact?.media_type !== PARQUET ? undefined : page.data;
  return (
    <>
      {!attempt
        ? "not run yet"
        : size
          ? `${size.total_rows} rows × ${size.total_columns} cols`
          : artifact?.media_type === "application/vnd.skops"
            ? "fitted model"
            : artifact
              ? "saved"
              : "…"}
    </>
  );
}

function UnboundNames({ found }: { found: Read<CodeInterface> }) {
  if (found.status === "error") return <p role="alert" className="error">{found.message}</p>;
  if (found.status !== "ready") return null;
  return (
    <section aria-label="Names read by the code" style={TABLE}>
      {found.value.inputs.length === 0 ? (
        <p className="muted">The code reads no outside names.</p>
      ) : (
        <>
          <div style={HEAD}>
            <span>Name</span>
            <span style={{ gridColumn: "2 / -1" }}>Defined by</span>
          </div>
          <ul style={LIST}>
            {found.value.inputs.map((i) => (
              <li key={i.name} style={ROW}>
                <span style={{ ...MONO, color: "var(--t-primary,#f2f2f2)" }}>{i.name}</span>
                {i.bound ? (
                  <span style={{ gridColumn: "2 / -1", color: "var(--t-muted,#ababab)" }}>the input table</span>
                ) : (
                  <span className="error" style={{ gridColumn: "2 / -1" }}>nothing defines it; the code fails if it reaches it</span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
