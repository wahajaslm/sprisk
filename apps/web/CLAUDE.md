# apps/web (workbench UI)

React + TypeScript + Vite. Presentation only. Arch doc §2A.

## Stack
dockview-react (behind an adapter), @xyflow/react, Radix + shadcn patterns, AG Grid Community, ECharts / Plotly via renderer registry, Monaco, TanStack Query (server state), Zustand (UI state).

## Rules
- `strict` TypeScript. No `any`. API types come from `src/generated` (from `contracts/`).
- The canvas edits a projection of `PipelineSpec`. Saving creates a new `PipelineRevision` via the API. The UI never compiles or validates graphs authoritatively.
- Docking library stays behind `src/workbench/dock-adapter`. No direct dockview imports elsewhere.
- View types register in the View Registry. They are separate from backend operators.
- Closing/moving a dock never mutates scientific objects. Layout state is UI preference only, versioned separately.
- Unknown view type in a saved layout → render a placeholder. Never crash.
- Never load a full dataset. Use paginated, filtered, aggregated API queries.
- Lazy-load heavy panels (React Flow, Monaco, chart libs). Hidden tabs must not recompute.
- Monaco edits code. It never executes it. Execution goes through the API.
- No AG Grid Enterprise or Dockview commercial features.
- Use `/new-view-type` to add a view.

## Checks
`pnpm lint && pnpm typecheck && pnpm test`
