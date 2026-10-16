# ADR-0029: Large figures get an image preview
Status: Proposed
Date: 2026-10-16
Arch doc sections: §2A, §11. Amends ADR-0024 (figures) and ADR-0027 (size caps).

## Context
- A Plotly figure saves every point. A scatter of 100k+ rows can pass the 8 MB browser cap for figures (ADR-0027).
- Today such a figure shows "too large" and nothing else.
- Raising the browser cap is not a fix. A 30 MB figure takes seconds to parse and draw, and can freeze the tab.
- Plotly 7 already stores number arrays in compact binary form, so the JSON is as small as Plotly makes it.

## Decision
- When a Plotly figure's JSON is over 8 MB, the worker also saves a PNG image of it, rendered with Kaleido (Plotly's own image export).
- The `FigureSet` item gets an optional `preview` field: the PNG, base64-encoded. Contract change in `contracts/`, regenerated for all three languages.
- The browser shows the PNG for that figure, with a note ("Large figure: showing an image") and a download link for the full interactive figure (`?download=true`).
- Small figures are unchanged: interactive, as ADR-0024 says.
- If Kaleido cannot render (no Chrome available), the step still succeeds. The browser shows "too large to draw here" with the download link. The worker logs why the preview is missing.

## Alternatives considered
- **Raise the browser cap.** Rejected: trades a message for a frozen tab.
- **Thin the points automatically.** Rejected: the figure would no longer be what Python drew, without the user knowing (ADR-0024).
- **Fail the step when a figure is too big.** Rejected: the step's other outputs are still useful; a figure should not block them.
- **Draw with WebGL (`scattergl`).** Helps drawing speed, not download size. Can be added later.

## Consequences (good and bad)
- Good: every figure shows something. Nothing freezes.
- Good: the full figure is never lost; it is one click away.
- Bad: new dependency, Kaleido. It needs a Chrome or Chromium on the machine. This is the main cost and needs a yes before we build.
- Bad: a PNG is not interactive (no hover, no zoom).
- Bad: one contract change (`FigureSet.preview`).

## Validation
- A test step that draws a 200k-point scatter produces a FigureSet with a `preview`, under the cap.
- The browser test shows the image and the download link for that figure.
- A test without Chrome shows the step succeeds and the browser shows the download link.

## Arch doc edits
- §2A: note that large figures show as an image with a download link.
