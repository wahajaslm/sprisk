import * as RadixTabs from "@radix-ui/react-tabs";
import type { ReactNode } from "react";

export interface TabsProps {
  /** Names the tab list for screen readers, e.g. the page it belongs to. */
  label: string;
  items: { value: string; label: ReactNode }[];
  value: string;
  onChange: (v: string) => void;
  /** What the selected tab shows: its tab panel. */
  children: ReactNode;
}

/** A page's sub-tabs: text tabs with a 1px underline on the active one, in a 48px bar, over the
 * selected tab's panel. */
export function Tabs({ label, items, value, onChange, children }: TabsProps) {
  return (
    <RadixTabs.Root value={value} onValueChange={onChange} className="page-tabs-root">
      <RadixTabs.List className="page-tabs" aria-label={label}>
        {items.map((it) => (
          <RadixTabs.Trigger key={it.value} value={it.value} className="page-tab">
            {it.label}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
      <RadixTabs.Content value={value} className="page-body">
        {children}
      </RadixTabs.Content>
    </RadixTabs.Root>
  );
}

/** The tab strip of a page with one view: the design shows its name there too. It is a label,
 * not a tab, since there is nothing to switch to. */
export function SingleTab({ name }: { name: string }) {
  return (
    <div className="page-tabs">
      <span className="page-tab" data-state="active">
        {name}
      </span>
    </div>
  );
}
