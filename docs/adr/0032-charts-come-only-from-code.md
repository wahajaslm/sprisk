# ADR-0032: Charts come only from code
Status: Accepted
Date: 2026-10-17
Arch doc sections: §2A (Inspector). Supersedes the chart builder in ADR-0023 and ADR-0030. Keeps ADR-0024 and ADR-0025.

## Context
- The design rule is ADR-0025: what a tab shows is read from the step's code.
- The Chart button (ADR-0023, kept in ADR-0030) broke it. It added a hidden chart step under another step, so that step's Visualizations showed charts its code never drew.
- People saw charts on `load` with no plotting in its code and could not tell where they came from.

## Decision
- **Visualizations shows only what the step's code draws:** figures on its `figure` ports, and plots a code step draws.
- **No Chart button.** Nothing in the UI adds a chart to another step. To chart a table, open it in code ("Explore in code") and write the plot there.
- **The chart operator stays.** `sprisk.profile.chart` is an ordinary step whose own Python draws a figure, so it follows the rule. Older flow versions use it and must still run.
- **A chart step is an ordinary step.** It shows on the canvas and its figure is in its own Visualizations. It is no longer hidden or shown inside the step it reads.
- Existing hidden chart steps are removed from flows by saving a new version without them. History keeps the old versions.

## Alternatives considered
- **A Chart button that writes plotting code into a code step.** Rejected for now: a second way to make a chart. It can come back as an editor helper that only inserts code.
- **Keep the button and label added charts.** Rejected: still a chart no code drew.

## Consequences (good and bad)
- Good: one rule for every tab. What you see is what the code drew.
- Bad: a quick chart needs a few lines of code.

## Validation
- Browser tests: no step offers a Chart button; a chart step shows on the canvas, not inside the step it reads.
- A code step that draws a plot shows it in Visualizations.
