import { useState } from "react";

import { Sidebar } from "../../components/ui/Sidebar.tsx";
import { ListRow } from "../../components/ui/ListRow.tsx";
import { SearchField } from "../../components/ui/SearchField.tsx";
import { PageHeader } from "../../components/ui/PageHeader.tsx";
import { Tabs } from "../../components/ui/Tabs.tsx";
import { Button } from "../../components/ui/Button.tsx";

const TABS = ["Card", "Explain", "Monitoring", "Endpoints"] as const;
type Tab = (typeof TABS)[number];

export function DeployPage() {
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("Card");

  // Per ADR-0061 & Gap Catalog: No backend model serving registry exists yet.
  // We render the Flow Studio layout with the true empty state rather than hardcoding fake models.
  const models: { id: string; name: string; sub: string }[] = [];

  return (
    <div style={{ display: "flex", width: "100%", height: "100%", minHeight: 0, overflow: "hidden" }}>
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
        <p className="muted pad" style={{ padding: "16px 12px", fontSize: "var(--fs-13)" }}>
          No models deployed yet.
        </p>
      </Sidebar>

      {/* Main Content Area */}
      <div style={{ flex: 1, minWidth: 0, height: "100%", display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--bg-canvas)" }}>
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
          items={TABS.map((t) => ({ value: t, label: t }))}
          value={activeTab}
          onChange={(t) => setActiveTab(t as Tab)}
        />

        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 10, padding: 32, textAlign: "center" }}>
          <p style={{ fontSize: "var(--fs-15)", fontWeight: "var(--fw-medium)", color: "var(--text-primary)", margin: 0 }}>
            No models in production or staging
          </p>
          <span style={{ fontSize: "var(--fs-13-5)", color: "var(--text-secondary)", maxWidth: 440, lineHeight: 1.5 }}>
            Promote an evaluated model from Experiments to configure live inference endpoints, feature drift tracking (PSI), and latency monitoring.
          </span>
        </div>
      </div>
    </div>
  );
}
