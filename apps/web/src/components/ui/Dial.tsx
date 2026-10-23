import React from "react";

export interface DialProps {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  recommended?: number;
  size?: number;
  onChange?: (v: number) => void;
}

export function Dial({
  value,
  min = 0,
  max = 1,
  step = 0.01,
  recommended,
  size = 128,
  onChange,
}: DialProps) {
  const ref = React.useRef<SVGSVGElement>(null);
  const C = size / 2;
  const f = Math.max(0, Math.min(1, (value - min) / (max - min || 1)));
  const pt = (t: number, r: number): [number, number] => {
    const a = ((-135 + t * 270) * Math.PI) / 180;
    return [C + Math.sin(a) * r, C - Math.cos(a) * r];
  };

  const at = (e: MouseEvent | React.MouseEvent) => {
    if (!ref.current) return;
    const b = ref.current.getBoundingClientRect();
    let a =
      (Math.atan2(e.clientX - (b.left + b.width / 2), -(e.clientY - (b.top + b.height / 2))) * 180) /
      Math.PI;
    a = Math.max(-135, Math.min(135, a));
    let v = min + ((a + 135) / 270) * (max - min);
    v = Math.round(v / step) * step;
    onChange && onChange(+Math.max(min, Math.min(max, v)).toFixed(4));
  };

  const down = (e: React.MouseEvent) => {
    e.preventDefault();
    at(e);
    const mv = (ev: MouseEvent) => at(ev);
    const up = () => {
      window.removeEventListener("mousemove", mv);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", mv);
    window.addEventListener("mouseup", up);
  };

  const ticks: React.ReactNode[] = [];
  const s = size / 128;
  for (let i = 0; i <= 64; i++) {
    const t = i / 64;
    const major = i % 8 === 0;
    const [x1, y1] = pt(t, (major ? 47 : 50) * s);
    const [x2, y2] = pt(t, 58 * s);
    ticks.push(
      <line
        key={i}
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={t <= f + 1e-6 ? "var(--ink-1)" : "rgba(255,255,255,0.16)"}
        strokeWidth={major ? 1.4 : 1}
        strokeLinecap="round"
      />,
    );
  }

  const [kx, ky] = pt(f, 38 * s);
  const rec = recommended != null ? pt((recommended - min) / (max - min || 1), 63 * s) : null;

  return (
    <svg
      ref={ref}
      width={size}
      height={size}
      onMouseDown={down}
      style={{ cursor: "grab", touchAction: "none", display: "block" }}
    >
      {ticks}
      {rec && <circle cx={rec[0]} cy={rec[1]} r={2} fill="none" stroke="var(--text-muted)" />}
      <circle cx={C} cy={C} r={30 * s} fill="var(--gray-3)" stroke="rgba(255,255,255,0.08)" />
      <circle cx={kx} cy={ky} r={4.5} fill="#fff" />
      <circle cx={kx} cy={ky} r={9} fill="none" stroke="rgba(255,255,255,0.25)" />
    </svg>
  );
}
