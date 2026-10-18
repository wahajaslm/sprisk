import type { Attempt, FigureSet } from "@sprisk/contracts";
import { parse } from "@sprisk/contracts";
import { useQuery } from "@tanstack/react-query";

import { getOne } from "./client.ts";
import { type Read, useReport } from "./code.ts";

/** Figures can carry many points; still capped, like code output (rule 9). */
export const MAX_FIGURE_BYTES = 8 * 1024 * 1024;

/** The figures one step drew on one `figure` port (ADR-0024). */
export const useFigureSet = (attempt: Attempt | undefined, port: string): Read<FigureSet> =>
  useReport(attempt, port, (raw) => parse("FigureSet", raw), MAX_FIGURE_BYTES);

/** The first figure in a figures or display report, for a canvas card. Only that figure is
 * fetched, never the tables a code step showed beside it. */
export const useFirstFigure = (artifactId: string | undefined) =>
  useQuery({
    queryKey: ["first-figure", artifactId],
    queryFn: () => getOne("FigureSet", `/artifacts/${artifactId ?? ""}/figures?limit=1`),
    enabled: artifactId !== undefined,
    staleTime: Infinity, // artifacts never change
  });
