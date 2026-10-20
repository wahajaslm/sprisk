import { useNotebooks, useSaveNotebook } from "../../api/notebooks.ts";
import { useOperators, usePipelineVersions } from "../../api/hooks.ts";
import { Loading } from "../../components/ui/Loading.tsx";
import { firstVersion, LOCAL_PROJECT, newCellId } from "../../notebook/document.ts";
import { flowOf, flows } from "../../flow/flows.ts";
import { flowName } from "../../flow/labels.ts";
import { notebookSteps } from "../../flow/notebook.ts";
import { STAGES, stageOf } from "../../flow/stages.ts";
import { useSelection } from "../../workbench/selection.ts";
import { AddIcon } from "../Icons.tsx";
import { NotebookList } from "./NotebookList.tsx";
import { SessionNotebook } from "./SessionNotebook.tsx";

/** The Notebooks page (ADR-0018, ADR-0036): the notebooks of the flow on screen (ADR-0037),
 * and the open one on its kernel. */
export function NotebooksPage() {
  const notebooks = useNotebooks();
  const versions = usePipelineVersions();
  const operators = useOperators();
  const save = useSaveNotebook();
  const openId = useSelection((s) => s.notebookId);
  const stageTarget = useSelection((s) => s.stageTarget);
  const openNotebook = useSelection((s) => s.openNotebook);
  const pipelineVersionId = useSelection((s) => s.pipelineVersionId);
  if (notebooks.isError) return <p role="alert" className="error pad">{notebooks.error.message}</p>;
  if (notebooks.isPending || versions.isPending || operators.isPending) return <Loading text="Loading notebooks…" pad />;
  const flow = flowOf(flows(versions.data ?? []), pipelineVersionId);

  // With no flow yet, the notebooks not in one; otherwise those of this flow's versions.
  const mine = (notebooks.data ?? [])
    .filter((v) => (flow ? v.pipeline_version_id !== undefined && flow.ids.includes(v.pipeline_version_id) : v.pipeline_version_id === undefined))
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }));
  // Made before notebooks belonged to flows: shown apart; saving one adds it to this flow.
  const loose = flow
    ? (notebooks.data ?? [])
        .filter((v) => v.pipeline_version_id === undefined)
        .sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }))
    : [];
  const targetNb = stageTarget
    ? [...mine, ...loose].find((v) => v.title.toLowerCase().includes(stageTarget.toLowerCase()))
    : undefined;
  const open = targetNb ?? (openId ? [...mine, ...loose].find((v) => v.notebook_id === openId) : undefined) ?? mine[0] ?? loose[0];

  const create = () => {
    const projectId = flow?.head.project_id ?? LOCAL_PROJECT;
    const version = firstVersion(projectId, `Notebook ${mine.length + loose.length + 1}`, [{ id: newCellId(), kind: "code", source: "" }], flow?.head.id);
    save.mutate(version, { onSuccess: (saved) => openNotebook(saved.notebook_id) });
  };

  const createFromFlow = () => {
    if (!flow?.head) return;
    const byRef = new Map((operators.data ?? []).map((op) => [op.id, op]));
    const steps = notebookSteps(flow.head, byRef);

    // Group steps by their flow stages (Explore, Split, Clean, Model, Evaluate)
    const stageGroups = new Map<string, typeof steps>();
    for (const s of steps) {
      const node = s.nodeId ? flow.head.nodes.find((n) => n.id === s.nodeId) : undefined;
      const op = node ? byRef.get(node.operator) : undefined;
      const stageName = op ? stageOf(op) : "Explore";
      if (!stageGroups.has(stageName)) stageGroups.set(stageName, []);
      stageGroups.get(stageName)!.push(s);
    }

    const presentStages = STAGES.filter((st) => stageGroups.has(st));
    if (presentStages.length > 1) {
      presentStages.forEach((stage, idx) => {
        const stSteps = stageGroups.get(stage) ?? [];
        const cells = stSteps.flatMap((s) => {
          if (s.kind === "builtin") {
            return [{ id: newCellId(), kind: "code" as const, source: s.call }];
          }
          if (s.kind === "code") {
            return [{ id: newCellId(), kind: "code" as const, source: s.source }];
          }
          return s.cells.map((source) => ({ id: newCellId(), kind: "code" as const, source }));
        });
        const num = String(idx + 1).padStart(2, "0");
        const title = `${num}_Stage_${stage}.ipynb`;
        const version = firstVersion(flow.head.project_id, title, cells.length > 0 ? cells : [{ id: newCellId(), kind: "code", source: "" }], flow.head.id);
        save.mutate(version, {
          onSuccess: (saved) => {
            if (idx === 0) openNotebook(saved.notebook_id);
          },
        });
      });
    } else {
      const cells = steps.flatMap((s) => {
        if (s.kind === "builtin") {
          return [{ id: newCellId(), kind: "code" as const, source: s.call }];
        }
        if (s.kind === "code") {
          return [{ id: newCellId(), kind: "code" as const, source: s.source }];
        }
        return s.cells.map((source) => ({ id: newCellId(), kind: "code" as const, source }));
      });
      const title = `${flowName(flow.head)}_flow.ipynb`;
      const version = firstVersion(flow.head.project_id, title, cells.length > 0 ? cells : [{ id: newCellId(), kind: "code", source: "" }], flow.head.id);
      save.mutate(version, { onSuccess: (saved) => openNotebook(saved.notebook_id) });
    }
  };

  return (
    <div className="notebooks-page">
      <nav className="notebooks-list" aria-label="Notebooks">
        <div style={{ display: "flex", gap: "6px", flexDirection: "column" }}>
          <button type="button" className="page-btn" disabled={save.isPending} onClick={create}>
            <AddIcon /> New notebook
          </button>
          {flow?.head && (
            <button type="button" className="page-btn" disabled={save.isPending} onClick={createFromFlow} title="Generate interactive notebook cells directly from flow DAG nodes">
              <AddIcon /> Sync notebook from flow
            </button>
          )}
        </div>
        {save.error && <p role="alert" className="error">{save.error.message}</p>}
        <NotebookList label="This flow's notebooks" notebooks={mine} open={open?.notebook_id} flow={flow?.head} onOpen={openNotebook} />
        {loose.length > 0 && (
          <>
            <p className="notebooks-heading">Not in a flow yet</p>
            <NotebookList label="Not in a flow yet" notebooks={loose} open={open?.notebook_id} flow={flow?.head} onOpen={openNotebook} />
          </>
        )}
      </nav>
      {open ? (
        <SessionNotebook key={open.notebook_id} saved={open} flow={flow?.head} />
      ) : (
        <div className="pad muted">
          <p>No open notebook. Select one from the list or click "Sync notebook from flow" to generate one from the DAG nodes.</p>
        </div>
      )}
    </div>
  );
}
