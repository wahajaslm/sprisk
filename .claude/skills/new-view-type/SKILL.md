---
name: new-view-type
description: Add a workbench view type to the web View Registry. Use when adding a dockable panel such as a chart, table, inspector, or editor view.
---
# Add a workbench view type

Arch doc §2A.

1. Define a `ViewType`: stable ID, renderer, accepted artifact/context kinds, actions, serialization version.
2. Register it in `apps/web/src/workbench/view-registry`.
3. The renderer reads data only via TanStack Query hooks on paginated/aggregated API endpoints.
4. Support `follow_selection` and `pinned` modes from `WorkbenchContext`.
5. Lazy-load heavy libraries. Do no work while hidden.
6. Tests: renders with a pinned context; survives resize/move; a layout with an unknown version renders the placeholder.
7. No scientific mutation from the view except through explicit API actions.
