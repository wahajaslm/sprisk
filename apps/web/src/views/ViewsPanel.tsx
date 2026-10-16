import { ADDABLE_VIEWS } from "../workbench/layout.ts";
import { useWorkbench } from "../workbench/workbench.ts";

/** Open more views, move docks, or go back to the Studio layout. */
export function ViewsPanel() {
  const { dock, editing, toggleEditing } = useWorkbench();
  return (
    <div className="sidebar-panel">
      <p className="sidebar-title">Views</p>
      <div className="sidebar-list">
        {ADDABLE_VIEWS.map((view) => (
          <button key={view.type} type="button" className="list-row" disabled={!dock} onClick={() => dock?.addView(view.type)}>
            <span className="plus" aria-hidden="true">+</span>
            <span className="row-main">
              <span className="row-title">{view.title}</span>
              <span className="row-meta">{view.description}</span>
            </span>
          </button>
        ))}
      </div>
      <p className="sidebar-title">Layout</p>
      <div className="sidebar-list">
        <button type="button" className="list-row" aria-pressed={editing} disabled={!dock} onClick={toggleEditing}>
          <span className="row-main">
            <span className="row-title">{editing ? "Done editing layout" : "Edit layout"}</span>
            <span className="row-meta">Show tab bars to move, split and close docks.</span>
          </span>
        </button>
        <button type="button" className="list-row" disabled={!dock} onClick={() => dock?.resetLayout()}>
          <span className="row-main">
            <span className="row-title">Reset to Studio layout</span>
            <span className="row-meta">Steps, Flow over Inspector, Copilot.</span>
          </span>
        </button>
      </div>
    </div>
  );
}
