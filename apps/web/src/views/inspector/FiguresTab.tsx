import type { Attempt, Figure } from "@sprisk/contracts";
import { lazy, type ReactNode, Suspense, useRef } from "react";

import { useFigureSet } from "../../api/figures.ts";
import { useResultLayout } from "../../workbench/detail.ts";
import { LayoutSwitch } from "./VisualsTab.tsx";
import { Loading } from "../../components/ui/Loading.tsx";

const PlotlyFigure = lazy(() => import("../PlotlyFigure.tsx"));
const VegaFigure = lazy(() => import("../VegaFigure.tsx"));

/** The figures a step's code drew, on each of its `figure` ports (ADR-0024). Only code
 * decides what is shown here (ADR-0032). */
export function FiguresTab({
  attempt,
  ports,
  controls,
  failure,
}: {
  attempt: Attempt | undefined;
  ports: string[];
  controls?: ReactNode;
  /** Why the latest run of this step failed, if it did. */
  failure?: string | undefined;
}) {
  const { layout, setLayout } = useResultLayout();
  return (
    <>
      <div className="result-bar">
        {controls}
        <span className="spacer" />
        <LayoutSwitch layout={layout} setLayout={setLayout} />
      </div>
      {ports.length === 0 && <p className="muted">This step draws no figures. A plot in a step's code shows here.</p>}
      {failure ? (
        <p role="alert" className="error">This step failed: {failure}</p>
      ) : (
        !attempt && ports.length > 0 && <p className="muted">Not run yet. Run the pipeline to draw.</p>
      )}
      <section className={`figures ${layout}`} aria-label="Figures">
        {ports.map((port) => (
          <FigurePort key={port} attempt={attempt} port={port} />
        ))}
      </section>
    </>
  );
}

export function FigurePort({ attempt, port }: { attempt: Attempt | undefined; port: string }) {
  const set = useFigureSet(attempt, port);
  // While a new run draws, keep the last figures on screen instead of blanking them.
  const last = useRef<Figure[] | undefined>(undefined);
  if (set.status === "ready") last.current = set.value.items;
  if (set.status === "error") return <p role="alert" className="error">{set.message}</p>;
  const items = set.status === "ready" ? set.value.items : last.current;
  if (!items) {
    if (set.status === "loading") return <Loading text="Loading figures…" />;
    if (set.status !== "none" || !attempt) return null;
    return (
      <p className="muted">
        {set.reason}{" "}
        {set.download && (
          <a href={set.download} download>
            Download
          </a>
        )}
      </p>
    );
  }
  if (items.length === 0) return <p className="muted">No figures this run.</p>;
  return (
    <>
      {set.status === "loading" && <p className="muted">Drawing…</p>}
      {items.map((figure, i) => (
        <FigureView key={i} figure={figure} index={i} />
      ))}
    </>
  );
}

/** One figure, drawn by its format: an SVG picture, or a chart the browser draws live. Used
 * for built-in steps' figure ports, plots a code step showed, and small on canvas cards. */
export function FigureView({ figure, index, small = false }: { figure: Figure; index: number; small?: boolean }) {
  const label = figure.title ?? `Figure ${index + 1}`;
  switch (figure.format) {
    case "svg":
      // As an image, so nothing inside the SVG runs (it is never inserted as markup).
      return <img className="figure svg-figure" alt={label} src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(figure.content)}`} />;
    case "plotly_json":
      return (
        <Suspense fallback={<Loading text="Loading figure…" />}>
          <PlotlyFigure json={figure.content} label={label} small={small} />
        </Suspense>
      );
    case "vega_lite_json":
      return (
        <Suspense fallback={<Loading text="Loading figure…" />}>
          <VegaFigure json={figure.content} label={label} />
        </Suspense>
      );
  }
}
