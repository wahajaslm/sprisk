import { NAV, type Nav, useSelection } from "../workbench/selection.ts";
import {
  ObjectiveIcon,
  FlowIcon,
  DatasetsIcon,
  NotebooksIcon,
  MethodologyIcon,
  ExperimentsIcon,
  DeployIcon,
  ReportsIcon,
  SettingsIcon,
} from "./Icons.tsx";

const TAB_ICONS: Record<Nav, typeof ObjectiveIcon> = {
  Objective: ObjectiveIcon,
  Flow: FlowIcon,
  Datasets: DatasetsIcon,
  Notebooks: NotebooksIcon,
  Methodology: MethodologyIcon,
  Experiments: ExperimentsIcon,
  Deploy: DeployIcon,
  Reports: ReportsIcon,
  Settings: SettingsIcon,
};

/** Flow Studio 56px icon rail: one icon per tab, Settings at the bottom. */
export function ActivityBar() {
  const { nav, setNav } = useSelection();
  const mainTabs = NAV.filter((t) => t !== "Settings");

  return (
    <nav className="activity-bar" aria-label="Navigation Rail">
      <div className="activity-top">
        {mainTabs.map((tab) => {
          const Icon = TAB_ICONS[tab];
          const active = nav === tab;
          return (
            <button
              key={tab}
              type="button"
              className={`activity-btn ${active ? "active" : ""}`}
              aria-label={tab}
              aria-current={active ? "page" : undefined}
              title={tab}
              onClick={() => setNav(tab)}
            >
              <span className="activity-bar-indicator" />
              <Icon size={18} />
            </button>
          );
        })}
      </div>
      <div className="spacer" />
      <div className="activity-bottom">
        <button
          type="button"
          className={`activity-btn ${nav === "Settings" ? "active" : ""}`}
          aria-label="Settings"
          aria-current={nav === "Settings" ? "page" : undefined}
          title="Settings"
          onClick={() => setNav("Settings")}
        >
          <span className="activity-bar-indicator" />
          <SettingsIcon size={18} />
        </button>
      </div>
    </nav>
  );
}
