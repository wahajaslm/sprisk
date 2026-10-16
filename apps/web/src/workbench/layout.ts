/** Saved dock layouts are UI preference only (arch §2A), versioned apart from scientific schemas. */
// v2: the left panel became the activity sidebar. v3: the Inspector became one dock panel per tab.
export const LAYOUT_VERSION = 3;
export const LAYOUT_KEY = "sprisk.layout";

/** View types the cockpit can render. Anything else in a saved layout becomes a placeholder. */
export const VIEW_TYPES = ["sidebar", "flow", "copilot", "step-tab", "placeholder"] as const;
export type ViewType = (typeof VIEW_TYPES)[number];

/** Studio regions with their own headers; their tab bars stay hidden outside Edit layout. */
export const HEADED_PANELS = ["sidebar", "flow", "copilot"] as const;

type SavedPanel = { contentComponent: string } & Record<string, unknown>;
export type SavedDock = { panels: Record<string, SavedPanel> } & Record<string, unknown>;

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
  const known: readonly string[] = VIEW_TYPES;
  const panels = Object.fromEntries(
    Object.entries(dock.panels).map(([id, panel]) => [
      id,
      known.includes(panel.contentComponent) ? panel : { ...panel, contentComponent: "placeholder" },
    ]),
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
