/** The design's palette (designx `PAL.dark`), for the values its markup computes in code rather
 * than reading from a CSS variable. */
export const P = {
  t0: "#e2e2e2",
  t1: "#c4c4c4",
  t2: "#ababab",
  t3: "#8c8c8c",
  knob: "#ffffff",
  idle: "#5a5a5a",
  redHex: "#ff5c5c",
  red: "255,92,92",
  line: "255,255,255",
  surf: "#121212",
} as const;

/** White at alpha `a`: the design's lines, washes and selected fills. */
export const ink = (a: number) => `rgba(${P.line},${a})`;

/** The design's "joined" layout: rail, sidebar, centre and Copilot touch, split by 1px lines of
 * the divider colour showing through the grid gap. */
export const LAYOUT = {
  gap: "1px",
  divider: "var(--pane-divider)",
  frame: ink(0.09),
  canvasLine: ink(0.1),
} as const;
