import type { MethodologyRule } from "@sprisk/contracts";
import { type KeyboardEvent, type PointerEvent, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { OnFlow } from "./ruleTree.ts";
import { type MapNode, type MapRoute, mapLayout, routePath } from "./mapLayout.ts";

type Props = {
  rules: MethodologyRule[];
  decided: Map<string, OnFlow>;
  path: boolean;
  /** A rule's id, or a route's (`<rule id>#<route id>`). */
  picked: string | undefined;
  onPick: (id: string) => void;
};

/** The methodology as one map a model walks, read left to right (ADR-0059): the shared trunk
 * on the middle line, a fork on the target, the supervised branch above and the unsupervised
 * below. Each decision is a mark for its level with its question above it; each route a dot
 * with its name, halfway to the decision it leads on to. Plain SVG, drawn once per change. */
export function MethodologyCanvas({ rules, decided, path, picked, onPick }: Props) {
  const map = useMemo(() => mapLayout(rules, decided, { path }), [rules, decided, path]);
  const box = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const drag = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | undefined>(undefined);
  const fit = () => {
    const el = box.current;
    if (el) setZoom(Math.max(0.2, Math.min(1.5, el.clientHeight / map.height)));
  };
  // Open fitted to the height, so the trunk and both branches show at once.
  useLayoutEffect(fit, [map.height]);

  const pickedRule = picked?.split("#")[0];
  const place = new Map(map.nodes.map((n) => [n.id, n]));
  const curve = (r: MapRoute) => routePath(r, place.get(r.from)!, place.get(r.to)!, place.get(r.to)!.kind === "end");
  const faint = map.routes.filter((r) => !r.loop).map(curve).join("");
  const loops = map.routes.filter((r) => r.loop).map(curve).join("");
  const fan = map.routes.filter((r) => r.from === pickedRule).map(curve).join("");
  const lit = map.routes.filter((r) => r.chosen).map(curve).join("");

  const onDown = (e: PointerEvent) => {
    const el = box.current;
    if (!el || e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop, moved: false };
  };
  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    const el = box.current;
    if (!d || !el) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
    el.scrollLeft = d.left - dx;
    el.scrollTop = d.top - dy;
  };
  // A drag that moved is a pan, not a click on what it started over.
  const choose = (id: string) => {
    if (!drag.current?.moved) onPick(id);
  };
  const keys = (id: string) => (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onPick(id);
    }
  };

  return (
    <div className="mth-cmap" role="region" aria-label="Methodology canvas">
      <div className="mth-cmap-zoom">
        <button type="button" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.2, z / 1.25))}>−</button>
        <button type="button" onClick={fit}>Fit</button>
        <button type="button" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(2, z * 1.25))}>+</button>
      </div>
      <div className="mth-cmap-view" ref={box} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={() => setTimeout(() => (drag.current = undefined))} onPointerLeave={() => (drag.current = undefined)}>
        <svg width={Math.round(map.width * zoom)} height={Math.round(map.height * zoom)} viewBox={`0 0 ${map.width} ${map.height}`} role="group" aria-label="Methodology map canvas">
          {map.bands.map((b) => (
            <g key={b.key} className={`mth-cmap-band${b.live ? " live" : ""}`}>
              <rect x={b.left} y={b.top} width={b.width} height={b.height} />
              <line x1={b.left} y1={b.top} x2={b.left} y2={b.top + b.height} />
              <text x={b.left + 12} y={b.top + 30} className="title">{b.title}</text>
              <text x={b.left + 12} y={b.top + 48} className="caption">{b.caption}</text>
            </g>
          ))}
          {map.lanes.map((l) => (
            <text key={l.lane} x={l.lane === "trunk" ? 92 : (place.get("fork")?.x ?? 0) + 120} y={l.y} className="mth-cmap-lane">{l.caption}</text>
          ))}
          <path d={faint} className="mth-cmap-route" />
          <path d={loops} className="mth-cmap-route loop" />
          {fan && <path d={fan} className="mth-cmap-route fan" />}
          {lit && (
            <>
              <path d={lit} className="mth-cmap-lit glow" />
              <path d={lit} className="mth-cmap-lit" />
            </>
          )}
          {map.routes.map((r) => {
            const real = r.from !== "fork";
            const id = r.id.endsWith("#best") ? r.from : r.id;
            const tone = r.chosen ? " chosen" : r.from === pickedRule || picked === r.id ? " near" : "";
            return (
              <g
                key={r.id}
                className={`mth-cmap-dot${tone}${real ? " pick" : ""}`}
                role={real ? "button" : undefined}
                tabIndex={real ? 0 : undefined}
                aria-label={real ? r.name : undefined}
                aria-pressed={real ? picked === r.id : undefined}
                onClick={real ? () => choose(id) : undefined}
                onKeyDown={real ? keys(id) : undefined}
              >
                <title>{r.title}</title>
                <circle cx={r.x} cy={r.y} r={10} className="hit" />
                <circle cx={r.x} cy={r.y} r={r.chosen ? 3 : 2.5} className="mark" />
                <text x={r.x} y={r.y - 9}>{r.label}</text>
              </g>
            );
          })}
          {map.nodes.map((n) => (
            <Node key={n.id} node={n} selected={n.id === pickedRule} onPick={choose} keys={keys} />
          ))}
        </svg>
      </div>
    </div>
  );
}

function Node({ node, selected, onPick, keys }: { node: MapNode; selected: boolean; onPick: (id: string) => void; keys: (id: string) => (e: KeyboardEvent) => void }) {
  const { x, y } = node;
  const settled = node.kind === "decision" && node.decided !== undefined;
  const tone = `${settled ? " settled" : ""}${node.onPath ? " on" : ""}${selected ? " selected" : ""}${node.kind === "decision" && node.rule.status === "draft" ? " draft" : ""}`;
  const top = y - node.lift - 14 * (node.lines.length - 1);
  const words = node.lines.map((line, i) => (
    <text key={i} x={x} y={top + i * 14} className="label">
      {line}
    </text>
  ));
  if (node.kind !== "decision") {
    return (
      <g className={`mth-cmap-node ${node.kind}${tone}`}>
        {words}
        {node.kind === "end" ? (
          <>
            <circle cx={x} cy={y} r={12} className="mark" />
            <text x={x + 22} y={y - 4} className="end-title">TEST ROWS</text>
            <text x={x + 22} y={y + 13} className="end-note">scored once, at the end</text>
          </>
        ) : (
          <circle cx={x} cy={y} r={7} className="mark solid" />
        )}
      </g>
    );
  }
  const mark =
    node.level === "try" ? (
      <>
        <circle cx={x} cy={y} r={7} className="mark ring" />
        <circle cx={x} cy={y} r={3} className="mark solid" />
      </>
    ) : node.level === "ask" ? (
      <polygon points={`${x},${y - 9} ${x + 9},${y} ${x},${y + 9} ${x - 9},${y}`} className="mark ring" />
    ) : (
      <circle cx={x} cy={y} r={7} className="mark solid" />
    );
  return (
    <g className={`mth-cmap-node decision${tone}`} role="button" tabIndex={0} aria-label={node.rule.name} aria-pressed={selected} onClick={() => onPick(node.id)} onKeyDown={keys(node.id)}>
      <title>{node.rule.question ?? node.rule.name}</title>
      <rect x={x - 62} y={top - 14} width={124} height={y + 16 - (top - 14)} rx={6} className="hit" />
      {words}
      {selected && <circle cx={x} cy={y} r={14} className="halo" />}
      {mark}
    </g>
  );
}
