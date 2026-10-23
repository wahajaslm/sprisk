import { useState } from "react";

import { Sidebar } from "../../components/ui/Sidebar.tsx";
import { ListRow } from "../../components/ui/ListRow.tsx";
import { SearchField } from "../../components/ui/SearchField.tsx";
import { PageHeader } from "../../components/ui/PageHeader.tsx";
import { Tabs } from "../../components/ui/Tabs.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { useWorkbench } from "../../workbench/workbench.ts";
import { useSelection } from "../../workbench/selection.ts";
import { DeployIcon } from "../Icons.tsx";

const TABS = ["Card", "Explain", "Monitoring", "Endpoints"] as const;
type Tab = (typeof TABS)[number];

export function DeployPage() {
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("Card");
  const sidebarOpen = useWorkbench((s) => s.sidebarOpen);
  const setNav = useSelection((s) => s.setNav);

  // Per ADR-0061 & Gap Catalog: No backend model serving registry exists yet.
  // We render the Flow Studio layout with the true empty state rather than hardcoding fake models.
  const models: { id: string; name: string; sub: string }[] = [];

  return (
    <div className={`deploy-page-layout ${sidebarOpen ? "with-sidebar" : "folded-sidebar"}`}>
      {/* 280px Design System Sidebar */}
      <Sidebar
        title="Models"
        meta={String(models.length)}
        search={
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Search models"
          />
        }
      >
        <p className="muted pad" style={{ padding: "16px 14px", fontSize: "var(--fs-13)", color: "var(--text-secondary)" }}>
          No models deployed yet.
        </p>
      </Sidebar>

      {/* Main Content Area */}
      <main className="center-screen deploy-main">
        <PageHeader
          title="Model Deployment & Serving"
          description="Production & Staging endpoints"
          actions={
            <Button variant="secondary" disabled>
              Deploy model
            </Button>
          }
        />
        <Tabs
          label="Model"
          items={TABS.map((t) => ({ value: t, label: t }))}
          value={activeTab}
          onChange={(t) => setActiveTab(t as Tab)}
        />

        <div className="deploy-empty-viewport">
          <div className="deploy-empty-card">
            <div className="deploy-empty-icon">
              <DeployIcon size={28} />
            </div>
            <h3 className="deploy-empty-title">No Models in Production or Staging</h3>
            <p className="deploy-empty-sub">
              Promote an evaluated model from Experiments to configure live inference endpoints, feature drift tracking (PSI), and latency monitoring.
            </p>
            <Button variant="primary" onClick={() => setNav("Experiments")}>
              Go to Experiments
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
