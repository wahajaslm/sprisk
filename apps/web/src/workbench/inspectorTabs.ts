/** The Inspector's tabs, one question each. Each can also open in its own dock panel. */
export const INSPECTOR_TABS = ["data", "visuals", "console", "inputs", "parameters", "code", "checks", "performance", "history"] as const;
export type InspectorTab = (typeof INSPECTOR_TABS)[number];

export const TAB_LABEL: Record<InspectorTab, string> = {
  data: "Data",
  visuals: "Visualizations",
  console: "Console",
  inputs: "Inputs",
  parameters: "Parameters",
  code: "Code",
  checks: "Checks",
  performance: "Performance",
  history: "History",
};

/** Drag data type for pulling a tab out of the Inspector onto the dock. */
export const TAB_DRAG_TYPE = "application/x-sprisk-inspector-tab";

export const isInspectorTab = (value: unknown): value is InspectorTab =>
  typeof value === "string" && (INSPECTOR_TABS as readonly string[]).includes(value);

/** Saved layouts are untrusted preference data; accept only a known tab. */
export function readTab(params: unknown): InspectorTab | undefined {
  if (typeof params !== "object" || params === null || !("tab" in params)) return undefined;
  return isInspectorTab(params.tab) ? params.tab : undefined;
}
