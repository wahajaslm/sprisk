import type { ReactNode } from "react";

export type SegmentedOption<T extends string = string> = {
  value: T;
  label: ReactNode;
};

export type SegmentedProps<T extends string = string> = {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
};

/** Flow Studio Segmented: 2–3 option view switcher on a 4% fill track. */
export function Segmented<T extends string = string>({
  options,
  value,
  onChange,
  className = "",
}: SegmentedProps<T>) {
  return (
    <div className={`segmented ${className}`.trim()} role="tablist">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            className={`segmented-item ${active ? "active" : ""}`}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
