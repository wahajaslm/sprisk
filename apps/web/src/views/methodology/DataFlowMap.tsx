import type { Method, Operator } from "@sprisk/contracts";
import { useMemo } from "react";

import { dataFlow, type Lane } from "./dataFlow.ts";
import { MethodDetail } from "./DecisionOrderMap.tsx";
import { numbered } from "./decisionOrder.ts";

/** Sizes of the lanes area, in pixels. Each lane is one straight line; its steps sit on it. */
const LANE = 72;
const BOX_H = 40;
const TRUNK_X = 8;
const LABEL = { x: 24, width: 100 };
const STEPS_X = 136;
const STEP = { width: 144, gap: 16 };
const MODEL_W = 170;
const MODEL_H = 72;

/** What the methods do to the data, top to bottom then left to right: the decisions with no
 * step, the steps on the whole table up to the split, then one lane per kind of model input,
 * the merge and the model. A step changing two kinds spans both lanes, so it shows where they
 * meet; lanes never touch otherwise. */
export function DataFlowMap({ methods, operators, picked, onPick }: { methods: Method[]; operators: Operator[]; picked: string | undefined; onPick: (id: string) => void }) {
  const flow = useMemo(() => dataFlow(methods), [methods]);
  const ordered = useMemo(() => numbered(methods), [methods]);
  const current = ordered.find((m) => m.method.id === picked) ?? ordered[0];
  const order = (m: Method) => ordered.find((o) => o.method.id === m.id)?.order;
  const lanesH = Math.max(1, flow.lanes.length) * LANE;
  const mid = lanesH / 2;
  const laneY = (i: number) => i * LANE + LANE / 2;
  const mergeX = STEPS_X + flow.columns * (STEP.width + STEP.gap);
  const modelX = mergeX + 40;
  const afterX = modelX + MODEL_W + 40;
  const width = afterX + (flow.afterModel.length > 0 ? 170 : 0) + 8;

  const button = (m: Method, className: string, style?: React.CSSProperties) => (
    <button key={m.id} type="button" className={`mth-data-step ${className}`} style={style} aria-pressed={m.id === current?.method.id} onClick={() => onPick(m.id)}>
      <span className="mth-node-code">{order(m)}</span> {m.name}
    </button>
  );

  return (
    <div className="mth-order-wrap">
      <div className="mth-data" role="region" aria-label="Data flow">
        {flow.noStep.length > 0 && (
          <section className="mth-data-row" aria-label="Decided first">
            <span className="mth-data-caption">Decided first · no step, read by later decisions</span>
            <span className="mth-data-chips">{flow.noStep.map((m) => button(m, "chip"))}</span>
          </section>
        )}
        <section className="mth-data-row" aria-label="Whole table">
          <span className="mth-data-caption">Whole table · in this order, before the split</span>
          <span className="mth-data-chips">
            {flow.table.map((m) => (
              <span key={m.id} className="mth-data-then">
                {button(m, "chip")}→
              </span>
            ))}
            {flow.split ? button(flow.split, "chip split") : <span className="muted">no split method</span>}
          </span>
        </section>
        <section className="mth-data-row scroll" aria-label="Model inputs">
          <span className="mth-data-caption">Model inputs · fitted on the train rows, each kind in its own lane</span>
          <div className="mth-data-lanes" style={{ width, height: lanesH }}>
            <svg className="mth-data-lines" width={width} height={lanesH} aria-hidden="true">
              {/* From the split, down into every lane. */}
              <path d={`M${TRUNK_X} 0V${laneY(flow.lanes.length - 1)}`} />
              {flow.lanes.map((lane, i) => (
                <path key={lane.kind} d={`M${TRUNK_X} ${laneY(i)}H${mergeX}`} />
              ))}
              <path d={`M${mergeX} ${laneY(0)}V${laneY(Math.max(0, flow.lanes.length - 1))}`} className="merge" />
              <path d={`M${mergeX} ${mid}H${modelX}`} />
              {flow.afterModel.length > 0 && <path d={`M${modelX + MODEL_W} ${mid}H${afterX}`} />}
            </svg>
            {flow.lanes.map((lane, i) => (
              <div key={lane.kind} className="mth-data-lane" style={{ left: LABEL.x, top: laneY(i) - BOX_H / 2, width: LABEL.width, height: BOX_H }}>
                <strong>{lane.label}</strong>
                {onlyWith(lane) && <span>only with {onlyWith(lane)} files</span>}
              </div>
            ))}
            {flow.lanes.flatMap((lane, i) =>
              lane.steps
                // A step spanning lanes is drawn once, from its top lane.
                .filter((s) => s.lanes[0] === lane.kind)
                .map((s) => button(s.method, s.lanes.length > 1 ? "step span" : "step", { left: STEPS_X + s.column * (STEP.width + STEP.gap), top: laneY(i) - BOX_H / 2, width: STEP.width, height: (s.lanes.length - 1) * LANE + BOX_H })),
            )}
            <span className="mth-data-caption merge" style={{ left: mergeX - 20, top: laneY(0) - BOX_H / 2 - 18 }}>
              merge
            </span>
            <div className="mth-data-block model" style={{ left: modelX, top: mid - MODEL_H / 2, width: MODEL_W, height: MODEL_H }}>
              <span className="mth-data-caption">Model</span>
              {flow.model.map((m) => button(m, "chip"))}
            </div>
            {flow.afterModel.length > 0 && (
              <div className="mth-data-block" style={{ left: afterX, top: mid - 36, width: 170, height: 72 }}>
                <span className="mth-data-caption">On its output</span>
                {flow.afterModel.map((m) => button(m, "chip"))}
              </div>
            )}
          </div>
        </section>
      </div>
      {current && (
        <aside className="mth-order-card">
          <MethodDetail key={current.method.id} current={current} all={ordered} operators={operators} onPick={onPick} />
        </aside>
      )}
    </div>
  );
}

/** The files a lane needs bound to the question's rows, when every step on it needs them. */
function onlyWith(lane: Lane): string | undefined {
  const assets = lane.steps.map((s) => s.method.applies_when?.assets ?? []);
  return assets.every((a) => a.length > 0) ? [...new Set(assets.flat())].join(" and ") : undefined;
}
