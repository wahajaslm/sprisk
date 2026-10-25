import { type PointerEvent, useState } from "react";

import { InspectorDock } from "../../workbench/InspectorDock.tsx";
import { useWorkbench } from "../../workbench/workbench.ts";

const MIN_HEIGHT = 120;
const MAX_HEIGHT = 620;

/** The panel's height stays between its smallest and largest useful size. */
export const clampHeight = (h: number) => Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, h));

/** The Flow page's bottom panel: a dock of the selected step's tabs, 300px tall by default,
 * dragged taller or shorter by its top edge, folded to its tab bar or filling the centre. */
export function FlowInspector() {
  const collapsed = useWorkbench((s) => s.inspectorCollapsed);
  const maximized = useWorkbench((s) => s.inspectorMaximized);
  const [height, setHeight] = useState(300);

  // The handle captures the pointer, so the drag ends with the handle even if the panel goes.
  const [drag, setDrag] = useState<{ fromY: number; fromHeight: number }>();
  const startResize = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ fromY: e.clientY, fromHeight: height });
  };
  const resize = (e: PointerEvent<HTMLDivElement>) => {
    if (drag) setHeight(clampHeight(drag.fromHeight + drag.fromY - e.clientY));
  };

  return (
    <section
      className={`flow-inspector${collapsed ? " collapsed" : ""}${maximized ? " maximized" : ""}`}
      style={collapsed || maximized ? undefined : { height }}
      aria-label="Pipeline Inspector"
    >
      {!collapsed && !maximized && <div className="flow-inspector-resize" onPointerDown={startResize} onPointerMove={resize} onPointerUp={() => setDrag(undefined)} title="Drag to resize" aria-hidden="true" />}
      <InspectorDock />
    </section>
  );
}
