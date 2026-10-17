import embed from "vega-embed";
import { useEffect, useRef } from "react";

import { vegaOptions } from "./vegaOptions.ts";

/** Draws an Altair chart (a Vega-Lite spec) live, as a notebook does. Lazy-loaded: Vega is large
 * (ADR-0024). It fetches nothing (vegaOptions). */
export default function VegaFigure({ json, label }: { json: string; label: string }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = box.current;
    if (!node) return;
    const css = getComputedStyle(document.documentElement);
    const drawn = embed(node, JSON.parse(json), vegaOptions((token) => css.getPropertyValue(token).trim()));
    return () => void drawn.then((result) => result.finalize());
  }, [json]);
  return <div ref={box} className="vega-figure" role="img" aria-label={label} />;
}
