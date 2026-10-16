import type { Attempt, FigureSet } from "@sprisk/contracts";
import { parse } from "@sprisk/contracts";

import { type Read, useReport } from "./code.ts";

/** Figures can carry many points; still capped, like code output (rule 9). */
const MAX_FIGURE_BYTES = 8 * 1024 * 1024;

/** The figures one step drew on one `figure` port (ADR-0024). */
export const useFigureSet = (attempt: Attempt | undefined, port: string): Read<FigureSet> =>
  useReport(attempt, port, (raw) => parse("FigureSet", raw), MAX_FIGURE_BYTES);
