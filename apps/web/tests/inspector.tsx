import * as Tabs from "@radix-ui/react-tabs";

import { StepTabLabel } from "../src/views/inspector/step.tsx";
import { StepTab } from "../src/views/StepTab.tsx";
import { type Pin, ViewInstance } from "../src/workbench/instance.tsx";
import { INSPECTOR_TABS } from "../src/workbench/inspectorTabs.ts";

/** The Inspector tab group as the dock shows it: real tab labels over real panels. The dock
 * itself needs a browser layout engine, so tests stand in for it here (checked in Chrome). */
export function Inspector({ pin, setPin }: { pin?: Pin; setPin?: (pin: Pin | undefined) => void }) {
  return (
    <Tabs.Root defaultValue="data">
      <Tabs.List aria-label="Inspector">
        {INSPECTOR_TABS.map((tab) => (
          <Tabs.Trigger key={tab} value={tab}>
            <ViewInstance pin={pin} setPin={undefined} tab={tab}>
              <StepTabLabel />
            </ViewInstance>
          </Tabs.Trigger>
        ))}
      </Tabs.List>
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
