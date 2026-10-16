import type { Attempt, CodeInterface, Operator, PipelineVersion } from "@sprisk/contracts";

import type { ReactNode } from "react";

import type { Read } from "../../api/code.ts";

import { useOutputs, useTablePage } from "../../api/hooks.ts";
import { PARQUET } from "../../api/media.ts";
import { isCodeOperator } from "../../flow/edit.ts";
import { hasOutputs, latestByNode } from "../../flow/latest.ts";
import { useSelection } from "../../workbench/selection.ts";
import { isFileInput, settingsOf } from "./ParametersTab.tsx";

type Props = { pipeline: PipelineVersion; nodeId: string; operator: Operator | undefined; attempts: Attempt[]; found: Read<CodeInterface> };

/** What a step reads and writes: every port its operator declares, with its kind, where it
 * comes from and how big it is; and, for code, names it reads that nothing defines. */
export function InputsTab({ pipeline, nodeId, operator, attempts, found }: Props) {
  const node = pipeline.nodes.find((n) => n.id === nodeId);
  const incoming = pipeline.edges.filter((e) => e.to.split(".")[0] === nodeId);
  const latest = latestByNode(attempts);
  const mine = latest.get(nodeId);
  // Declared ports first; an edge to a port the manifest does not list still shows.
  const declared = operator?.inputs ?? [];
  const extra = incoming.map((e) => e.to.split(".")[1] ?? "").filter((p) => !declared.some((d) => d.name === p));
  const inputs = [...declared.map((d) => ({ name: d.name, kind: d.kind as string })), ...extra.map((name) => ({ name, kind: "" }))];
  // Files are inputs (ADR-0025): a built-in step's path settings, a code step's file reads.
  const pathFiles = operator ? settingsOf(operator.params_schema).filter(isFileInput) : [];
  const codeFiles = found.status === "ready" ? (found.value.files ?? []) : [];
  const files = [
    ...pathFiles.map((f) => ({ name: f.name, path: String(node?.params[f.name] ?? "not set"), how: "" })),
    ...codeFiles.map((f) => ({ name: f.path.split("/").at(-1) ?? f.path, path: f.path, how: `${f.reader}, line ${f.line}` })),
  ];
  return (
    <div className="inputs-tab">
      <section className="input-tables" aria-label="Input tables">
        <p className="output-title">Inputs</p>
        {files.length > 0 && (
          <ul className="input-list">
            {files.map((f) => (
              <PortRow key={`${f.name}:${f.path}`} name={f.name} kind="file">
                <span className="input-arrow" aria-hidden="true">←</span>
                <span className="input-file">{f.path === f.name ? "" : f.path}</span>
                <span className="input-size">{f.how}</span>
              </PortRow>
            ))}
          </ul>
        )}
        {inputs.length === 0 && files.length === 0 ? (
          <p className="muted">This step reads no other step. It starts the flow.</p>
        ) : (
          <ul className="input-list">
            {inputs.map((input) => {
              const edge = incoming.find((e) => e.to.split(".")[1] === input.name);
              const [from = "", fromPort = ""] = edge?.from.split(".") ?? [];
              const producer = latest.get(from);
              return (
                <PortRow key={input.name} name={input.name} kind={input.kind}>
                  {edge ? (
                    <>
                      <span className="input-arrow" aria-hidden="true">←</span>
                      <SourceButton from={from} fromPort={fromPort} />
                      <ArtifactSize attempt={hasOutputs(producer) ? producer : undefined} port={fromPort} />
                    </>
                  ) : (
                    <span className="error">not connected</span>
                  )}
                </PortRow>
              );
            })}
          </ul>
        )}
      </section>
      {operator && operator.outputs.length > 0 && (
        <section className="input-tables" aria-label="Outputs">
          <p className="output-title">Outputs</p>
          <ul className="input-list">
            {operator.outputs.map((o) => (
              <PortRow key={o.name} name={o.name} kind={o.kind}>
                <span className="input-arrow" aria-hidden="true">→</span>
                <span />
                <ArtifactSize attempt={hasOutputs(mine) ? mine : undefined} port={o.name} />
              </PortRow>
            ))}
          </ul>
        </section>
      )}
      {node && isCodeOperator(node.operator) && <UnboundNames found={found} />}
    </div>
  );
}

function PortRow({ name, kind, children }: { name: string; kind: string; children: ReactNode }) {
  return (
    <li className="input-row">
      <span className="input-port">{name}</span>
      <span className="input-kind">{kind}</span>
      {children}
    </li>
  );
}

function SourceButton({ from, fromPort }: { from: string; fromPort: string }) {
  const select = useSelection((s) => s.selectNode);
  return (
    <button type="button" className="input-source" onClick={() => select(from)}>
      {from}.{fromPort}
    </button>
  );
}

/** Rows × columns of a table, or what kind of thing it is, once the producing step has run. */
function ArtifactSize({ attempt, port }: { attempt: Attempt | undefined; port: string }) {
  const outputs = useOutputs(attempt?.id);
  const artifact = outputs.data?.find((o) => o.port === port)?.artifact;
  const page = useTablePage(artifact?.media_type === PARQUET ? artifact.id : undefined, 0, 1);
  const size = artifact?.media_type !== PARQUET ? undefined : page.data;
  return (
    <span className="input-size">
      {!attempt
        ? "not run yet"
        : size
          ? `${size.total_rows} rows × ${size.total_columns} cols`
          : artifact?.media_type === "application/vnd.skops"
            ? "fitted model"
            : artifact
              ? "saved"
              : "…"}
    </span>
  );
}

function UnboundNames({ found }: { found: Read<CodeInterface> }) {
  if (found.status === "error") return <p role="alert" className="error">{found.message}</p>;
  if (found.status !== "ready") return null;
  const unbound = found.value.inputs.filter((i) => !i.bound);
  return (
    <section className="found" aria-label="Names read by the code">
      <p className="found-label">Names the code reads</p>
      <ul className="found-list">
        {found.value.inputs.map((i) => (
          <li key={i.name} className={i.bound ? "found-value" : "found-unbound"}>
            <span className="mono">{i.name}</span>{" "}
            {i.bound ? (
              <span className="found-meta">the input table</span>
            ) : (
              <span className="error">nothing defines it; the code fails if it reaches it</span>
            )}
          </li>
        ))}
      </ul>
      {unbound.length === 0 && found.value.inputs.length === 0 && <p className="muted">The code reads no outside names.</p>}
    </section>
  );
}
