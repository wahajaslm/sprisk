import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { useNotebooks, useSaveNotebook } from "../../api/notebooks.ts";
import { operatorSourceQuery, useOperators, usePipelineVersions } from "../../api/hooks.ts";
import { Loading } from "../../components/ui/Loading.tsx";
import { firstVersion, LOCAL_PROJECT, newCellId } from "../../notebook/document.ts";
import { flowNotebooks } from "../../notebook/fromFlow.ts";
import { isCodeOperator } from "../../flow/edit.ts";
import { flowOf, flows } from "../../flow/flows.ts";
import { useSelection } from "../../workbench/selection.ts";
import { AddIcon } from "../Icons.tsx";
import { NotebookList } from "./NotebookList.tsx";
import { SessionNotebook } from "./SessionNotebook.tsx";

/** The Notebooks page (ADR-0018, ADR-0036): the notebooks of the flow on screen (ADR-0037),
 * and the open one on its kernel. A flow with none gets its own, once (ADR-0054). */
export function NotebooksPage() {
  const notebooks = useNotebooks();
  const versions = usePipelineVersions();
  const operators = useOperators();
  const save = useSaveNotebook();
  const openId = useSelection((s) => s.notebookId);
  const stageTarget = useSelection((s) => s.stageTarget);
  const openNotebook = useSelection((s) => s.openNotebook);
  const pipelineVersionId = useSelection((s) => s.pipelineVersionId);
  const flow = flowOf(flows(versions.data ?? []), pipelineVersionId);
  const client = useQueryClient();
  const made = useRef(new Set<string>());
  const [problem, setProblem] = useState<string>();

  /** The flow's notebooks, each built-in step with its operator's code, read only now. */
  const createFromFlow = async () => {
    if (!flow?.head) return;
    setProblem(undefined);
    const byRef = new Map((operators.data ?? []).map((op) => [op.id, op]));
    const builtIns = [...new Set(flow.head.nodes.filter((n) => !isCodeOperator(n.operator)).map((n) => n.operator))];
    try {
      const code = await Promise.all(builtIns.map((ref) => client.fetchQuery(operatorSourceQuery(ref))));
      const made = flowNotebooks(flow.head, byRef, new Map(code.map((s) => [s.operator, s])));
      const saved = await Promise.all(
        made.map(({ title, cells }) =>
          save.mutateAsync(firstVersion(flow.head.project_id, title, cells.length > 0 ? cells : [{ id: newCellId(), kind: "code", source: "" }], flow.head.id)),
        ),
      );
      if (saved[0]) openNotebook(saved[0].notebook_id);
    } catch (e) {
      setProblem(`The flow's notebook was not made: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const ready = flow && notebooks.data && operators.data;
  // A notebook outside any flow is listed here too, and joins the flow when saved.
  const shown = (notebooks.data ?? []).some((v) => v.pipeline_version_id === undefined || flow?.ids.includes(v.pipeline_version_id));
  const headId = flow?.head.id;
  useEffect(() => {
    // Once per flow; the ref also covers React running the effect twice.
    if (!ready || shown || !headId || made.current.has(headId)) return;
    made.current.add(headId);
    void createFromFlow();
    // createFromFlow reads the latest render's flow and operators, which these decide.
  }, [ready, shown, headId]);

  if (notebooks.isError) return <p role="alert" className="error pad">{notebooks.error.message}</p>;
  if (notebooks.isPending || versions.isPending || operators.isPending) return <Loading text="Loading notebooks…" pad />;

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

  return (
    <div className="notebooks-page">
      <nav className="notebooks-list" aria-label="Notebooks">
        <header className="dsx-side-head">
          <p className="eyebrow">Notebooks · {mine.length + loose.length}</p>
          <div className="side-actions">
            <button type="button" className="page-btn" disabled={save.isPending} onClick={create}>
              <AddIcon /> New notebook
            </button>
            {flow?.head && (
              <button type="button" className="page-btn" disabled={save.isPending} onClick={() => void createFromFlow()} title="Generate interactive notebook cells directly from flow DAG nodes">
                <AddIcon /> Sync from flow
              </button>
            )}
          </div>
        </header>
        {save.error && <p role="alert" className="error">{save.error.message}</p>}
        {problem && <p role="alert" className="error">{problem}</p>}
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
