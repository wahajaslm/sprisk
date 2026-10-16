import type { Attempt, AttemptOutput, MethodologyCheck } from "@sprisk/contracts";
import { parse } from "@sprisk/contracts";
import * as Tabs from "@radix-ui/react-tabs";

import { useArtifactText, useOutputs, usePipelineVersions, useRunAttempts, useSaveAndRun } from "../api/hooks.ts";
import { MAX_INLINE_BYTES, PARQUET } from "../api/media.ts";
import { GATE_NODE, latestByNode } from "../flow/latest.ts";
import { useViewInstance, useViewSelection } from "../workbench/instance.tsx";
import { PinIcon } from "./Icons.tsx";
import { addCodeStep, isCodeOperator } from "../flow/edit.ts";
import { useSelection } from "../workbench/selection.ts";
import { CodeEditor } from "./CodeEditor.tsx";
import { CodeOutput } from "./CodeOutput.tsx";
import { ColumnProfile } from "./ColumnProfile.tsx";
import { TablePeek } from "./TablePeek.tsx";
import { isProfileOperator, shortName } from "../flow/stages.ts";


export function Inspector() {
  const { pipelineVersionId, runId, nodeId } = useViewSelection();
  const { pin, setPin } = useViewInstance();
  const versions = usePipelineVersions();
  const attempts = useRunAttempts(pipelineVersionId, runId);
  const pipeline = versions.data?.find((v) => v.id === pipelineVersionId);
  const node = pipeline?.nodes.find((n) => n.id === nodeId);
  const saveAndRun = useSaveAndRun();
  const showRun = useSelection((s) => s.showRun);
  const explore =
    pipeline && nodeId
      ? (port: string) => {
          const { version, nodeId: codeNode } = addCodeStep(pipeline, nodeId, port);
          saveAndRun.mutate(version, { onSuccess: (r) => showRun(version.id, r.id, codeNode) });
        }
      : undefined;

  if (!nodeId) return <p className="muted pad">Select a step to see its decision, data, code or logs.</p>;
  const all = attempts.data ?? [];
  const ofNode = all.filter((a) => a.node_id === nodeId).sort((a, b) => a.number - b.number);
  const latest = latestByNode(ofNode).get(nodeId);
  const gate = latestByNode(all).get(GATE_NODE);

  return (
    <Tabs.Root className="inspector" defaultValue="data">
      <div className="panel-head">
        <Tabs.List className="tabs" aria-label="Inspector">
          <Tabs.Trigger value="decision">Decision</Tabs.Trigger>
          <Tabs.Trigger value="code">Code</Tabs.Trigger>
          <Tabs.Trigger value="data">Data</Tabs.Trigger>
          <Tabs.Trigger value="logs">Logs</Tabs.Trigger>
        </Tabs.List>
        <span className="sel-label">{nodeId}</span>
        <span className="sel-meta">
          {node ? shortName(node.operator) : ""} · {attempts.isPending && runId ? "loading" : (latest?.state ?? "not run")}
          {pin ? ` · run ${pin.runId.slice(-8)}` : ""}
        </span>
        <span className="spacer" />
        {setPin && runId && (
          <button
            type="button"
            className={`pin${pin ? " on" : ""}`}
            aria-pressed={pin !== undefined}
            title={pin ? "Unpin: follow the selection again" : "Pin this panel to this run and step"}
            onClick={() => setPin(pin ? undefined : { runId, nodeId })}
          >
            <PinIcon />
            {pin ? "Pinned" : "Pin"}
          </button>
        )}
      </div>
      {attempts.isError && <p role="alert" className="error pad">{attempts.error.message}</p>}
      {versions.isError && <p role="alert" className="error pad">{versions.error.message}</p>}
      <Tabs.Content value="decision" className="pane single">
        <p className="placeholder-note">
          Decisions (question, choices, recommended choice, evidence) come with the methodology decision graph
          (ADR-0019). This step currently runs with fixed settings.
        </p>
      </Tabs.Content>
      <Tabs.Content value="code" className="pane single">
        {pipeline && node && isCodeOperator(node.operator) && typeof node.params.source === "string" ? (
          <CodeEditor key={`${pipeline.id}/${node.id}`} pipeline={pipeline} nodeId={node.id} source={node.params.source} />
        ) : (
          <>
            <p className="section-label">Runs as · {node?.operator ?? "unknown"}</p>
            <pre className="code">{JSON.stringify(node?.params ?? {}, null, 2)}</pre>
          </>
        )}
      </Tabs.Content>
      <Tabs.Content value="data" className="pane columns">
        <div>
          <p className="section-label">Methodology checks</p>
          <Checks gate={gate} nodeId={nodeId} />
        </div>
        <div>
          <p className="section-label">Outputs</p>
          {saveAndRun.isError && <p role="alert" className="error">{saveAndRun.error.message}</p>}
          <Outputs
            attempt={latest?.state === "succeeded" ? latest : undefined}
            operator={node?.operator}
            explore={saveAndRun.isPending ? undefined : explore}
          />
        </div>
      </Tabs.Content>
      <Tabs.Content value="logs" className="pane single">
        <ol className="log">
          {ofNode.map((a) => (
            <li key={a.id} className={`state-${a.state}`}>
              <span className="mono">#{a.number}</span> {a.state}
              {a.error && <span className="error"> · {a.error.code}: {a.error.message}</span>}
            </li>
          ))}
        </ol>
      </Tabs.Content>
    </Tabs.Root>
  );
}

type Explore = ((port: string) => void) | undefined;

function Outputs({ attempt, operator, explore }: { attempt: Attempt | undefined; operator: string | undefined; explore: Explore }) {
  const outputs = useOutputs(attempt?.id);
  if (!attempt) return <p className="muted">No successful attempt yet.</p>;
  if (outputs.isPending) return <p className="muted">Loading outputs…</p>;
  if (outputs.isError) return <p role="alert" className="error">{outputs.error.message}</p>;
  if (outputs.data.length === 0) return <p className="muted">This step committed no outputs.</p>;
  return (
    <div className="outputs">
      {outputs.data.map((o) => (
        <Output key={o.port} output={o} view={viewOf(o, operator)} explore={explore} />
      ))}
    </div>
  );
}

type OutputView = "code" | "profile" | "table" | "json" | "other";

function viewOf(output: AttemptOutput, operator: string | undefined): OutputView {
  if (isCodeOperator(operator) && output.port === "display") return "code";
  if (isProfileOperator(operator) && output.port === "profile") return "profile";
  if (output.artifact.media_type === PARQUET) return "table";
  if (output.artifact.media_type === "application/json") return "json";
  return "other";
}

/** Code output carries figures, so it may be larger than other JSON; still capped (rule 9). */
const MAX_CODE_DISPLAY_BYTES = 4 * 1024 * 1024;

function Output({ output, view, explore }: { output: AttemptOutput; view: OutputView; explore: Explore }) {
  const isJson = view === "json";
  const small = output.artifact.size_bytes <= MAX_INLINE_BYTES;
  const text = useArtifactText(isJson && small ? output.artifact.id : undefined);
  return (
    <section className="output">
      <div className="output-head">
        <p className="section-label">
          {output.port} · {output.artifact.media_type} · {output.artifact.size_bytes} bytes
        </p>
        {view === "table" && explore && (
          <button type="button" className="page-btn" aria-label={`Explore ${output.port} in code`} onClick={() => explore(output.port)}>
            Explore in code
          </button>
        )}
      </div>
      {view === "code" ? (
        output.artifact.size_bytes > MAX_CODE_DISPLAY_BYTES ? (
          <p className="muted">Code output too large to show here ({output.artifact.size_bytes} bytes).</p>
        ) : (
          <CodeOutput artifactId={output.artifact.id} />
        )
      ) : isJson && !small ? (
        <p className="muted">JSON output too large to show here ({output.artifact.size_bytes} bytes).</p>
      ) : isJson ? (
        text.isError ? <p role="alert" className="error">{text.error.message}</p> : <pre className="code">{prettyJson(text.data)}</pre>
      ) : view === "profile" ? (
        <ColumnProfile artifactId={output.artifact.id} />
      ) : view === "table" ? (
        <TablePeek artifactId={output.artifact.id} port={output.port} />
      ) : (
        <p className="mono muted">{output.artifact.content_hash.slice(0, 19)}…</p>
      )}
    </section>
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

/** Methodology checks from the run's gate that cite this step (ADR-0017). */
function Checks({ gate, nodeId }: { gate: Attempt | undefined; nodeId: string }) {
  const outputs = useOutputs(gate?.state === "succeeded" ? gate.id : undefined);
  const checksArtifact = outputs.data?.find((o) => o.port === "checks")?.artifact.id;
  const text = useArtifactText(checksArtifact);
  if (outputs.isError) return <p role="alert" className="error">{outputs.error.message}</p>;
  if (text.isError) return <p role="alert" className="error">{text.error.message}</p>;
  if (!gate || gate.state !== "succeeded") return <p className="muted">No methodology run for this flow yet.</p>;
  if (!text.data) return <p className="muted">Loading…</p>;
  let checks: MethodologyCheck[];
  try {
    const raw: unknown = JSON.parse(text.data);
    if (!Array.isArray(raw)) throw new Error("expected a list of checks");
    checks = raw.map((c) => parse("MethodologyCheck", c));
  } catch (e) {
    return <p role="alert" className="error">Unreadable methodology checks: {e instanceof Error ? e.message : "invalid"}</p>;
  }
  const mine = checks.filter((c) => c.cited_nodes.includes(nodeId));
  if (mine.length === 0) return <p className="muted">No methodology check concerns this step.</p>;
  return (
    <section className="checks" aria-label="Methodology checks">
      {mine.map((c) => (
        <p key={c.id} className={`check ${c.verdict}`}>
          <span className="check-mark" aria-label={c.verdict.replace("_", " ")}>
            {c.verdict === "pass" ? "✓" : c.verdict === "fail" ? "✕" : "!"}
          </span>
          <span>{c.rationale}</span>
        </p>
      ))}
    </section>
  );
}
