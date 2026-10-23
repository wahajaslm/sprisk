import type { ReactNode } from "react";

import { PageHeader, type PageHeaderProps } from "./PageHeader.tsx";
import { Tabs, type TabsProps } from "./Tabs.tsx";

export interface PageFrameProps {
  /** The page's Sidebar; absent on a page with nothing to list. */
  sidebar?: ReactNode;
  header: PageHeaderProps;
  tabs?: Omit<TabsProps, "children">;
  children: ReactNode;
}

/** The layout every page shares (Flow Studio main screen): a sidebar pane, then a pane with the
 * header, the sub-tabs and the body. */
export function PageFrame({ sidebar, header, tabs, children }: PageFrameProps) {
  return (
    <div className="page-frame">
      {sidebar}
      <section className="center-screen page-pane" aria-label={header.title}>
        <PageHeader {...header} />
        {tabs ? <Tabs {...tabs}>{children}</Tabs> : <div className="page-body">{children}</div>}
      </section>
    </div>
  );
}
