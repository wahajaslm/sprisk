import type { NotebookCell, NotebookExecution, NotebookVariable, NotebookVersion, PipelineVersion } from "@sprisk/contracts";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { usePipelineVersions, useSavePipelineVersion } from "../../api/hooks.ts";
import { kernelVariables, splitPicked } from "../../api/notebooks.ts";
import { addNode, bindInputs, type Proposal, proposeNode, sessionWarnings } from "../../notebook/node.ts";
import type { Ran } from "../../notebook/outputs.ts";
import { useEscape } from "../../hooks/useEscape.ts";
import { useSelection } from "../../workbench/selection.ts";
import { Loading } from "../../components/ui/Loading.tsx";

type Props = {
  notebookId: string;
  cells: NotebookCell[];
  /** The picked cells, by position in the notebook. */
  range: { first: number; last: number };
  results: Record<string, Ran>;
  /** Saves the notebook if it has edits; the node cites the saved version. */
  saveNotebook: () => Promise<NotebookVersion>;
  onClose: () => void;
};

const NEW_FLOW = "new";

/** Create node from cells (ADR-0036): Python proposes what the picked cells read, set and
 * show; the person confirms or trims it; the flow gets one code node with that contract. */
export function CreateNode({ notebookId, cells, range, results, saveNotebook, onClose }: Props) {
  useEscape(onClose);
  const code = cells.flatMap((cell, at) => (cell.kind === "code" ? [{ cell, at }] : []));
  const picked = code.filter((c) => c.at >= range.first && c.at <= range.last);
  const together = { first: code.indexOf(picked[0]!), last: code.indexOf(picked.at(-1)!) };
  const proposal = useQuery({
    // A picked cell that runs again may change what the kernel holds, so it asks again.
    queryKey: ["create-node", notebookId, code.map((c) => c.cell.source), together, picked.map((c) => results[c.cell.id]?.result.execution_count ?? 0)],
    queryFn: async () => {
      const split = await splitPicked(code.map((c) => c.cell.source), together);
      const found = proposeNode(split, together.first, together.last, (i) => (code[i]?.at ?? i) + 1);
      if ("refused" in found) return found;
      const names = found.proposal.outputs;
      const variables = names.length > 0 ? (await kernelVariables(notebookId, names)).variables : [];
      return { proposal: found.proposal, variables };
    },
    staleTime: Infinity,
    gcTime: 0,
  });

  return (
    <div className="lightbox" onClick={onClose}>
      <section className="import-panel" role="dialog" aria-modal="true" aria-label="Create node" onClick={(e) => e.stopPropagation()}>
        <p className="found-label">
          Create node from {picked.length === 1 ? `cell ${picked[0]!.at + 1}` : `cells ${picked[0]!.at + 1}–${picked.at(-1)!.at + 1}`}
        </p>
        {proposal.isPending && <Loading text="Reading the cells…" />}
        {proposal.isError && <p role="alert" className="error">{proposal.error.message}</p>}
        {proposal.data && "refused" in proposal.data && <p role="alert" className="error">{proposal.data.refused}</p>}
        {proposal.data && "proposal" in proposal.data && (
          <Confirm
            proposal={proposal.data.proposal}
            variables={proposal.data.variables}
            shown={picked.flatMap((c) => results[c.cell.id]?.result.outputs ?? [])}
            warnings={sessionWarnings(cells, range.first, range.last, results, (i) => i + 1)}
            cellIds={picked.map((c) => c.cell.id)}
            saveNotebook={saveNotebook}
            onClose={onClose}
          />
        )}
        {!(proposal.data && "proposal" in proposal.data) && (
          <div className="settings-actions">
            <span className="spacer" />
            <button type="button" className="page-btn" onClick={onClose}>
              Close
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

type ConfirmProps = {
  proposal: Proposal;
  warnings: string[];
  variables: NotebookVariable[];
  shown: NotebookExecution["outputs"];
  cellIds: string[];
  saveNotebook: () => Promise<NotebookVersion>;
  onClose: () => void;
};

function Confirm({ proposal, warnings, variables, shown, cellIds, saveNotebook, onClose }: ConfirmProps) {
  const kindOf = new Map(variables.map((v) => [v.name, v]));
  // Only tables cross a node boundary today; a value of another kind cannot be passed on.
  const blocked = (name: string) => {
    const found = kindOf.get(name);
    return found?.defined === true && !found.table;
  };
  const [outputs, setOutputs] = useState(() => new Set(proposal.outputs.filter((o) => !blocked(o))));
  const [exposed, setExposed] = useState(() => new Set<string>());
  const [nodeId, setNodeId] = useState(() => proposal.outputs.find((o) => !blocked(o)) ?? "notebook_node");
  const versions = usePipelineVersions();
  const onScreen = useSelection((s) => s.pipelineVersionId);
  const flow = versions.data?.find((v) => v.id === onScreen) ?? versions.data?.[0];
  const [target, setTarget] = useState<string | undefined>();
  const chosen = target ?? flow?.id ?? NEW_FLOW;
  const savePipeline = useSavePipelineVersion();
  const [problem, setProblem] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const toggle = (set: Set<string>, name: string) => {
    const next = new Set(set);
    if (!next.delete(name)) next.add(name);
    return next;
  };
  const create = async () => {
    setProblem(undefined);
    setBusy(true);
    try {
      const notebook = await saveNotebook();
      const base = chosen === NEW_FLOW ? undefined : flow;
      const done = addNode({
        base,
        projectId: base?.project_id ?? notebook.project_id,
        proposal,
        nodeId,
        outputs: [...outputs],
        parameters: [...exposed],
        from: { notebook_version_id: notebook.id, cells: cellIds },
      });
      if ("refused" in done) {
        setProblem(done.refused);
        return;
      }
      await savePipeline.mutateAsync(done.version);
      const { selectPipelineVersion, selectNode, setNav } = useSelection.getState();
      selectPipelineVersion(done.version.id);
      selectNode(nodeId);
      setNav("Flow");
      onClose();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <label className="node-field">
        Node name
        <input aria-label="Node name" value={nodeId} onChange={(e) => setNodeId(e.target.value)} />
      </label>
      <label className="node-field">
        Add to
        <select aria-label="Add to" value={chosen} onChange={(e) => setTarget(e.target.value)}>
          {flow && (
            <option value={flow.id}>
              {flow.id === onScreen ? "The flow on screen" : "The latest flow"} ({flow.nodes.length} steps)
            </option>
          )}
          <option value={NEW_FLOW}>A new flow</option>
        </select>
      </label>
      {[...warnings, ...proposal.notes].map((w) => (
        <p key={w} className="import-note">
          {w}
        </p>
      ))}
      <section className="node-contract" aria-label="Contract">
        <h3>Inputs</h3>
        <Inputs base={chosen === NEW_FLOW ? undefined : flow} inputs={proposal.inputs} />
        <h3>Parameters</h3>
        {proposal.parameters.length === 0 ? (
          <p className="muted">None.</p>
        ) : (
          proposal.parameters.map((p) => (
            <label key={p.name} className="node-check">
              <input type="checkbox" checked={exposed.has(p.name)} onChange={() => setExposed(toggle(exposed, p.name))} />
              <span className="mono">{`${p.name} = ${JSON.stringify(p.value)}`}</span>
            </label>
          ))
        )}
        <h3>Outputs</h3>
        {proposal.outputs.length === 0 ? (
          <p className="muted">None: no later cell reads a value these cells set.</p>
        ) : (
          proposal.outputs.map((name) => (
            <div key={name}>
              <label className="node-check">
                <input type="checkbox" disabled={blocked(name)} checked={outputs.has(name)} onChange={() => setOutputs(toggle(outputs, name))} />
                <span className="mono">{name}</span>
              </label>
              <OutputNote variable={kindOf.get(name)} />
            </div>
          ))
        )}
        <h3>Displays</h3>
        <p className="muted">{describeShown(shown)}</p>
      </section>
      <details>
        <summary className="menu-meta">Code</summary>
        <pre className="code">{proposal.source}</pre>
      </details>
      {problem && <p role="alert" className="error">{problem}</p>}
      <div className="settings-actions">
        <button type="button" className="page-btn" onClick={onClose}>
          Cancel
        </button>
        <span className="spacer" />
        <button type="button" className="run-code" disabled={busy || nodeId === ""} onClick={() => void create()}>
          {busy ? "Creating…" : "Create node"}
        </button>
      </div>
    </>
  );
}

/** Each input and the step of the flow that will give it to the node, or why none can. */
function Inputs({ base, inputs }: { base: PipelineVersion | undefined; inputs: string[] }) {
  if (inputs.length === 0) return <p className="muted">None: the cells read no table from earlier cells.</p>;
  const bound = bindInputs(base, inputs);
  if ("refused" in bound) return <p className="error">{bound.refused}</p>;
  return (
    <ul>
      {bound.links.map((l) => (
        <li key={l.name} className="mono">
          {l.name} ← {l.from}
        </li>
      ))}
    </ul>
  );
}

function OutputNote({ variable }: { variable: NotebookVariable | undefined }) {
  if (!variable || !variable.defined) return <p className="muted node-note">Not run yet; its kind is checked when the node runs.</p>;
  if (variable.table) return null;
  return (
    <p className="error node-note">
      {variable.name} is a {variable.type}, not a table. Only tables cross a node boundary today: keep the cells that use it in this node.
    </p>
  );
}

function describeShown(items: NotebookExecution["outputs"]) {
  const count = (kind: string) => items.filter((i) => i.kind === kind).length;
  const parts = [
    count("table") && `${count("table")} table${count("table") > 1 ? "s" : ""}`,
    count("figure") + count("image") && `${count("figure") + count("image")} figure${count("figure") + count("image") > 1 ? "s" : ""}`,
    count("text") && "printed text",
  ].filter(Boolean);
  return parts.length === 0 ? "Nothing shown yet. Run the cells to see what the node will show." : `The node shows what the cells show: ${parts.join(", ")}.`;
}
