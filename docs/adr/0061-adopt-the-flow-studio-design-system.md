# ADR-0061: Adopt the Flow Studio design system
Status: Accepted
Date: 2026-10-23
Arch doc sections: §2A (workbench UI), §13 (design system). Supersedes the visual parts of ADR-0018, ADR-0027 and ADR-0035.

## Context
- `docs/design/sprisk-studio.html` (Oct 15) and ADR-0018 established the studio cockpit layout. ADR-0027 and ADR-0035 added token conventions and Monaco styling.
- The design has matured into the complete **Flow Studio design system** (`Flow Studio Design System.html`, `Flow Studio v11.html`, and `design-system 3/`).
- Where earlier documents and readmes differ from the live design HTML, the main HTML is authoritative: the accent is grey (not teal), and red `#ff5c5c` is the sole accent hue, reserved strictly for problems, warnings, aberrant data and leakage.
- Atlas is now **Objective**: the starting point of the studio where the user states their objective, answers initial methodology questions, and generates the pipeline into Flow. Reports is a distinct top-level page tracking the full ledger of decisions, reasoning and run evidence.

## Decision

### 1. Typography
- **Instrument Sans** for all UI surfaces, headers, body, and tabular numbers.
- **IBM Plex Mono** exclusively for code, terminal logs, and model signatures.
- Fonts are bundled locally via npm packages (`@fontsource-variable/instrument-sans` and `@fontsource/ibm-plex-mono`). Zero external calls to Google Fonts or CDN endpoints.
- Strict type scale: 30 (display/title) / 17 (stage head) / 15 (panel title) / 14 (row) / 13.5 (body) / 12.5 (meta) / 12 (micro). Weights: 400 (regular), 450 (book), 500 (medium), 550 (semibold). No bold (`font-weight: 700` is forbidden). Tabular figures (`font-variant-numeric: tabular-nums`) for all numbers.

### 2. Colour system: monochromatic plus one hue
- Surface palette: `--gray-0` `#08090b` (canvas obsidian), `--gray-1` `#0a0a0a` (app background), `--gray-2` `#121212` (main surface), `--gray-4` `#171717` (cards/stages), `--gray-6` `#1c1c1c` (menus/popovers), `--gray-7` `#222222`.
- Ink palette: `--ink-0` `#ffffff` down to `--ink-7` `#5a5a5a`.
- White-alpha lines and washes: `--alpha-04` through `--alpha-25`. Hairline borders and dividers only.
- Semantic hue: Red `#ff5c5c` (`--danger` / `--alert`) and its wash `rgba(255, 92, 92, 0.16)` is the only saturated hue in the application, used strictly for errors, warnings, failed checks, aberrant values, and leakage risk.
- The 5 step-kind colors (source, recipe, view, decision, model) and the VS Code notebook blue/green are removed. Steps are rendered with quiet grey glyphs and status dots.
- The token architecture is built so a future light theme is simply a second token mapping; dark theme ships first.

### 3. Shell and Navigation
- Continuous app frame with `10px` border radius, `7%` white border, and `8px` margin from the window edges.
- 48px top bar with 9 top tabs in order:
  `Objective · Flow · Datasets · Notebooks · Methodology · Experiments · Deploy · Reports · Settings`
- Active tab has a bottom underline indicator (`box-shadow: inset 0 -1px 0 var(--ink-1)`).
- 56px left icon rail with an icon per tab and Settings pinned at the bottom.
- 280px sidebar, fluid centre content, and 340px Copilot folding to a 44px rail.
- Docking stays (ADR-0010): `dockview-react` remains behind the workbench adapter, themed to seamlessly match the Flow Studio panel tokens and hairlines.

### 4. Content and Editorial Rules
- Sentence case everywhere: "Model file", "Recent predictions" (never ALL CAPS, never uppercase eyebrows).
- Numbers carry meaning: join facts with middle dot (`·`), matrix dimensions with `×`, and negative numbers with real minus (`−`).
- Short, factual, imperative actions. No exclamation marks, no marketing fluff, no emoji, and no decorative unicode icons.

## Consequences
- **Positive:** A cohesive, distraction-free visual language designed specifically for scientific rigor.
- **Positive:** Complete elimination of arbitrary colors and hard-coded pixel nudges across the workbench.
- **Positive:** Full local font bundling ensures offline capability and removes third-party network requests.
- **Migration:** All ad-hoc styling in `apps/web` is mapped to the token system, and existing components are restyled to match the reference specifications.

## Amendment (27 October 2026): copy the design's markup
- The user rejected the migration plan's rule "Never copy the design's JSX; restyle our own components to match".
- Restyling by eye drifted from the design. The design's FlowNode, StageCard, Slider and StatusDot went unused, and pages grew their own CSS.
- A component now copies the designx markup (the main screen in `Flow Studio Design System.html`) with its inline styles and values. It keeps our logic, data hooks, real buttons and keyboard access.
- Where the design and the app differ, the design's style and layout win. Our extra features stay, for example the bottom panel's collapse and expand, the sidebar fold and reopening closed tabs.
- The tokens the design's markup reads (`--t-*`, `--ink-rgb`, `--r-*`, `--ic-*`) live in `cockpit.css`, with the values its main screen renders. `designx.css` holds only the button reset, focus and hover states.
- Shell widths follow the main screen: rail 48px, sidebar 264px, Copilot 280px (44px folded).
