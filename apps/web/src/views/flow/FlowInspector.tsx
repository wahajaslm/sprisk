import { type PointerEvent, useState } from "react";

import { InspectorDock } from "../../workbench/InspectorDock.tsx";
import { useWorkbench } from "../../workbench/workbench.ts";

const MIN_HEIGHT = 120;
const MAX_HEIGHT = 620;

/** The Flow page's bottom panel: a dock of the selected step's tabs, 300px tall by default,
 * dragged taller or shorter by its top edge, folded to its tab bar or filling the centre. */
export function FlowInspector() {
  const collapsed = useWorkbench((s) => s.inspectorCollapsed);
  const maximized = useWorkbench((s) => s.inspectorMaximized);
  const [height, setHeight] = useState(300);

  const startResize = (start: PointerEvent<HTMLDivElement>) => {
    const fromY = start.clientY;
    const fromHeight = height;
    const move = (e: globalThis.PointerEvent) => setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, fromHeight + fromY - e.clientY)));
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };

  return (
    <section
      className={`flow-inspector${collapsed ? " collapsed" : ""}${maximized ? " maximized" : ""}`}
      style={collapsed || maximized ? undefined : { height }}
      aria-label="Flow Inspector"
    >
      {!collapsed && !maximized && <div className="flow-inspector-resize" onPointerDown={startResize} title="Drag to resize" aria-hidden="true" />}
      <InspectorDock />
    </section>
  );
}
