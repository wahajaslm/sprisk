# ADR-0024: Steps return figures from any Python plotting library
Status: Accepted
Date: 2026-10-16
Arch doc sections: §2A (views, rule 9), §7 (operators), §11 (contracts). Supersedes the drawing part of ADR-0023.

## Context
- Visualizations showed only code-step plots (matplotlib PNG) and chart steps (numbers drawn by ECharts in the browser): two drawing systems, and built-in steps showed nothing.
- People expect figures made by Python, with the library they know.

## Decision
- New port kind `figure`. A step returns one figure or a list of figures on it, from:
  - matplotlib (and libraries drawing on it: seaborn, pandas `.plot`) → saved as SVG;
  - Plotly → saved as its figure JSON and shown interactive with plotly.js.
- The worker converts by type into one `FigureSet` artifact (new contract). An unknown figure type fails the step, naming the type. Each new library is one converter in the worker plus, if needed, one renderer in the browser.
- The Visualizations tab shows the figures of any step. SVG is shown as an image (no scripts run); Plotly JSON is drawn by plotly.js, lazy-loaded.
- Built-in steps draw with Plotly: evaluate (confusion matrix), feature importance, distributions, chart. ECharts and `ChartReport` are removed: one drawing system, in Python.
- Code steps keep showing matplotlib figures and also show Plotly figures they `display()`.

## Alternatives considered
- **One library only (matplotlib or Plotly).** Rejected: people use both; the cost of a second converter is small.
- **Keep browser-side drawing for built-ins.** Rejected: two systems, and the figure is no longer what Python made.

## Consequences
- Good: every step can explain itself with a figure; figures are versioned and cached with the step.
- Good: what you see is exactly what Python drew.
- Bad: plotly.js is large (about 3.5 MB); it is lazy-loaded only when a Plotly figure is shown.
- Bad: a figure with many points is a large artifact; figure sets are capped like code output.

## Validation
- Each built-in step with a figure output has a test that its figures convert.
- No table rows reach the browser for any figure.
