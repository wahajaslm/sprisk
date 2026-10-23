import { useState } from "react";

import { Sidebar } from "../../components/ui/Sidebar.tsx";
import { PageFrame } from "../../components/ui/PageFrame.tsx";
import { Button } from "../../components/ui/Button.tsx";
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
  const openExperiments = useSelection((s) => s.openExperiments);

  return (
    <PageFrame
      sidebar={
        <Sidebar title="Models">
          <p className="muted pad">No models deployed yet.</p>
        </Sidebar>
      }
      header={{
        eyebrow: "Deploy",
        title: "Models in production and staging",
        description: "Promote a compared model from Experiments to serve it here.",
        actions: <Button variant="primary" onClick={() => openExperiments("Compare")}>Go to Experiments</Button>,
      }}
      tabs={{ label: "Model", items: TABS.map((t) => ({ value: t, label: t })), value: activeTab, onChange: (t) => setActiveTab(t as Tab) }}
    >
      <div className="empty-state">
        <DeployIcon size={28} />
        <h2 className="empty-state-title">No model promoted yet</h2>
        <p className="empty-state-text">{EMPTY[activeTab]}</p>
      </div>
    </PageFrame>
  );
}
