/** The Inspector: one dock panel per question about the selected step. */
export const INSPECTOR_TABS = ["data", "visuals", "console", "inputs", "parameters", "code", "checks", "performance", "history"] as const;
export type InspectorTab = (typeof INSPECTOR_TABS)[number];

export const TAB_LABEL: Record<InspectorTab, string> = {
  data: "Data",
  visuals: "Visualizations",
  console: "Console",
  inputs: "Inputs",
  parameters: "Parameters",
  code: "Code",
  checks: "Methodology",
  performance: "Performance",
  history: "History",
};

export const isInspectorTab = (value: unknown): value is InspectorTab =>
  typeof value === "string" && (INSPECTOR_TABS as readonly string[]).includes(value);

/** Saved layouts are untrusted preference data; accept only a known tab. */
export function readTab(params: unknown): InspectorTab | undefined {
  if (typeof params !== "object" || params === null || !("tab" in params)) return undefined;
  return isInspectorTab(params.tab) ? params.tab : undefined;
}

/** Tabs with no open panel, so the user can bring them back. */
export const closedTabs = (open: readonly InspectorTab[]): InspectorTab[] => INSPECTOR_TABS.filter((t) => !open.includes(t));
