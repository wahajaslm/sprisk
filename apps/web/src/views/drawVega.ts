import embed, { type VisualizationSpec } from "vega-embed";

import { tokenColor } from "./tokenColor.ts";
import { vegaOptions } from "./vegaOptions.ts";

/** Draws an Altair chart (a Vega-Lite spec) live. It fetches nothing (vegaOptions). Returns the
 * cleanup, which stops the chart's view (ADR-0024). */
export function drawVega(node: HTMLElement, spec: VisualizationSpec): () => void {
  const responsiveSpec: VisualizationSpec = {
    autosize: { type: "fit", contains: "padding" },
    width: "container" as unknown as number,
    ...spec,
  };
  const drawn = embed(node, responsiveSpec, vegaOptions(tokenColor));
  let viewInstance: { resize: () => { runAsync: () => Promise<unknown> }; finalize: () => void } | undefined;
  void drawn.then((res) => {
    viewInstance = res.view as unknown as typeof viewInstance;
  });
  const watcher = new ResizeObserver(() => {
    if (viewInstance?.resize) void viewInstance.resize().runAsync();
  });
  watcher.observe(node);
  return () => {
    watcher.disconnect();
    void drawn.then((result) => result.finalize());
  };
}
