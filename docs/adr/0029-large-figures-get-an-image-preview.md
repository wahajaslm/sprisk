# ADR-0029: Large figures show a download link, not a frozen tab
Status: Accepted
Date: 2026-10-16
Arch doc sections: §2A, §11. Amends ADR-0024 (figures) and ADR-0027 (size caps).

## Context
- A Plotly figure saves every point. A scatter of 100k+ rows can pass the 8 MB browser cap for figures (ADR-0027).
- Today such a figure shows "too large" and nothing else. There is no way to get the figure.
- Raising the browser cap is not a fix. A 30 MB figure takes seconds to parse and draw, and can freeze the tab.
- Plotly 7 already stores number arrays in compact binary form, so the JSON is as small as Plotly makes it.

## Decision
- A figure set over the 8 MB browser cap is not fetched.
- The Visualizations tab shows: "Too large to draw here (N MB)" and a download link for the full figure set (`/artifacts/{id}/content?download=true`).
- Small figures are unchanged: interactive, as ADR-0024 says.
- No new dependency. No contract change.

## Alternatives considered
- **Image preview with Kaleido (Plotly's image export).** Rejected for now: Kaleido needs Chrome or Chromium on every machine, a heavy requirement for a local-first app. Revisit if large figures turn out to be common.
- **Raise the browser cap.** Rejected: trades a message for a frozen tab.
- **Thin the points automatically.** Rejected: the figure would no longer be what Python drew, without the user knowing (ADR-0024).
- **Fail the step when a figure is too big.** Rejected: the step's other outputs are still useful.

## Consequences (good and bad)
- Good: nothing freezes, and the full figure is one click away.
- Good: no new dependency, no contract change.
- Bad: a large figure is not visible in the app. The user downloads it, or changes the step to aggregate or sample before drawing.

## Validation
- A browser test with a figure set over the cap shows the size and the download link, and fetches no content.

## Arch doc edits
- §2A: note that figures over the cap show a download link.
