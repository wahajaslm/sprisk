import type { ReactNode } from "react";

export type TabItem<T extends string = string> = {
  value: T;
  label: ReactNode;
  badge?: ReactNode;
};

export type TabsProps<T extends string = string> = {
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
};

/** Flow Studio Tabs: text tabs with 1px bottom underline on the active item, inside a 48px bar. */
export function Tabs<T extends string = string>({
  items,
  value,
  onChange,
  className = "",
}: TabsProps<T>) {
  return (
    <div className={`tab-strip ${className}`.trim()} role="tablist">
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            className={`tab-strip-item ${active ? "active" : ""}`}
            onClick={() => onChange(item.value)}
          >
            <span>{item.label}</span>
            {item.badge && <span className="tab-strip-badge">{item.badge}</span>}
          </button>
        );
      })}
    </div>
  );
}
