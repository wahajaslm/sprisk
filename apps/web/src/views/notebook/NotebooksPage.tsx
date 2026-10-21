import { useNotebooks, useSaveNotebook } from "../../api/notebooks.ts";
import { useOperators, usePipelineVersions } from "../../api/hooks.ts";
import { Loading } from "../../components/ui/Loading.tsx";
import { firstVersion, LOCAL_PROJECT, newCellId } from "../../notebook/document.ts";
import { stageNotebooks } from "../../notebook/stageNotebooks.ts";
import { flowOf, flows } from "../../flow/flows.ts";
import { useSelection } from "../../workbench/selection.ts";
import { AddIcon } from "../Icons.tsx";
import { StageNotebook } from "./StageNotebook.tsx";
import { NotebookList } from "./NotebookList.tsx";
import { SessionNotebook } from "./SessionNotebook.tsx";

/** The Notebooks page (ADR-0018, ADR-0055): the flow on screen as one notebook per stage,
 * read from the flow itself, then notebooks saved on their own (ADR-0036, ADR-0037). */
export function NotebooksPage() {
  const notebooks = useNotebooks();
  const versions = usePipelineVersions();
  const operators = useOperators();
  const save = useSaveNotebook();
  const openId = useSelection((s) => s.notebookId);
  const stageTarget = useSelection((s) => s.stageTarget);
  const openNotebook = useSelection((s) => s.openNotebook);
  const openStage = useSelection((s) => s.openStageNotebook);
  const pipelineVersionId = useSelection((s) => s.pipelineVersionId);
  const flow = flowOf(flows(versions.data ?? []), pipelineVersionId);
  // The version on screen, as the canvas shows it; the newest when none is picked.
  const shownFlow = (versions.data ?? []).find((v) => v.id === pipelineVersionId) ?? flow?.head;

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
  const stages = shownFlow ? stageNotebooks(shownFlow, new Map((operators.data ?? []).map((o) => [o.id, o]))) : [];
  const saved = openId ? [...mine, ...loose].find((v) => v.notebook_id === openId) : undefined;
  // A stage the canvas asked for, else a saved notebook picked here, else the first stage.
  const stageOpen = stages.find((s) => s.stage === stageTarget)?.stage ?? (saved ? undefined : stages[0]?.stage);
  const open = stageOpen ? undefined : (saved ?? mine[0] ?? loose[0]);

  const create = () => {
    const projectId = flow?.head.project_id ?? LOCAL_PROJECT;
    const version = firstVersion(projectId, `Notebook ${mine.length + loose.length + 1}`, [{ id: newCellId(), kind: "code", source: "" }], flow?.head.id);
    save.mutate(version, { onSuccess: (saved) => openNotebook(saved.notebook_id) });
  };

  return (
    <div className="notebooks-page">
      <nav className="notebooks-list" aria-label="Notebooks">
        <header className="dsx-side-head">
          <p className="eyebrow">Notebooks</p>
          <div className="side-actions">
            <button type="button" className="page-btn" disabled={save.isPending} onClick={create}>
              <AddIcon /> New notebook
            </button>
          </div>
        </header>
        {save.error && <p role="alert" className="error">{save.error.message}</p>}
        {stages.length > 0 && (
          <>
            <p className="notebooks-heading">Stages</p>
            <ul aria-label="This flow's stages">
              {stages.map(({ stage, nodes }) => (
                <li key={stage} className="nb-item">
                  <button type="button" className="nb-item-open" aria-current={stage === stageOpen} onClick={() => openStage(stage)}>
                    {stage} <span className="muted">· {nodes.length === 1 ? "1 step" : `${nodes.length} steps`}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        {mine.length > 0 && <p className="notebooks-heading">Saved notebooks</p>}
        <NotebookList label="This flow's notebooks" notebooks={mine} open={open?.notebook_id} flow={flow?.head} onOpen={openNotebook} />
        {loose.length > 0 && (
          <>
            <p className="notebooks-heading">Not in a flow yet</p>
            <NotebookList label="Not in a flow yet" notebooks={loose} open={open?.notebook_id} flow={flow?.head} onOpen={openNotebook} />
          </>
        )}
      </nav>
      {stageOpen && shownFlow ? (
        <StageNotebook key={`${shownFlow.id}/${stageOpen}`} pipeline={shownFlow} stage={stageOpen} />
      ) : open ? (
        <SessionNotebook key={open.notebook_id} saved={open} flow={flow?.head} />
      ) : (
        <div className="pad muted">
          <p>No open notebook. Make a flow, or start a new notebook.</p>
        </div>
      )}
    </div>
  );
}
