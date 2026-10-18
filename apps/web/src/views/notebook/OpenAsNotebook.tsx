import { useState } from "react";

import { useOperators, useOperatorSources, usePipelineVersions } from "../../api/hooks.ts";
import { useSaveNotebook } from "../../api/notebooks.ts";
import { isCodeOperator } from "../../flow/edit.ts";
import { flowAsIpynb } from "../../flow/notebook.ts";
import { firstVersion, newCellId } from "../../notebook/document.ts";
import { useSelection } from "../../workbench/selection.ts";

/** The flow on screen as a new notebook, to explore on a kernel (ADR-0036). Built-in steps
 * become their code and call, as in the .ipynb export. The flow itself does not change. */
export function OpenAsNotebook() {
  const pipelineVersionId = useSelection((s) => s.pipelineVersionId);
  const openNotebook = useSelection((s) => s.openNotebook);
  const versions = usePipelineVersions();
  const operators = useOperators();
  const pipeline = versions.data?.find((v) => v.id === pipelineVersionId);
  const refs = [...new Set((pipeline?.nodes ?? []).filter((n) => !n.code && !isCodeOperator(n.operator)).map((n) => n.operator))];
  const sources = useOperatorSources(refs);
  const save = useSaveNotebook();
  const [problem, setProblem] = useState<string | undefined>();
  if (!pipeline || !operators.data) return null;

  const open = () => {
    setProblem(undefined);
    try {
      const loaded = new Map(refs.flatMap((ref, i) => (sources[i]?.data ? [[ref, sources[i].data.text] as const] : [])));
      const ops = new Map(operators.data.map((op) => [op.id, op]));
      const cells = flowAsIpynb(pipeline, ops, loaded).cells.map((c) => ({
        id: newCellId(),
        kind: c.cell_type === "markdown" ? ("markdown" as const) : ("code" as const),
        source: c.source,
      }));
      save.mutate(firstVersion(pipeline.project_id, `Flow ${pipeline.id}`, cells), {
        onSuccess: (saved) => openNotebook(saved.notebook_id),
        onError: (e) => setProblem(e.message),
      });
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    }
  };
  const failed = sources.find((s) => s.isError)?.error?.message;
  return (
    <>
      <button type="button" className="page-btn" disabled={sources.some((s) => s.isPending) || save.isPending} onClick={open}>
        Open as notebook
      </button>
      {(failed ?? problem) && <span role="alert" className="error">{failed ?? problem}</span>}
    </>
  );
}
