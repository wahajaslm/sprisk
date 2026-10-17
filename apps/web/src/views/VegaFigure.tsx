import type { VisualizationSpec } from "vega-embed";
import { useEffect, useRef } from "react";

import { drawVega } from "./drawVega.ts";

/** Draws an Altair chart (a Vega-Lite spec) live, as a notebook does. Lazy-loaded: Vega is large
 * (ADR-0024). */
export default function VegaFigure({ json, label }: { json: string; label: string }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => (box.current ? drawVega(box.current, JSON.parse(json) as VisualizationSpec) : undefined), [json]);
  return <div ref={box} className="vega-figure" role="img" aria-label={label} />;
}
