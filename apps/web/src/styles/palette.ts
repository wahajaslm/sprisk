/** The design's palette (designx `PAL.dark`) for values its markup computes in code. Each one
 * reads a token in cockpit.css, so a colour is defined once. */
export const P = {
  t0: "var(--t-primary)",
  t1: "var(--t-secondary)",
  t3: "var(--t-faint)",
  idle: "var(--t-idle)",
  red: "var(--danger)",
  surf: "var(--bg-surface)",
} as const;

/** White at alpha `a`: the design's lines, washes and selected fills. */
export const ink = (a: number) => `rgba(var(--ink-rgb),${a})`;

/** The design's red at alpha `a`: the wash behind a problem. */
export const danger = (a: number) => `rgba(var(--danger-rgb),${a})`;

/** The design's "joined" layout: rail, sidebar, centre and Copilot touch, split by 1px lines of
 * the divider colour showing through the grid gap. */
export const LAYOUT = {
  gap: "1px",
  divider: "var(--pane-divider)",
  frame: ink(0.09),
} as const;
