import { useEffect, useRef } from "react";

import { label, lum, PALETTE, prepare } from "./studioChart.ts";

type Draw = (g: CanvasRenderingContext2D, w: number, h: number) => void;

/** A canvas drawn by `draw` at its own size, and again when its box changes. */
function Canvas({ draw, height, label: name }: { draw: Draw; height: number; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const paint = () => {
      const ready = prepare(canvas);
      if (ready) draw(ready.g, ready.w, ready.h);
    };
    paint();
    const watcher = new ResizeObserver(paint);
    watcher.observe(canvas);
    return () => watcher.disconnect();
  }, [draw]);
  return <canvas ref={ref} className="studio-canvas" style={{ height }} role="img" aria-label={name} />;
}

/** The design system's correlation matrix (§07): lit cells, |r| as light, red past `warn`. */
export function Cells({ name, rows, columns, value, warn, height }: {
  name: string;
  rows: string[];
  columns: number;
  value: (row: number, col: number) => number | null;
  warn?: (row: number, col: number) => boolean;
  height: number;
}) {
  const draw: Draw = (g, w, h) => {
    const left = Math.min(160, Math.round(w * 0.25));
    const cw = (w - left) / Math.max(1, columns);
    const ch = h / Math.max(1, rows.length);
    rows.forEach((r, i) => {
      label(g, fit(g, r, left - 10), 0, i * ch + ch / 2 + 4, PALETTE.t1);
      for (let j = 0; j < columns; j++) {
        const v = value(i, j);
        if (v === null) continue;
        lum(g, { x: Math.round(left + j * cw + 1), y: Math.round(i * ch + 1), w: Math.max(1, Math.round(cw - 2)), h: Math.max(1, Math.round(ch - 2)) }, warn?.(i, j) ? PALETTE.red : PALETTE.ink, 0.12 + 1.1 * Math.abs(v), false);
      }
    });
  };
  return <Canvas draw={draw} height={height} label={name} />;
}

/** `text` cut with "…" to fit `width` pixels in the current font. */
function fit(g: CanvasRenderingContext2D, text: string, width: number): string {
  if (g.measureText(text).width <= width) return text;
  let cut = text;
  while (cut.length > 1 && g.measureText(`${cut}…`).width > width) cut = cut.slice(0, -1);
  return `${cut}…`;
}
