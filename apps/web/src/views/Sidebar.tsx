import { useWorkbench } from "../workbench/workbench.ts";
import { RunsList } from "./RunsList.tsx";
import { StepLibrary } from "./StepLibrary.tsx";
import { ViewsPanel } from "./ViewsPanel.tsx";

/** The left dock region: its content follows the activity bar. */
export function Sidebar() {
  const activity = useWorkbench((s) => s.activity);
  if (activity === "runs") return <RunsList />;
  if (activity === "views") return <ViewsPanel />;
  return <StepLibrary />;
}
