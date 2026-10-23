import { useState } from "react";

import { Sidebar } from "../../components/ui/Sidebar.tsx";
import { PageHeader } from "../../components/ui/PageHeader.tsx";
import { Tabs } from "../../components/ui/Tabs.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { useWorkbench } from "../../workbench/workbench.ts";
import { useSelection } from "../../workbench/selection.ts";
import { DeployIcon } from "../Icons.tsx";

const TABS = ["Card", "Explain", "Monitoring", "Endpoints"] as const;
type Tab = (typeof TABS)[number];

/** What each tab will hold once a model is served; until then each says so. */
const EMPTY: Record<Tab, string> = {
  Card: "A promoted model's card: what it predicts, its decisions, approval, performance and known limits.",
  Explain: "Which features drive a promoted model's predictions, and the slices where it does worst.",
  Monitoring: "Drift and latency alerts for a model in production.",
  Endpoints: "The endpoints a promoted model answers on.",
};

/** Models in production and staging. No serving registry exists yet (ADR-0061), so every tab
 * shows its empty state rather than made-up models. */
export function DeployPage() {
  const [activeTab, setActiveTab] = useState<Tab>("Card");
  const sidebarOpen = useWorkbench((s) => s.sidebarOpen);
  const openExperiments = useSelection((s) => s.openExperiments);

  return (
    <div className={`deploy-page-layout ${sidebarOpen ? "with-sidebar" : "folded-sidebar"}`}>
      <Sidebar title="Models" meta="0">
        <p className="muted pad">No models deployed yet.</p>
      </Sidebar>

      <main className="center-screen deploy-main">
        <PageHeader
          eyebrow="Deploy"
          title="Models in production and staging"
          description="Promote a compared model from Experiments to serve it here."
          actions={<Button variant="primary" onClick={() => openExperiments("Compare")}>Go to Experiments</Button>}
        />
        <Tabs label="Model" items={TABS.map((t) => ({ value: t, label: t }))} value={activeTab} onChange={(t) => setActiveTab(t as Tab)}>
          <div className="deploy-empty-viewport">
            <div className="deploy-empty-card">
              <div className="deploy-empty-icon">
                <DeployIcon size={28} />
              </div>
              <h2 className="deploy-empty-title">No model promoted yet</h2>
              <p className="deploy-empty-sub">{EMPTY[activeTab]}</p>
            </div>
          </div>
        </Tabs>
      </main>
    </div>
  );
}
