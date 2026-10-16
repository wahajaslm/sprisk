import { useViewInstance } from "../workbench/instance.tsx";
import { PinButton, StepErrors, StepMeta, TabBody, TechSwitch, useStep } from "./inspector/step.tsx";
import { TAB_LABEL } from "../workbench/inspectorTabs.ts";

/** One Inspector tab in its own dock panel. Follows the selection unless pinned. */
export function StepTab() {
  const { tab } = useViewInstance();
  const step = useStep();
  if (!tab) return <p className="muted pad">This panel's tab is unknown. Close it and open the tab again from the Inspector.</p>;
  if (!step.nodeId) return <p className="muted pad">Select a step to see its {TAB_LABEL[tab].toLowerCase()}.</p>;
  return (
    <div className="inspector">
      <div className="panel-head">
        <span className="tab-title">{TAB_LABEL[tab]}</span>
        <StepMeta step={step} />
        <span className="spacer" />
        <TechSwitch />
        <PinButton step={step} />
      </div>
      <StepErrors step={step} />
      <div className="pane single">
        <TabBody tab={tab} step={step} />
      </div>
    </div>
  );
}
