import type { Attempt, Operator, PipelineVersion } from "@sprisk/contracts";

import { useOutputs, useSaveAndRun, useTablePage } from "../../api/hooks.ts";
import { PARQUET } from "../../api/media.ts";
import { type ChartSpec, chartsOf, removeStep } from "../../flow/edit.ts";
import { hasOutputs, latestByNode } from "../../flow/latest.ts";
import { useSelection } from "../../workbench/selection.ts";
import { ChartMenu } from "../ChartMenu.tsx";
import { FigurePort } from "./FiguresTab.tsx";
import { ViewControls } from "./ViewControls.tsx";

type Props = {
  pipeline: PipelineVersion;
  nodeId: string;
  attempt: Attempt | undefined;
  attempts: Attempt[];
  operators: Map<string, Operator>;
  addChart: ((port: string, spec: ChartSpec) => void) | undefined;
};

/** Charts of this step's tables, with their choices: a chart is a view of the step, so it is
 * drawn here (by its own small Python step) and never shown on the canvas. */
export function StepCharts({ pipeline, nodeId, attempt, attempts, operators, addChart }: Props) {
  const outputs = useOutputs(attempt?.id);
  const table = outputs.data?.find((o) => o.artifact.media_type === PARQUET);
  const columns = useTablePage(table?.artifact.id, 0, 1).data?.columns ?? [];
  const latest = latestByNode(attempts);
  const charts = chartsOf(pipeline, nodeId);
  return (
    <section className="step-charts" aria-label="Charts">
      {table && addChart && (
        <div className="result-bar">
          <span className="muted">Charts of {table.port}</span>
          <span className="spacer" />
          <ChartMenu columns={columns} busy={false} onAdd={(spec) => addChart(table.port, spec)} />
        </div>
      )}
      {charts.map((chart) => (
        <ChartBlock
          key={chart.id}
          pipeline={pipeline}
          chartId={chart.id}
          parentId={nodeId}
          operator={operators.get(chart.operator)}
          attempt={latest.get(chart.id)}
          columns={columns}
        />
      ))}
    </section>
  );
}

function ChartBlock({
  pipeline,
  chartId,
  parentId,
  operator,
  attempt,
  columns,
}: {
  pipeline: PipelineVersion;
  chartId: string;
  parentId: string;
  operator: Operator | undefined;
  attempt: Attempt | undefined;
  columns: Parameters<typeof ViewControls>[0]["columns"];
}) {
  const saveAndRun = useSaveAndRun();
  const showRun = useSelection((s) => s.showRun);
  const remove = () => {
    const version = removeStep(pipeline, chartId);
    saveAndRun.mutate(version, { onSuccess: (r) => showRun(version.id, r.id, parentId) });
  };
  const done = hasOutputs(attempt) ? attempt : undefined;
  return (
    <section className="chart-block" aria-label={`Chart ${chartId}`}>
      <div className="result-bar">
        <ViewControls pipeline={pipeline} nodeId={chartId} operator={operator} columns={columns} showNode={parentId} />
        <span className="spacer" />
        <button type="button" className="tab-action" aria-label={`Remove chart ${chartId}`} title="Remove this chart" disabled={saveAndRun.isPending} onClick={remove}>
          ×
        </button>
      </div>
      {attempt?.state === "failed" && <p role="alert" className="error">This chart failed: {attempt.error?.message}</p>}
      {saveAndRun.isError && <p role="alert" className="error">{saveAndRun.error.message}</p>}
      <FigurePort attempt={done} port="chart" />
    </section>
  );
}
