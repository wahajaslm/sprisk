import React from "react";
import { useWorkbench } from "../../workbench/workbench.ts";
import { PanelToggleIcon } from "../../views/Icons.tsx";

export interface SidebarProps {
  title: string;
  search?: React.ReactNode;
  children?: React.ReactNode;
  /** The dashed add button at the foot of the list, e.g. New notebook. */
  add?: { label: string; onClick: () => void; disabled?: boolean };
  dock?: React.ReactNode;
  width?: number | string;
}

export function Sidebar({
  title,
  search,
  children,
  add,
  dock,
  width = "var(--size-sidebar)",
}: SidebarProps) {
  const { sidebarOpen, toggleSidebar } = useWorkbench();

  if (!sidebarOpen) {
    return (
      <aside className="main-sidebar sidebar-rail" aria-label={`${title} Rail`}>
        <button
          type="button"
          className="sidebar-toggle-btn"
          title={`Expand ${title} sidebar`}
          aria-label={`Expand ${title} sidebar`}
          onClick={toggleSidebar}
        >
          <PanelToggleIcon size={14} style={{ transform: "scaleX(-1)" }} />
        </button>
        <span
          className="sidebar-rail-label"
          role="button"
          tabIndex={0}
          onClick={toggleSidebar}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") toggleSidebar();
          }}
        >
          {title}
        </span>
      </aside>
    );
  }

  return (
    <aside className="main-sidebar" style={{ width }} aria-label={title}>
      <div className="sidebar-header">
        <div className="sidebar-title-row">
          <h2 className="sidebar-title">{title}</h2>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            className="sidebar-toggle-btn"
            title={`Collapse ${title} sidebar`}
            aria-label={`Collapse ${title} sidebar`}
            onClick={toggleSidebar}
          >
            <PanelToggleIcon size={14} style={{ transform: "scaleX(-1)" }} />
          </button>
        </div>
        {search && <div className="sidebar-search">{search}</div>}
      </div>
      <div className="sidebar-list">{children}</div>
      {add && (
        <div className="side-add">
          <button type="button" className="side-add-btn" disabled={add.disabled} onClick={add.onClick}>
            <span aria-hidden="true">+</span> {add.label}
          </button>
        </div>
      )}
      {dock && <div className="sidebar-dock">{dock}</div>}
    </aside>
  );
}
