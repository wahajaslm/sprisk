import type { Attempt, Figure } from "@sprisk/contracts";
import { lazy, Suspense } from "react";

import { useFigureSet } from "../../api/figures.ts";

const PlotlyFigure = lazy(() => import("../PlotlyFigure.tsx"));

/** The figures a step drew in Python, on each of its `figure` ports (ADR-0024). */
export function FiguresTab({ attempt, ports }: { attempt: Attempt | undefined; ports: string[] }) {
  if (ports.length === 0) return <p className="muted">This step draws no figures. Add a chart from the table above it in Data.</p>;
  return (
    <div className="figures">
      {ports.map((port) => (
        <FigurePort key={port} attempt={attempt} port={port} />
      ))}
    </div>
  );
}

function FigurePort({ attempt, port }: { attempt: Attempt | undefined; port: string }) {
  const set = useFigureSet(attempt, port);
  if (set.status === "none") return <p className="muted">{set.reason}</p>;
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
