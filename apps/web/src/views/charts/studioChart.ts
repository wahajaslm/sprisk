/** The Flow Studio data visuals (design system §07): luminous dithered fills, a faint grid,
 * hairline axes, light primary, grey second series, red only for thresholds and problems.
 * Ported from the design's own canvas drawing, so the app draws what the design shows. */

/** The design's dark palette: colours as "r,g,b" for alpha blends. */
export const PALETTE = {
  ink: "236,236,236",
  ser2: "140,140,140",
  red: "255,92,92",
  grey: "80,80,80",
  line: "255,255,255",
  t1: "#c4c4c4",
  t3: "#8c8c8c",
};

type Rgb = string;

export type Box = { width: number; height: number; left: number; bottom: number; top: number; max?: number; maxBar?: number };
export type Rect = { x: number; y: number; w: number; h: number };

/** Vertical bars side by side over the plot, scaled to `max` or the tallest value. */
export function columnLayout(values: number[], box: Box): Rect[] {
  const n = values.length;
  if (n === 0) return [];
  const plot = box.height - box.bottom - box.top;
  const max = box.max ?? Math.max(...values, Number.MIN_VALUE);
  const bw = Math.min((box.width - box.left) / n, box.maxBar ?? Number.POSITIVE_INFINITY);
  return values.map((v, i) => {
    const h = Math.round((Math.min(v, max) / max) * plot);
    return { x: Math.round(box.left + i * bw + 1), y: box.height - box.bottom - h, w: Math.max(1, Math.floor(bw) - 2), h };
  });
}

/** Horizontal bars one per row, half a row thick, scaled to the longest value. */
export function rowLayout(values: number[], box: { width: number; height: number; left: number; right: number }): Rect[] {
  const rowH = box.height / Math.max(1, values.length);
  const room = box.width - box.left - box.right;
  const max = Math.max(...values, Number.MIN_VALUE);
  return values.map((v, i) => ({ x: box.left, y: Math.round(i * rowH + rowH * 0.25), w: Math.round((v / max) * room), h: Math.round(rowH * 0.5) }));
}

/** A canvas at its device resolution, its 2D context scaled to CSS pixels. */
export function prepare(canvas: HTMLCanvasElement): { g: CanvasRenderingContext2D; w: number; h: number } | null {
  const dpr = Math.min(3, Math.max(2, (window.devicePixelRatio || 1) * 1.5));
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const g = canvas.getContext("2d");
  if (!g) return null;
  g.scale(dpr, dpr);
  g.imageSmoothingQuality = "high";
  g.font = "500 11px 'Instrument Sans', sans-serif";
  return { g, w, h };
}

/** A fixed seeded generator: the dither is the same on every draw. */
function rng(seed: number) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

const dithers = new Map<Rgb, HTMLCanvasElement>();

/** The design's dither: a 96px tile of scattered pixels at varying alpha. */
function dither(g: CanvasRenderingContext2D, rgb: Rgb): CanvasPattern | null {
  let tile = dithers.get(rgb);
  if (!tile) {
    const n = 96;
    tile = document.createElement("canvas");
    tile.width = tile.height = n;
    const x = tile.getContext("2d");
    if (!x) return null;
    const r = rng(97);
    const img = x.createImageData(n, n);
    const [r0, g0, b0] = rgb.split(",").map(Number);
    for (let p = 0; p < n * n; p++) {
      const t = r();
      if (t < 0.55) {
        img.data[p * 4] = r0 ?? 0;
        img.data[p * 4 + 1] = g0 ?? 0;
        img.data[p * 4 + 2] = b0 ?? 0;
        img.data[p * 4 + 3] = Math.round(255 * (0.45 + 0.35 * t));
      }
    }
    x.putImageData(img, 0, 0);
    dithers.set(rgb, tile);
  }
  const pattern = g.createPattern(tile, "repeat");
  pattern?.setTransform(new DOMMatrix().scale(1 / g.getTransform().a));
  return pattern;
}

/** A luminous fill: a top-lit gradient, a base tint, the dither, and a bright 1px top edge. */
export function lum(g: CanvasRenderingContext2D, { x, y, w, h }: Rect, rgb: Rgb, a = 1, edge = true) {
  if (w <= 0 || h <= 0) return;
  const gr = g.createLinearGradient(0, y, 0, y + h);
  gr.addColorStop(0, `rgba(${rgb},${Math.min(1, 0.62 * a)})`);
  gr.addColorStop(1, `rgba(${rgb},${Math.min(1, 0.2 * a)})`);
  g.fillStyle = gr;
  g.fillRect(x, y, w, h);
  g.save();
  g.globalAlpha = Math.min(1, a) * 0.35;
  g.fillStyle = `rgb(${rgb})`;
  g.fillRect(x, y, w, h);
  const pattern = dither(g, rgb);
  if (pattern) {
    g.globalAlpha = Math.min(1, a) * 0.75;
    g.fillStyle = pattern;
    g.fillRect(x, y, w, h);
  }
  g.restore();
  if (edge) {
    g.fillStyle = `rgba(${rgb},${Math.min(1, a)})`;
    g.fillRect(x, y, w, 1);
  }
}

/** The faint horizontal grid. */
export function grid(g: CanvasRenderingContext2D, left: number, top: number, width: number, height: number, lines: number) {
  g.fillStyle = `rgba(${PALETTE.line},0.045)`;
  for (let k = 0; k <= lines; k++) g.fillRect(left, Math.round(top + (k * height) / lines), width, 1);
}

/** A red dashed line across the plot at height `y`: a threshold. */
export function threshold(g: CanvasRenderingContext2D, x0: number, x1: number, y: number) {
  g.save();
  g.strokeStyle = `rgba(${PALETTE.red},0.9)`;
  g.setLineDash([3, 3]);
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(x0, Math.round(y) + 0.5);
  g.lineTo(x1, Math.round(y) + 0.5);
  g.stroke();
  g.restore();
}

/** Text in a faint label colour. */
export function label(g: CanvasRenderingContext2D, text: string, x: number, y: number, color = PALETTE.t3) {
  g.fillStyle = color;
  g.fillText(text, x, y);
}
