import type { Attempt } from "@sprisk/contracts";
import { lazy, Suspense } from "react";

import { useChartReport } from "../../api/charts.ts";

const ChartView = lazy(() => import("../ChartView.tsx"));

/** A chart step's Visualizations: its chart, drawn from the numbers the step computed. */
export function ChartTab({ attempt }: { attempt: Attempt | undefined }) {
  const report = useChartReport(attempt);
  if (report.status === "none") return <p className="muted">{report.reason}</p>;
  if (report.status === "loading") return <p className="muted">Loading chart…</p>;
  if (report.status === "error") return <p role="alert" className="error">{report.message}</p>;
  const { n_rows, sampled, missing } = report.value;
  return (
    <div className="chart-tab">
      <div className="peek-head">
        <span>{n_rows} rows</span>
        {sampled && <span>· a fixed sample is drawn</span>}
        {missing !== undefined && missing > 0 && <span>· {missing} missing not drawn</span>}
      </div>
      <Suspense fallback={<p className="muted pad">Loading chart…</p>}>
        <ChartView chart={report.value} />
      </Suspense>
    </div>
  );
}
