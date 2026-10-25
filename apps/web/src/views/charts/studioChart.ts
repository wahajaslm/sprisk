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

export type Rect = { x: number; y: number; w: number; h: number };

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

/** Text in a faint label colour. */
export function label(g: CanvasRenderingContext2D, text: string, x: number, y: number, color = PALETTE.t3) {
  g.fillStyle = color;
  g.fillText(text, x, y);
}
