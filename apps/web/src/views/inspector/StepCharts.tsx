import type { Attempt, Operator, PipelineVersion } from "@sprisk/contracts";
import { useViewSelection } from "../../workbench/instance.tsx";

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

/** The table this step passes on, and its columns, for the chart builder. */
function useChartedTable(attempt: Attempt | undefined) {
  const outputs = useOutputs(attempt?.id);
  const table = outputs.data?.find((o) => o.artifact.media_type === PARQUET);
  const columns = useTablePage(table?.artifact.id, 0, 1).data?.columns ?? [];
  return { table, columns };
}

/** "Chart" for this step's table: adds a chart step, drawn by Python (ADR-0023, ADR-0030). */
export function ChartButton({ attempt, addChart }: Pick<Props, "attempt" | "addChart">) {
  const { table, columns } = useChartedTable(attempt);
  if (!table || !addChart) return null;
  return <ChartMenu columns={columns} busy={false} onAdd={(spec) => addChart(table.port, spec)} />;
}

/** Says where added charts come from: people expect a step's figures to be what its code drew. */
export const ADDED_CHARTS_NOTE = "Charts marked Added were added with Chart: sprisk draws them from this step's table, not by this step's code.";

/** Charts added to this step's table, with their choices. A chart is a view of the step, so it
 * is shown with the step's figures (and never on the canvas). */
export function AddedCharts({ pipeline, nodeId, attempt, attempts, operators }: Omit<Props, "addChart">) {
  const { columns } = useChartedTable(attempt);
  const latest = latestByNode(attempts);
  return (
    <>
      {chartsOf(pipeline, nodeId).map((chart) => (
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
    </>
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
  const saveAndRun = useSaveAndRun(useViewSelection().runId);
  const showRun = useSelection((s) => s.showRun);
  const remove = () => {
    const version = removeStep(pipeline, chartId);
    saveAndRun.mutate(version, { onSuccess: (r) => showRun(version.id, r.id, parentId) });
  };
  const done = hasOutputs(attempt) ? attempt : undefined;
  return (
    <section className="chart-block" aria-label={`Chart ${chartId}`}>
      <div className="result-bar">
        <span className="tab-badge">Added</span>
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
