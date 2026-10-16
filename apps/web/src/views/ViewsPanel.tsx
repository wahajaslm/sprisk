import { ListRow } from "../components/ui/ListRow.tsx";
import { INSPECTOR_TABS, TAB_LABEL } from "../workbench/inspectorTabs.ts";
import { useWorkbench } from "../workbench/workbench.ts";

/** Open more views, move docks, or go back to the Studio layout. */
export function ViewsPanel() {
  const { dock, editing, toggleEditing } = useWorkbench();
  return (
    <div className="sidebar-panel">
      <p className="sidebar-title">Inspector tabs</p>
      <div className="sidebar-list">
        {INSPECTOR_TABS.map((tab) => (
          <ListRow
            key={tab}
            title={TAB_LABEL[tab]}
            mark={<span className="plus" aria-hidden="true">+</span>}
            disabled={!dock}
            onClick={() => dock?.openTab(tab)}
          />
        ))}
      </div>
      <p className="sidebar-title">Layout</p>
      <div className="sidebar-list">
        <ListRow
          title={editing ? "Done editing layout" : "Edit layout"}
          meta="Show tab bars to move, split and close docks."
          pressed={editing}
          disabled={!dock}
          onClick={toggleEditing}
        />
        <ListRow
          title="Reset to Studio layout"
          meta="Steps, Flow over Inspector, Copilot."
          disabled={!dock}
          onClick={() => dock?.resetLayout()}
        />
      </div>
    </div>
  );
}
