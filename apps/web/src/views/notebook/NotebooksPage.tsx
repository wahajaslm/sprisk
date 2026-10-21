import type { OperatorSource } from "@sprisk/contracts";
import { useEffect, useRef } from "react";

import { useNotebooks, useSaveNotebook } from "../../api/notebooks.ts";
import { useOperators, useOperatorSources, usePipelineVersions } from "../../api/hooks.ts";
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
  const builtIns = [...new Set((flow?.head.nodes ?? []).filter((n) => !isCodeOperator(n.operator)).map((n) => n.operator))];
  const sources = useOperatorSources(builtIns);
  const made = useRef(new Set<string>());

  const createFromFlow = () => {
    if (!flow?.head) return;
    const byRef = new Map((operators.data ?? []).map((op) => [op.id, op]));
    const code = new Map(sources.flatMap((s): [string, OperatorSource][] => (s.data ? [[s.data.operator, s.data]] : [])));
    flowNotebooks(flow.head, byRef, code).forEach(({ title, cells }, i) => {
      const version = firstVersion(flow.head.project_id, title, cells.length > 0 ? cells : [{ id: newCellId(), kind: "code", source: "" }], flow.head.id);
      save.mutate(version, { onSuccess: (saved) => i === 0 && openNotebook(saved.notebook_id) });
    });
  };

  const ready = flow && notebooks.data && operators.data && sources.every((s) => !s.isPending);
  const hasOwn = (notebooks.data ?? []).some((v) => v.pipeline_version_id !== undefined && flow?.ids.includes(v.pipeline_version_id));
  useEffect(() => {
    // Once per flow, also when React runs the effect twice.
    if (!ready || hasOwn || made.current.has(flow.head.id)) return;
    made.current.add(flow.head.id);
    createFromFlow();
  });

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
              <button type="button" className="page-btn" disabled={save.isPending} onClick={createFromFlow} title="Generate interactive notebook cells directly from flow DAG nodes">
                <AddIcon /> Sync from flow
              </button>
            )}
          </div>
        </header>
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
