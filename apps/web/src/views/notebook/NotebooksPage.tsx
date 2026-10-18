import { useNotebooks, useSaveNotebook } from "../../api/notebooks.ts";
import { usePipelineVersions } from "../../api/hooks.ts";
import { Loading } from "../../components/ui/Loading.tsx";
import { firstVersion, LOCAL_PROJECT, newCellId } from "../../notebook/document.ts";
import { flowOf, flows } from "../../flow/flows.ts";
import { useSelection } from "../../workbench/selection.ts";
import { AddIcon } from "../Icons.tsx";
import { NotebookList } from "./NotebookList.tsx";
import { SessionNotebook } from "./SessionNotebook.tsx";

/** The Notebooks page (ADR-0018, ADR-0036): the notebooks of the flow on screen (ADR-0037),
 * and the open one on its kernel. */
export function NotebooksPage() {
  const notebooks = useNotebooks();
  const versions = usePipelineVersions();
  const save = useSaveNotebook();
  const openId = useSelection((s) => s.notebookId);
  const openNotebook = useSelection((s) => s.openNotebook);
  const pipelineVersionId = useSelection((s) => s.pipelineVersionId);
  if (notebooks.isError) return <p role="alert" className="error pad">{notebooks.error.message}</p>;
  if (notebooks.isPending || versions.isPending) return <Loading text="Loading notebooks…" pad />;
  const flow = flowOf(flows(versions.data ?? []), pipelineVersionId);
  // With no flow yet, the notebooks not in one; otherwise those of this flow's versions.
  const mine = notebooks.data.filter((v) => (flow ? v.pipeline_version_id !== undefined && flow.ids.includes(v.pipeline_version_id) : v.pipeline_version_id === undefined));
  // Made before notebooks belonged to flows: shown apart; saving one adds it to this flow.
  const loose = flow ? notebooks.data.filter((v) => v.pipeline_version_id === undefined) : [];
  const open = [...mine, ...loose].find((v) => v.notebook_id === openId) ?? mine[0];
  const create = () => {
    const projectId = flow?.head.project_id ?? LOCAL_PROJECT;
    const version = firstVersion(projectId, `Notebook ${mine.length + 1}`, [{ id: newCellId(), kind: "code", source: "" }], flow?.head.id);
    save.mutate(version, { onSuccess: (saved) => openNotebook(saved.notebook_id) });
  };

  return (
    <div className="notebooks-page">
      <nav className="notebooks-list" aria-label="Notebooks">
        <button type="button" className="page-btn" disabled={save.isPending} onClick={create}>
          <AddIcon /> New notebook
        </button>
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
        <p className="muted pad">This flow has no notebooks yet. Make one, or import a .ipynb.</p>
      )}
    </div>
  );
}
