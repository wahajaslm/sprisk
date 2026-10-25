import { type ReactNode, useEffect, useRef } from "react";

import { columnLayout, grid, label, lum, PALETTE, prepare, rowLayout, threshold } from "./studioChart.ts";

type Draw = (g: CanvasRenderingContext2D, w: number, h: number) => void;

/** The widest a vertical bar gets: a chart of a few columns keeps the design's thin bars. */
const MAX_BAR = 28;

/** One series in a chart's legend: a dot and its words. */
export type LegendItem = { tone: "primary" | "secondary" | "red"; text: string };

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

/** The design's chart block: title, a grey line saying what it shows, a red note when
 * something crosses a threshold, the chart, then its legend. */
export function ChartBlock({ title, sub, note, legend, children }: { title: string; sub?: string; note?: string; legend?: LegendItem[]; children: ReactNode }) {
  return (
    <figure className="studio-chart" aria-label={title}>
      <figcaption className="studio-chart-head">
        <span className="studio-chart-title">{title}</span>
        {sub && <span className="studio-chart-sub">{sub}</span>}
        {note && <span className="studio-chart-note">{note}</span>}
      </figcaption>
      {children}
      {legend && legend.length > 0 && (
        <ul className="studio-legend">
          {legend.map((l) => (
            <li key={l.text} className={`tone-${l.tone}`}>
              {l.text}
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}

/** Vertical luminous bars: a distribution, or one bar per column. A bar marked `warn` is red;
 * a threshold is a red dashed line. The first and last labels sit under the axis. */
export function ColumnBars({ name, values, labels, max, line, warn, height = 140, axis }: {
  name: string;
  values: number[];
  labels?: string[];
  max?: number;
  line?: number;
  warn?: (i: number) => boolean;
  height?: number;
  axis?: (v: number) => string;
}) {
  const draw: Draw = (g, w, h) => {
    const box = { width: w, height: h, left: 34, bottom: labels ? 18 : 4, top: 8, maxBar: MAX_BAR, ...(max !== undefined ? { max } : {}) };
    const top = box.max ?? Math.max(...values, 0);
    grid(g, box.left, box.top, w - box.left, h - box.bottom - box.top, 2);
    label(g, axis ? axis(top) : compact(top), 0, 14);
    label(g, "0", 24, h - box.bottom);
    columnLayout(values, box).forEach((r, i) => {
      if (r.h === 0) {
        g.fillStyle = `rgba(${PALETTE.line},0.1)`;
        g.fillRect(r.x, h - box.bottom - 1, r.w, 1);
        return;
      }
      lum(g, r, warn?.(i) ? PALETTE.red : PALETTE.ink, warn?.(i) ? 1 : 0.85);
    });
    if (line !== undefined && top > 0) threshold(g, box.left, w, box.top + (1 - line / top) * (h - box.bottom - box.top));
    if (labels && labels.length > 0) {
      label(g, labels[0] ?? "", box.left, h - 3);
      const last = labels.at(-1) ?? "";
      label(g, last, w - g.measureText(last).width, h - 3);
    }
  };
  return <Canvas draw={draw} height={height} label={name} />;
}

/** Horizontal luminous bars with their names on the left and values on the right: the most
 * common values of a column. A muted row is drawn grey. */
export function RowBars({ name, rows }: { name: string; rows: { label: string; value: number; text: string; muted?: boolean }[] }) {
  const height = Math.max(60, rows.length * 22 + 8);
  const draw: Draw = (g, w, h) => {
    const left = Math.min(220, Math.round(w * 0.38));
    const bars = rowLayout(
      rows.map((r) => r.value),
      { width: w, height: h - 8, left, right: 90 },
    );
    rows.forEach((r, i) => {
      const bar = bars[i];
      if (!bar) return;
      const mid = bar.y + bar.h / 2 + 4;
      label(g, fit(g, r.label, left - 12), 0, mid, r.muted ? PALETTE.t3 : PALETTE.t1);
      lum(g, { ...bar, y: bar.y + 4 }, r.muted ? PALETTE.grey : PALETTE.ink, r.muted ? 0.9 : 1);
      label(g, r.text, bar.x + bar.w + 8, mid);
    });
  };
  return <Canvas draw={draw} height={height} label={name} />;
}

/** Lit cells in a grid: a correlation field (|r| as light, red past `warnAbove`) or where
 * values are missing along the rows. */
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

/** The design's parallel coordinates: one vertical axis per setting and the score, each trial
 * a faint line across them, the best one bright with a soft glow and its points marked. */
export function ParallelLines({ name, axes, lines, best, height = 260 }: { name: string; axes: string[]; lines: number[][]; best: number; height?: number }) {
  const draw: Draw = (g, w, h) => {
    const top = 10;
    const bottom = 26;
    const plot = h - top - bottom;
    const left = 40;
    const step = axes.length > 1 ? (w - left * 2) / (axes.length - 1) : 0;
    const x = (i: number) => Math.round(left + i * step) + 0.5;
    const y = (v: number) => top + (1 - v) * plot;
    axes.forEach((a, i) => {
      g.fillStyle = `rgba(${PALETTE.line},0.1)`;
      g.fillRect(Math.round(left + i * step), top, 1, plot);
      label(g, a, x(i) - g.measureText(a).width / 2, h - 6);
    });
    const path = (line: number[]) => {
      g.beginPath();
      line.forEach((v, i) => (i === 0 ? g.moveTo(x(i), y(v)) : g.lineTo(x(i), y(v))));
    };
    g.save();
    g.lineJoin = "round";
    g.strokeStyle = `rgba(${PALETTE.ink},0.22)`;
    g.lineWidth = 1;
    lines.forEach((line, i) => {
      if (i === best) return;
      path(line);
      g.stroke();
    });
    const top1 = lines[best];
    if (top1) {
      g.strokeStyle = `rgba(${PALETTE.ink},0.14)`;
      g.lineWidth = 6;
      path(top1);
      g.stroke();
      g.strokeStyle = `rgba(${PALETTE.ink},1)`;
      g.lineWidth = 1.5;
      path(top1);
      g.stroke();
      g.fillStyle = `rgb(${PALETTE.ink})`;
      top1.forEach((v, i) => {
        g.beginPath();
        g.arc(x(i), y(v), 3, 0, 7);
        g.fill();
      });
    }
    g.restore();
  };
  return <Canvas draw={draw} height={height} label={name} />;
}

/** A tiny distribution for a table cell, as the design's preview headers draw them. */
export function Sparkline({ name, values, warn }: { name: string; values: number[]; warn?: boolean }) {
  const draw: Draw = (g, w, h) => {
    columnLayout(values, { width: w, height: h, left: 0, bottom: 0, top: 1 }).forEach((r) => lum(g, r, warn ? PALETTE.red : PALETTE.ink, 0.8, true));
  };
  return <Canvas draw={draw} height={22} label={name} />;
}

/** 84,916 → "85k"; small numbers as they are. */
function compact(n: number): string {
  if (n >= 1_000_000) return `${Math.round(n / 100_000) / 10}M`;
  if (n >= 1_000) return `${Math.round(n / 100) / 10}k`;
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/** `text` cut with "…" to fit `width` pixels in the current font. */
function fit(g: CanvasRenderingContext2D, text: string, width: number): string {
  if (g.measureText(text).width <= width) return text;
  let cut = text;
  while (cut.length > 1 && g.measureText(`${cut}…`).width > width) cut = cut.slice(0, -1);
  return `${cut}…`;
}
