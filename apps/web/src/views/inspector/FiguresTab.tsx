import type { Attempt, Figure } from "@sprisk/contracts";
import { lazy, type ReactNode, Suspense, useRef } from "react";

import { useFigureSet } from "../../api/figures.ts";
import { type ResultLayout, useResultLayout } from "../../workbench/detail.ts";
import { ChartCard, CHART_GRID } from "../PlotTile.tsx";
import { LayoutSwitch } from "./VisualsTab.tsx";
import { Loading } from "../../components/ui/Loading.tsx";

const PlotlyFigure = lazy(() => import("../PlotlyFigure.tsx"));
const VegaFigure = lazy(() => import("../VegaFigure.tsx"));

/** The design's quiet line of text, for a state with nothing to draw. */
export const QUIET = { margin: "0", fontSize: "12.5px", color: "var(--t-faint,#8c8c8c)", lineHeight: "1.5" } as const;
/** The tab's column: the bar on top, then messages and figures. */
export const TAB = { display: "flex", flexDirection: "column", gap: "16px", minWidth: "0" } as const;
/** The bar above the figures: the step's own controls on the left, the layout switch on the right. */
export const BAR = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px" } as const;

/** Inline is one card per row; grid is the design's grid of cards. */
export const figuresLayout = (layout: ResultLayout) =>
  layout === "grid" ? CHART_GRID : ({ display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: "16px" } as const);

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
    <div style={TAB}>
      <div style={BAR}>
        {controls}
        <span style={{ flex: "1" }} />
        <LayoutSwitch layout={layout} setLayout={setLayout} />
      </div>
      {ports.length === 0 && <p style={QUIET}>This step draws no figures. A plot in a step's code shows here.</p>}
      {failure ? (
        <p role="alert" className="error">This step failed: {failure}</p>
      ) : (
        !attempt && ports.length > 0 && <p style={QUIET}>Not run yet. Run the pipeline to draw.</p>
      )}
      <section className={`figures ${layout}`} aria-label="Figures" style={figuresLayout(layout)}>
        {ports.map((port) => (
          <FigurePort key={port} attempt={attempt} port={port} cards />
        ))}
      </section>
    </div>
  );
}

/** A port's figures. As `cards`, each one is a design chart card titled by its figure. */
export function FigurePort({ attempt, port, cards = false }: { attempt: Attempt | undefined; port: string; cards?: boolean }) {
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
      <p style={QUIET}>
        {set.reason}{" "}
        {set.download && (
          <a href={set.download} download>
            Download
          </a>
        )}
      </p>
    );
  }
  if (items.length === 0) return <p style={QUIET}>No figures this run.</p>;
  return (
    <>
      {set.status === "loading" && <p style={QUIET}>Drawing…</p>}
      {items.map((figure, i) =>
        cards ? (
          <ChartCard key={i} title={figure.title ?? `Figure ${i + 1}`} note={port}>
            <FigureView figure={figure} index={i} />
          </ChartCard>
        ) : (
          <FigureView key={i} figure={figure} index={i} />
        ),
      )}
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
