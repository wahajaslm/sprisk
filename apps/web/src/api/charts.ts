import type { Attempt, ChartReport } from "@sprisk/contracts";
import { parse } from "@sprisk/contracts";

import { type Read, useReport } from "./code.ts";

/** A chart step's aggregated numbers (ADR-0023). Small by design: a capped sample at most. */
export const useChartReport = (attempt: Attempt | undefined): Read<ChartReport> =>
  useReport(attempt, "chart", (raw) => parse("ChartReport", raw), 2 * 1024 * 1024);
