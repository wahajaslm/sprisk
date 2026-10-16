# ADR-0027: UI design system and data rendering
Status: Accepted
Date: 2026-10-16
Arch doc sections: §2A, §13

## Context
- The UI has rules for loading data (apps/web/CLAUDE.md) but no standard for how it looks or how each kind of data is shown.
- `cockpit.css` (527 lines) uses 12 font sizes and 18 spacing values. Changes are made one pixel at a time.
- `src/components/ui` is named in the rules but does not exist. Panels each build their own rows, headers and states.
- Data limits are mostly checked in the browser. `/artifacts/{id}/content` returns the whole file with no size cap. A view that forgets the check loads everything.
- Canvas layout (node sizes, stage spacing, edge direction) is not written down, so it drifts.

## Decision

### 1. Tokens (in `cockpit.css` `:root`, nothing else)
- Type scale, five sizes: `--text-xs` 11px, `--text-sm` 12px, `--text-md` 13px, `--text-lg` 16px, `--text-xl` 20px.
- Weights: 300 for large titles, 400 for body, 500 for emphasis. No other weights.
- Spacing on a 4px grid: `--space-1` 4px up to `--space-8` 32px.
- Colours stay as they are. A new colour needs a new token.
- Existing token names (`--sans`, `--mono`, `--soft`, `--line` and the rest) do not change. The Plotly renderer reads them at runtime.

### 2. Primitives in `src/components/ui`
- `PanelHeader`, `ListRow`, `SectionLabel`, `StatTile`, `QueryState` (loading, error, empty).
- `VirtualList`: the only way to render a list that can grow. Built on `@tanstack/react-virtual`, already a dependency.
- Panels compose these. They do not restyle them.

### 3. One renderer per kind of data

| Data | Renderer | Limit |
| --- | --- | --- |
| Table | `TablePeek` grid, server pages | 200 rows per page |
| List (runs, versions, events) | `VirtualList`, server pages | 200 per page |
| Metric | `StatTile` | — |
| Figure (ADR-0024) | figure renderer | 8 MB |
| Code display | Monaco, read-only | 4 MB |
| Console output (ADR-0025) | Monaco, read-only | 1 MB |
| Anything else | size and hash only | never fetched |

A new kind of data needs a row in this table first.

### 4. Hard limits, enforced in three places
- **Server:** `/artifacts/{id}/content` refuses anything over 8 MB (the largest renderer cap above) unless the request is a download. Lists keep the 1..=200 page limit.
- **API client:** `src/api` is the only place that calls `fetch`. It has no function that returns an unpaged list or uncapped content.
- `src/api` does not read UI stores (Zustand). Callers pass in what it needs, such as the selected run id.
- **Lint:** forbid `fetch` outside `src/api`, and `.map` that renders over a server list outside `VirtualList`.

### 5. Canvas
- Stages run left to right. Steps in a stage stack top to bottom. Edges follow the same rule.
- Node sizes per detail level and stage heading spacing live in `src/flow/layout.ts` constants, one place only.
- Canvas text uses the type scale tokens.

## Alternatives considered
- **Adopt a component library (shadcn, Radix themes).** Rejected for now. The look is set (ADR-0018). We need tokens and a few primitives, not a second style system.
- **Write guidelines only, no enforcement.** Rejected. That is what we have now, and it does not stop "fetch everything" mistakes.

## Consequences (good and bad)
- Good: one look, fewer one-off pixel fixes.
- Good: a view cannot fetch or draw unbounded data by accident. The server refuses it too.
- Good: new panels start from primitives, so they are quicker to build.
- Bad: migrating `cockpit.css` to tokens touches every panel. Done one area per commit.
- Bad: the server byte cap needs an API change and a contract update for the error.

## Validation
- `cockpit.css` uses only token font sizes and spacing. A CI grep fails on raw `px` font sizes.
- A test requests oversized content and gets a typed error, not the bytes.
- Lint fails on `fetch` outside `src/api`.
- No list in the UI renders more than one page of items without `VirtualList`.

## Arch doc edits
- §2A "Architecture and data flow": add the renderer table and the three-place limits.
- §2A "Stack": name `@tanstack/react-virtual` for long lists.
