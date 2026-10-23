import * as RadixTabs from "@radix-ui/react-tabs";
import type { ReactNode } from "react";

export interface TabsProps {
  /** Names the tab list for screen readers, e.g. the page it belongs to. */
  label: string;
  items: { value: string; label: ReactNode }[];
  value: string;
  onChange: (v: string) => void;
}

/** A page's sub-tabs: text tabs with a 1px underline on the active one, in a 48px bar. */
export function Tabs({ label, items, value, onChange }: TabsProps) {
  return (
    <RadixTabs.Root value={value} onValueChange={onChange}>
      <RadixTabs.List className="page-tabs" aria-label={label}>
        {items.map((it) => (
          <RadixTabs.Trigger key={it.value} value={it.value} className="page-tab">
            {it.label}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
    </RadixTabs.Root>
  );
}
