import type { ReactNode } from "react";

import { type Activity, useWorkbench } from "../workbench/workbench.ts";
import { RunsIcon, StepsIcon, ViewsIcon } from "./Icons.tsx";

const ITEMS: { activity: Activity; label: string; icon: ReactNode }[] = [
  { activity: "steps", label: "Steps", icon: <StepsIcon /> },
  { activity: "runs", label: "Runs", icon: <RunsIcon /> },
  { activity: "views", label: "Views and layout", icon: <ViewsIcon /> },
];

/** VS Code-style activity bar: each icon picks the sidebar; the active one collapses it. */
export function ActivityBar() {
  const { activity, toggleActivity } = useWorkbench();
  return (
    <nav className="activity-bar" aria-label="Sidebar">
      {ITEMS.map((item) => (
        <button
          key={item.activity}
          type="button"
          className="activity"
          aria-label={item.label}
          aria-pressed={activity === item.activity}
          title={item.label}
          onClick={() => toggleActivity(item.activity)}
        >
          {item.icon}
        </button>
      ))}
    </nav>
  );
}
