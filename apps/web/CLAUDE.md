# apps/web (workbench UI)

React + TypeScript + Vite. Presentation only. Arch doc §2A.

## Stack
dockview-react (behind an adapter), @xyflow/react, Radix + shadcn patterns, AG Grid Community, ECharts / Plotly via renderer registry, Monaco, TanStack Query (server state), Zustand (UI state).

## Rules
- `strict` TypeScript. No `any`. API types come from `src/generated` (from `contracts/`).
- The canvas edits a projection of `Pipeline`. Saving creates a new `PipelineVersion` via the API. The UI never compiles or validates graphs authoritatively.
- Docking library stays behind `src/workbench/dock-adapter`. No direct dockview imports elsewhere.
- View types register in the View Registry. They are separate from backend operators.
- Closing/moving a dock never mutates scientific objects. Layout state is UI preference only, versioned separately.
- Unknown view type in a saved layout → render a placeholder. Never crash.
- Never load a full dataset. Use paginated, filtered, aggregated API queries.
- Lazy-load heavy panels (React Flow, Monaco, chart libs). Hidden tabs must not recompute.
- Monaco edits code. It never executes it. Execution goes through the API.
- No AG Grid Enterprise or Dockview commercial features.
- Use `/new-view-type` to add a view.

## Performance (always)
- Lazy-load every heavy panel (`React.lazy` + `Suspense`): React Flow, Monaco, chart libraries, grids.
- Every list endpoint is paged (`?limit=`, `?before=`). Never request "all". Virtualize long lists and tables.
- Never pull a table into the browser. Fetch JSON artifacts only under a byte cap; show size and hash otherwise.
- Poll only while something is live (`isLive`), then stop. Never poll a finished run.
- Data that never changes (attempt outputs, artifact content) gets `staleTime: Infinity`.
- Hidden panels do no work. Effects depend on ids, not on objects that change identity every refetch.
- Measure before memoizing. Add `useMemo`/`useCallback` only when a profile shows the need.

## Consistency, modularity, reuse
- One way to do each thing: one API request function, one hook per resource, one query-state pattern.
- Before writing a component or hook, search `src/` for one that already does it. Extract on the third copy.
- Shared pieces live by job: API in `src/api`, flow helpers in `src/flow`, dock and selection in `src/workbench`, panels in `src/views`. No `utils` dumping ground.
- Studio tokens only (`src/styles/cockpit.css`): Geist / Geist Mono, near-black panels, hairline borders, red `#ff5c5c` only for problems. No new colors or fonts without a token.
- Same names as the contracts and the arch doc for the same concept.
- Small components with one job. Accessible by default: real buttons, labels, roles, visible focus, keyboard reachable.

## Checks
`pnpm lint && pnpm typecheck && pnpm test`

## Code style
- Function components and hooks. No class components.
- Server data only via TanStack Query hooks. UI state in Zustand. Never mix them.
- Handle every query state: loading, error, empty. Show errors; never hide them.
- Discriminated unions over boolean flags.
- Keep components small. Extract a hook when logic outgrows the JSX.
- No premature `useMemo`/`useCallback`. Add them when a profile shows the need.

## Tests
- Vitest + Testing Library. Test what the user sees and does, not implementation.
- Mock the API at the network edge (MSW). Not inside components.
- Playwright for the docking proof-of-concept gate (arch §2A).
