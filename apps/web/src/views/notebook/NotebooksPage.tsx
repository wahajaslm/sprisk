import { useNotebooks, useSaveNotebook } from "../../api/notebooks.ts";
import { usePipelineVersions } from "../../api/hooks.ts";
import { Loading } from "../../components/ui/Loading.tsx";
import { firstVersion, newCellId } from "../../notebook/document.ts";
import { useSelection } from "../../workbench/selection.ts";
import { AddIcon } from "../Icons.tsx";
import { SessionNotebook } from "./SessionNotebook.tsx";

/** Local mode's one project (the CLI's LOCAL_PROJECT), for a first notebook with no flow yet. */
const LOCAL_PROJECT = "prj_00000000000000000000000000";

/** The Notebooks page (ADR-0018, ADR-0036): saved notebooks, and the open one on its kernel. */
export function NotebooksPage() {
  const notebooks = useNotebooks();
  const versions = usePipelineVersions();
  const save = useSaveNotebook();
  const openId = useSelection((s) => s.notebookId);
  const openNotebook = useSelection((s) => s.openNotebook);
  if (notebooks.isError) return <p role="alert" className="error pad">{notebooks.error.message}</p>;
  if (notebooks.isPending) return <Loading text="Loading notebooks…" pad />;
  const open = notebooks.data.find((v) => v.notebook_id === openId) ?? notebooks.data[0];
  const create = () => {
    const projectId = versions.data?.[0]?.project_id ?? LOCAL_PROJECT;
    const version = firstVersion(projectId, `Notebook ${notebooks.data.length + 1}`, [{ id: newCellId(), kind: "code", source: "" }]);
    save.mutate(version, { onSuccess: (saved) => openNotebook(saved.notebook_id) });
  };

  return (
    <div className="notebooks-page">
      <nav className="notebooks-list" aria-label="Notebooks">
        <button type="button" className="page-btn" disabled={save.isPending} onClick={create}>
          <AddIcon /> New notebook
        </button>
        {save.error && <p role="alert" className="error">{save.error.message}</p>}
        <ul>
          {notebooks.data.map((v) => (
            <li key={v.notebook_id}>
              <button type="button" aria-current={v.notebook_id === open?.notebook_id} onClick={() => openNotebook(v.notebook_id)}>
                {v.title}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      {open ? <SessionNotebook key={open.notebook_id} saved={open} /> : <p className="muted pad">No notebooks yet. Make one, or import a .ipynb.</p>}
    </div>
  );
}
