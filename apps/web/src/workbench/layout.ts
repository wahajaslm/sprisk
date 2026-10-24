import { readTab } from "./inspectorTabs.ts";

/** Saved dock layouts are UI preference only (arch §2A), versioned apart from scientific schemas. */
// v2: the left panel became the activity sidebar. v3: the Inspector became one dock panel per tab.
// v4: the Flow panel no longer has a Notebook view. v5: only the Flow page's bottom panel is a
// dock, and each of its panels is one Inspector tab.
export const LAYOUT_VERSION = 5;
export const LAYOUT_KEY = "sprisk.layout";

type SavedPanel = { contentComponent: string } & Record<string, unknown>;
export type SavedDock = { panels: Record<string, SavedPanel> } & Record<string, unknown>;

/** A panel the dock can show: an Inspector tab it knows. Anything else becomes a placeholder. */
const known = (panel: SavedPanel) => panel.contentComponent === "tab" && readTab(panel["params"]) !== undefined;

function isSavedDock(value: unknown): value is SavedDock {
  return typeof value === "object" && value !== null && "panels" in value && typeof value.panels === "object";
}

/** The saved dock, with unknown view types replaced; undefined means "use the default layout". */
export function restoreLayout(text: string | null): SavedDock | undefined {
  if (text === null) return undefined;
  let saved: unknown;
  try {
    saved = JSON.parse(text);
  } catch {
    return undefined; // unreadable preference: fall back to the default layout
  }
  if (typeof saved !== "object" || saved === null || !("version" in saved) || saved.version !== LAYOUT_VERSION) {
    return undefined;
  }
  const dock = "dock" in saved ? saved.dock : undefined;
  if (!isSavedDock(dock)) return undefined;
  const panels = Object.fromEntries(
    Object.entries(dock.panels).map(([id, panel]) => {
      if (known(panel)) return [id, panel];
      const { tabComponent: _tab, ...rest } = panel;
      return [id, { ...rest, contentComponent: "placeholder" }];
    }),
  );
  return { ...dock, panels };
}

export function saveLayout(dock: unknown): void {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify({ version: LAYOUT_VERSION, dock }));
  } catch {
    // Storage may be blocked (private window). The layout simply is not remembered.
  }
}

export function readSavedLayout(): string | null {
  try {
    return localStorage.getItem(LAYOUT_KEY);
  } catch {
    return null;
  }
}
