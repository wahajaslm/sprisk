import type { Attempt, Figure } from "@sprisk/contracts";
import { lazy, type ReactNode, Suspense } from "react";

import { useFigureSet } from "../../api/figures.ts";
import { useResultLayout } from "../../workbench/detail.ts";
import { LayoutSwitch } from "./VisualsTab.tsx";

const PlotlyFigure = lazy(() => import("../PlotlyFigure.tsx"));

/** The figures a step drew in Python, on each of its `figure` ports (ADR-0024). */
export function FiguresTab({
  attempt,
  ports,
  controls,
  failure,
  charts,
}: {
  attempt: Attempt | undefined;
  ports: string[];
  controls?: ReactNode;
  /** Why the latest run of this step failed, if it did. */
  failure?: string | undefined;
  /** Charts of this step's tables (they live here, not on the canvas). */
  charts?: ReactNode;
}) {
  const { layout, setLayout } = useResultLayout();
  if (ports.length === 0 && !charts) return <p className="muted">This step draws no figures.</p>;
  return (
    <>
      <div className="result-bar">
        {controls}
        <span className="spacer" />
        <LayoutSwitch layout={layout} setLayout={setLayout} />
      </div>
      {failure ? (
        <p role="alert" className="error">This step failed: {failure}</p>
      ) : (
        !attempt && ports.length > 0 && <p className="muted">Not run yet. Run the flow to draw.</p>
      )}
      <section className={`figures ${layout}`} aria-label="Figures">
        {ports.map((port) => (
          <FigurePort key={port} attempt={attempt} port={port} />
        ))}
      </section>
      {charts}
    </>
  );
}

export function FigurePort({ attempt, port }: { attempt: Attempt | undefined; port: string }) {
  const set = useFigureSet(attempt, port);
  if (set.status === "none") return attempt ? <p className="muted">{set.reason}</p> : null;
  if (set.status === "loading") return <p className="muted">Loading figures…</p>;
  if (set.status === "error") return <p role="alert" className="error">{set.message}</p>;
  if (set.value.items.length === 0) return <p className="muted">No figures this run.</p>;
  return (
    <>
      {set.value.items.map((figure, i) => (
        <FigureView key={i} figure={figure} index={i} />
      ))}
    </>
  );
}

function FigureView({ figure, index }: { figure: Figure; index: number }) {
  const label = figure.title ?? `Figure ${index + 1}`;
  if (figure.format === "svg") {
    // As an image, so nothing inside the SVG runs (it is never inserted as markup).
    return <img className="figure svg-figure" alt={label} src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(figure.content)}`} />;
  }
  return (
    <Suspense fallback={<p className="muted">Loading figure…</p>}>
      <PlotlyFigure json={figure.content} label={label} />
    </Suspense>
  );
}
