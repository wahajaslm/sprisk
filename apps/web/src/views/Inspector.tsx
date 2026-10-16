import * as Tabs from "@radix-ui/react-tabs";
import { useState } from "react";

import { useWorkbench } from "../workbench/workbench.ts";
import { PopOutIcon } from "./Icons.tsx";
import { PinButton, StepErrors, StepMeta, TabBody, TechSwitch, useStep } from "./inspector/step.tsx";
import { INSPECTOR_TABS, type InspectorTab, isInspectorTab, TAB_DRAG_TYPE, TAB_LABEL } from "../workbench/inspectorTabs.ts";

type TabMark = { badge?: string; alert?: boolean; muted?: boolean };

/** Everything about one step, one question per tab: what it produced (Data, Visualizations),
 * what happened (Console, Performance), what went in (Inputs, Parameters, Code), whether to
 * trust it (Checks) and how it changed (History). Any tab can open in its own dock panel. */
export function Inspector() {
  const step = useStep();
  const [active, setActive] = useState<InspectorTab>("data");
  const dock = useWorkbench((s) => s.dock);
  const { nodeId, visuals, problems, concernCount } = step;

  if (!nodeId) return <p className="muted pad">Select a step to see its data, figures, console, inputs, settings, code, checks and history.</p>;
  const marks: Partial<Record<InspectorTab, TabMark>> = {
    visuals: visuals > 0 ? { badge: String(visuals) } : { muted: true },
    console: problems > 0 ? { badge: `⚠ ${problems}`, alert: true } : {},
    checks: concernCount > 0 ? { badge: `⚠ ${concernCount}`, alert: true } : {},
    performance: { muted: true },
  };

  return (
    <Tabs.Root className="inspector" value={active} onValueChange={(v) => isInspectorTab(v) && setActive(v)}>
      <div className="panel-head">
        <Tabs.List className="tabs" aria-label="Inspector">
          {INSPECTOR_TABS.map((tab) => {
            const mark = marks[tab] ?? {};
            return (
              <Tabs.Trigger
                key={tab}
                value={tab}
                className={mark.muted ? "muted-tab" : undefined}
                aria-label={tab === "checks" && concernCount > 0 ? `Checks, ${concernCount} to review` : undefined}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(TAB_DRAG_TYPE, tab);
                  e.dataTransfer.effectAllowed = "copy";
                }}
              >
                {TAB_LABEL[tab]}
                {mark.badge && (
                  <>
                    {" "}
                    <span className={`tab-badge${mark.alert ? " alert" : ""}`}>{mark.badge}</span>
                  </>
                )}
              </Tabs.Trigger>
            );
          })}
        </Tabs.List>
        <StepMeta step={step} />
        <span className="spacer" />
        <TechSwitch />
        {dock && (
          <button
            type="button"
            className="pin"
            aria-label={`Open ${TAB_LABEL[active]} in its own panel`}
            title="Open in panel. You can also drag a tab onto the workspace."
            onClick={() => dock.openTab(active)}
          >
            <PopOutIcon />
          </button>
        )}
        <PinButton step={step} />
      </div>
      <StepErrors step={step} />
      {INSPECTOR_TABS.map((tab) => (
        <Tabs.Content key={tab} value={tab} className="pane single">
          <TabBody tab={tab} step={step} />
        </Tabs.Content>
      ))}
    </Tabs.Root>
  );
}
