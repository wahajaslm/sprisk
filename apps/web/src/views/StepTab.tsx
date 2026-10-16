import { useViewInstance } from "../workbench/instance.tsx";
import { TAB_LABEL } from "../workbench/inspectorTabs.ts";
import { StepErrors, TabBody, useStep } from "./inspector/step.tsx";

/** One question about the selected step (Data, Console, History, ...) as a dock panel.
 * Follows the selection unless pinned. Its step name and Pin sit in the dock tab bar (StepToolbar). */
export function StepTab() {
  const { tab } = useViewInstance();
  const step = useStep();
  if (!tab) return <p className="muted pad">This panel's tab is unknown. Close it and open the tab again from Views.</p>;
  if (!step.nodeId) return <p className="muted pad">Select a step to see its {TAB_LABEL[tab].toLowerCase()}.</p>;
  return (
    <div className="pane single step-pane">
      <StepErrors step={step} />
      <TabBody tab={tab} step={step} />
    </div>
  );
}
