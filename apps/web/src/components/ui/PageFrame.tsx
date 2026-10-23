import type { ReactNode } from "react";

import { PageHeader, type PageHeaderProps } from "./PageHeader.tsx";
import { SingleTab, Tabs, type TabsProps } from "./Tabs.tsx";

export interface PageFrameProps {
  /** The page's Sidebar; absent on a page with nothing to list. */
  sidebar?: ReactNode;
  header: PageHeaderProps;
  tabs?: Omit<TabsProps, "children">;
  /** The one view's name when there are no tabs; every page shows a tab strip (design). */
  view?: string;
  /** Names the pane for screen readers; the header title when absent. */
  label?: string;
  /** The body has no padding: a canvas that fills the pane. */
  flush?: boolean;
  children: ReactNode;
}

/** The layout every page shares (Flow Studio main screen): a sidebar pane, then a pane with the
 * header, the sub-tabs and the body. */
export function PageFrame({ sidebar, header, tabs, view = "Overview", label, flush = false, children }: PageFrameProps) {
  return (
    <div className="page-frame">
      {sidebar}
      <section className={`center-screen page-pane${flush ? " flush" : ""}`} aria-label={label ?? header.title}>
        <PageHeader {...header} />
        {tabs ? (
          <Tabs {...tabs}>{children}</Tabs>
        ) : (
          <>
            <SingleTab name={view} />
            <div className="page-body">{children}</div>
          </>
        )}
      </section>
    </div>
  );
}
