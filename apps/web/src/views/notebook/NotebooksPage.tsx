import { useState } from "react";

import { useNotebooks, useSaveNotebook } from "../../api/notebooks.ts";
import { useOperators, usePipelineVersions } from "../../api/hooks.ts";
import { Loading } from "../../components/ui/Loading.tsx";
import { firstVersion, LOCAL_PROJECT, newCellId } from "../../notebook/document.ts";
import { stageNotebooks } from "../../notebook/stageNotebooks.ts";
import { flowOf, flows } from "../../flow/flows.ts";
import { useSelection } from "../../workbench/selection.ts";
import { useWorkbench } from "../../workbench/workbench.ts";
import { Button } from "../../components/ui/Button.tsx";
import { InfoDock } from "../../components/ui/InfoDock.tsx";
import { SearchField } from "../../components/ui/SearchField.tsx";
import { SectionLabel } from "../../components/ui/SectionLabel.tsx";
import { Sidebar } from "../../components/ui/Sidebar.tsx";
import { flowName } from "../../flow/labels.ts";
import { StageNotebook } from "./StageNotebook.tsx";
import { NotebookList } from "./NotebookList.tsx";
import { SessionNotebook } from "./SessionNotebook.tsx";

/** The Notebooks page (ADR-0018, ADR-0055, ADR-0061): the flow on screen as one notebook per stage,
 * read from the flow itself, then notebooks saved on their own (ADR-0036, ADR-0037). */
export function NotebooksPage() {
  const notebooks = useNotebooks();
  const versions = usePipelineVersions();
  const operators = useOperators();
  const save = useSaveNotebook();
  const sidebarOpen = useWorkbench((s) => s.sidebarOpen);
  const [filter, setFilter] = useState("");
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

  const needle = filter.trim().toLowerCase();
  const matches = (name: string) => name.toLowerCase().includes(needle);
  const shownStages = stages.filter((s) => matches(s.stage));
  const shownMine = mine.filter((n) => matches(n.title));
  const shownLoose = loose.filter((n) => matches(n.title));

  return (
    <div className={`notebooks-page-layout notebooks-page ${sidebarOpen ? "with-sidebar" : "folded-sidebar"}`}>
      <Sidebar
        title="Notebooks"
        meta={String(stages.length + mine.length + loose.length)}
        search={<SearchField value={filter} onChange={setFilter} placeholder="Search notebooks" ariaLabel="Filter notebooks" />}
        dock={
          <InfoDock
            title="Flow"
            rows={[
              { k: "Flow", v: shownFlow ? flowName(shownFlow) : "None yet" },
              { k: "Stages", v: String(stages.length) },
              { k: "Saved", v: String(mine.length + loose.length) },
            ]}
          />
        }
      >
        {save.error && <p role="alert" className="error">{save.error.message}</p>}
        {shownStages.length > 0 && (
          <>
            <SectionLabel>Stages</SectionLabel>
            <ul aria-label="This flow's stages">
              {shownStages.map(({ stage, nodes }) => (
                <li key={stage} className="nb-item">
                  <button type="button" className="nb-item-open" aria-current={stage === stageOpen} onClick={() => openStage(stage)}>
                    {stage} <span className="muted">· {nodes.length === 1 ? "1 step" : `${nodes.length} steps`}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        {shownMine.length > 0 && <SectionLabel>Saved notebooks</SectionLabel>}
        <NotebookList label="This flow's notebooks" notebooks={shownMine} open={open?.notebook_id} flow={flow?.head} onOpen={openNotebook} />
        {shownLoose.length > 0 && (
          <>
            <SectionLabel>Not in a flow yet</SectionLabel>
            <NotebookList label="Not in a flow yet" notebooks={shownLoose} open={open?.notebook_id} flow={flow?.head} onOpen={openNotebook} />
          </>
        )}
        <div className="nb-new">
          <Button size="sm" disabled={save.isPending} onClick={create}>
            New notebook
          </Button>
        </div>
      </Sidebar>

      <div className="center-screen notebooks-center">
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
    </div>
  );
}
