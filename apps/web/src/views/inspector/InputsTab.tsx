import type { Attempt, CodeInterface, PipelineVersion } from "@sprisk/contracts";

import type { Read } from "../../api/code.ts";

import { useOutputs, useTablePage } from "../../api/hooks.ts";
import { PARQUET } from "../../api/media.ts";
import { isCodeOperator } from "../../flow/edit.ts";
import { hasOutputs, latestByNode } from "../../flow/latest.ts";
import { useSelection } from "../../workbench/selection.ts";

type Props = { pipeline: PipelineVersion; nodeId: string; attempts: Attempt[]; found: Read<CodeInterface> };

/** What a step reads: tables from other steps, and names its code reads but nothing defines. */
export function InputsTab({ pipeline, nodeId, attempts, found }: Props) {
  const node = pipeline.nodes.find((n) => n.id === nodeId);
  const incoming = pipeline.edges.filter((e) => e.to.split(".")[0] === nodeId);
  const latest = latestByNode(attempts);
  return (
    <div className="inputs-tab">
      <section className="input-tables" aria-label="Input tables">
        <p className="output-title">Input tables</p>
        {incoming.length === 0 ? (
          <p className="muted">This step reads no other step. It starts the flow.</p>
        ) : (
          <ul className="input-list">
            {incoming.map((e) => {
              const [from = "", port = ""] = e.from.split(".");
              const producer = latest.get(from);
              return (
                <InputRow
                  key={e.to}
                  port={e.to.split(".")[1] ?? ""}
                  from={from}
                  fromPort={port}
                  attempt={hasOutputs(producer) ? producer : undefined}
                />
              );
            })}
          </ul>
        )}
      </section>
      {node && isCodeOperator(node.operator) && <UnboundNames found={found} />}
    </div>
  );
}

function InputRow({ port, from, fromPort, attempt }: { port: string; from: string; fromPort: string; attempt: Attempt | undefined }) {
  const select = useSelection((s) => s.selectNode);
  const outputs = useOutputs(attempt?.id);
  const artifact = outputs.data?.find((o) => o.port === fromPort)?.artifact;
  const page = useTablePage(artifact?.media_type === PARQUET ? artifact.id : undefined, 0, 1);
  const size = artifact?.media_type !== PARQUET ? undefined : page.data;
  return (
    <li className="input-row">
      <span className="input-port">{port}</span>
      <span className="input-arrow" aria-hidden="true">←</span>
      <button type="button" className="input-source" onClick={() => select(from)}>
        {from}.{fromPort}
      </button>
      <span className="input-size">
        {!attempt
          ? "not run yet"
          : size
            ? `${size.total_rows} rows × ${size.total_columns} cols`
            : artifact?.media_type === "application/vnd.skops"
              ? "fitted model"
              : artifact
                ? ""
                : "…"}
      </span>
    </li>
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
