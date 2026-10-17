import embed, { type VisualizationSpec } from "vega-embed";

import { vegaOptions } from "./vegaOptions.ts";

/** Draws an Altair chart (a Vega-Lite spec) live. It fetches nothing (vegaOptions). Returns the
 * cleanup, which stops the chart's view (ADR-0024). */
export function drawVega(node: HTMLElement, spec: VisualizationSpec): () => void {
  const css = getComputedStyle(document.documentElement);
  const drawn = embed(node, spec, vegaOptions((token) => css.getPropertyValue(token).trim()));
  return () => void drawn.then((result) => result.finalize());
}
