import * as Tabs from "@radix-ui/react-tabs";
import { useState } from "react";

import { StepTabLabel, StepToolbar } from "../src/views/inspector/step.tsx";
import { StepTab } from "../src/views/StepTab.tsx";
import { type Pin, ViewInstance } from "../src/workbench/instance.tsx";
import { INSPECTOR_TABS, type InspectorTab, isInspectorTab } from "../src/workbench/inspectorTabs.ts";

/** The Inspector tab group as the dock shows it: real tab labels, the active tab's toolbar at the
 * right of the tab bar, and real panels. The dock needs a browser layout engine, so tests stand in
 * for it here (checked in Chrome). */
export function Inspector({ pin, setPin }: { pin?: Pin; setPin?: (pin: Pin | undefined) => void }) {
  const [active, setActive] = useState<InspectorTab>("data");
  return (
    <Tabs.Root value={active} onValueChange={(v) => isInspectorTab(v) && setActive(v)}>
      <Tabs.List aria-label="Inspector">
        {INSPECTOR_TABS.map((tab) => (
          <Tabs.Trigger key={tab} value={tab}>
            <ViewInstance pin={pin} setPin={undefined} tab={tab}>
              <StepTabLabel />
            </ViewInstance>
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      <ViewInstance pin={pin} setPin={setPin} tab={active}>
        <StepToolbar />
      </ViewInstance>
      {INSPECTOR_TABS.map((tab) => (
        <Tabs.Content key={tab} value={tab}>
          <ViewInstance pin={pin} setPin={setPin} tab={tab}>
            <StepTab />
          </ViewInstance>
        </Tabs.Content>
      ))}
    </Tabs.Root>
  );
}
