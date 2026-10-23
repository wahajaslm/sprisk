import React from "react";

export interface SegmentedProps<T extends string = string> {
  options: { value: T; label: React.ReactNode }[];
  value: T;
  onChange?: (v: T) => void;
}

export function Segmented<T extends string = string>({ options, value, onChange }: SegmentedProps<T>) {
  return (
    <div className="segmented" role="tablist">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange && onChange(o.value)}
            className={`segmented-item ${on ? "active" : ""}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
