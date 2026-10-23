import { useState } from "react";
import { INSPECTOR_TABS, type InspectorTab, TAB_LABEL } from "../../workbench/inspectorTabs.ts";
import { useStep, TabBody } from "../inspector/step.tsx";
import { ViewInstance } from "../../workbench/instance.tsx";

export function FlowInspector() {
  const [activeTab, setActiveTab] = useState<InspectorTab>("checks");
  const [collapsed, setCollapsed] = useState(false);
  const [maximized, setMaximized] = useState(false);

  const step = useStep();
  const { nodeId } = step;

  return (
    <div
      className={`flow-inspector ${collapsed ? "collapsed" : ""} ${maximized ? "maximized" : ""}`}
      aria-label="Flow Inspector"
    >
      {/* Header bar */}
      <div className="flow-inspector-header">
        <div className="flow-inspector-tabs" role="tablist" aria-label="Inspector tabs">
          {INSPECTOR_TABS.map((tab) => {
            const isActive = activeTab === tab;
            return (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={`flow-inspector-tab-btn ${isActive ? "active" : ""}`}
                onClick={() => {
                  setActiveTab(tab);
                  if (collapsed) setCollapsed(false);
                }}
              >
                {TAB_LABEL[tab]}
                {tab === "checks" && step.concernCount > 0 && (
                  <span className="flow-tab-badge alert">⚠ {step.concernCount}</span>
                )}
                {tab === "console" && step.problems > 0 && (
                  <span className="flow-tab-badge alert">⚠ {step.problems}</span>
                )}
              </button>
            );
          })}
        </div>

        <div className="flow-inspector-actions">
          <button
            type="button"
            className="flow-inspector-btn"
            title={maximized ? "Restore" : "Maximize"}
            aria-label={maximized ? "Restore panel" : "Maximize panel"}
            onClick={() => {
              setMaximized((m) => !m);
              if (collapsed) setCollapsed(false);
            }}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              {maximized ? (
                <path d="M4 1v3H1m11-3h3v3m0 8v3h-3m-8 0H1v-3" />
              ) : (
                <path d="M1 5V1h4m6 0h4v4m0 6v4h-4m-6 0H1v-4" />
              )}
            </svg>
          </button>
          <button
            type="button"
            className="flow-inspector-btn"
            title={collapsed ? "Expand" : "Collapse"}
            aria-label={collapsed ? "Expand panel" : "Collapse panel"}
            onClick={() => setCollapsed((c) => !c)}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              style={{ transform: collapsed ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}
            >
              <path d="M3 6l5 5 5-5" />
            </svg>
          </button>
        </div>
      </div>

      {/* Body */}
      {!collapsed && (
        <div className="flow-inspector-body">
          <ViewInstance pin={undefined} setPin={undefined} tab={activeTab}>
            {nodeId ? (
              <TabBody tab={activeTab} step={step} />
            ) : (
              <div className="flow-inspector-empty">
                <p className="muted">Select a step in the flow to inspect its {TAB_LABEL[activeTab].toLowerCase()}.</p>
              </div>
            )}
          </ViewInstance>
        </div>
      )}
    </div>
  );
}
