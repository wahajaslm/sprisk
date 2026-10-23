import type { ChangeEvent } from "react";

export type SliderProps = {
  value: number;
  min: number;
  max: number;
  step?: number;
  recommended?: number;
  onChange: (val: number) => void;
  label?: string;
  unit?: string;
  format?: (val: number) => string;
  className?: string;
};

/** Flow Studio Slider: parameter slider with a 'recommended' pip marker. */
export function Slider({
  value,
  min,
  max,
  step = 0.01,
  recommended,
  onChange,
  label,
  unit = "",
  format,
  className = "",
}: SliderProps) {
  const percent = Math.max(0, Math.min(100, ((value - min) / (max - min || 1)) * 100));
  const recPercent =
    recommended !== undefined
      ? Math.max(0, Math.min(100, ((recommended - min) / (max - min || 1)) * 100))
      : undefined;

  const displayVal = format ? format(value) : `${value}${unit}`;

  return (
    <div className={`slider-control ${className}`.trim()}>
      {(label || displayVal) && (
        <div className="slider-head">
          {label && <span className="slider-label">{label}</span>}
          <span className="slider-val mono">{displayVal}</span>
        </div>
      )}
      <div className="slider-track-wrap">
        <div className="slider-track-bar">
          <div className="slider-fill" style={{ width: `${percent}%` }} />
          {recPercent !== undefined && (
            <div
              className="slider-rec-mark"
              style={{ left: `${recPercent}%` }}
              title={`Recommended: ${recommended}${unit}`}
            />
          )}
        </div>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(parseFloat(e.target.value))}
          className="slider-input"
          aria-label={label ?? "Value"}
        />
      </div>
    </div>
  );
}
