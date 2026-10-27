import React from "react";
import { useWorkbench } from "../../workbench/workbench.ts";
import { PaneFoldIcon } from "../../views/Icons.tsx";

export interface SidebarProps {
  title: string;
  /** A segmented switch between what the list shows, e.g. Pipeline · Operators · Plugins. */
  modes?: React.ReactNode;
  search?: React.ReactNode;
  children?: React.ReactNode;
  /** The dashed add button at the foot of the list, e.g. New notebook. */
  add?: { label: string; onClick: () => void; disabled?: boolean };
  dock?: React.ReactNode;
  width?: number | string;
}

const FOLD_BUTTON = { width: "26px", height: "26px", borderRadius: "var(--r-sm,6px)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "var(--t-muted,#ababab)", flexShrink: "0" } as const;

/** A page's sidebar pane, copied from the design's main screen: title, switch, search, the list,
 * an add button and the Info dock. It folds to a rail, as Copilot does. */
export function Sidebar({ title, modes, search, children, add, dock, width = "var(--size-sidebar)" }: SidebarProps) {
  const { sidebarOpen, toggleSidebar } = useWorkbench();

  if (!sidebarOpen) {
    return (
      <aside aria-label={`${title} Rail`} style={{ width: "var(--size-copilot-rail)", flexShrink: "0", background: "var(--bg-surface,#121212)", display: "flex", flexDirection: "column", alignItems: "center", gap: "12px", paddingTop: "10px", minHeight: "0" }}>
        <button type="button" className="dx-btn dx-h-06t" title={`Expand ${title} sidebar`} aria-label={`Expand ${title} sidebar`} onClick={toggleSidebar} style={FOLD_BUTTON}>
          <PaneFoldIcon side="left" open={false} />
        </button>
        <button type="button" className="dx-btn" onClick={toggleSidebar} style={{ writingMode: "vertical-rl", fontSize: "12.5px", color: "var(--t-muted,#ababab)", cursor: "pointer" }}>
          {title}
        </button>
      </aside>
    );
  }

  return (
    <aside aria-label={title} style={{ width, flexShrink: "0", background: "var(--bg-surface,#121212)", minHeight: "0", minWidth: "0", overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "16px 14px 10px", display: "flex", flexDirection: "column", gap: "10px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", minHeight: "22px" }}>
          <h2 style={{ margin: "0", fontSize: "15px", fontWeight: "500" }}>{title}</h2>
          <button type="button" className="dx-btn dx-h-06t" title={`Collapse ${title} sidebar`} aria-label={`Collapse ${title} sidebar`} onClick={toggleSidebar} style={{ ...FOLD_BUTTON, margin: "-2px -6px -2px 0" }}>
            <PaneFoldIcon side="left" open />
          </button>
        </div>
        {modes}
        {search}
      </div>
      <div style={{ flex: "1", overflow: "auto", padding: "0 6px 10px", display: "flex", flexDirection: "column", gap: "2px" }}>{children}</div>
      {add && (
        <div style={{ padding: "0 12px 10px" }}>
          <button type="button" className="dx-btn dx-h-05" disabled={add.disabled} onClick={add.onClick} style={{ width: "100%", height: "32px", borderRadius: "var(--r-sm,6px)", border: "1px dashed rgba(var(--ink-rgb,255,255,255),0.16)", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", fontSize: "13px", color: "var(--t-secondary,#d4d4d4)", cursor: "pointer" }}>
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
              <path d="M6 2v8M2 6h8" />
            </svg>
            {add.label}
          </button>
        </div>
      )}
      {dock}
    </aside>
  );
}
