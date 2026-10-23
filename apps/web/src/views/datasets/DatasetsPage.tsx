import { useState } from "react";
import type { LoadedTable } from "@sprisk/contracts";

import { useLoadedTables, useDatasetProfile } from "../../api/datasets.ts";
import { usePipelineVersions } from "../../api/hooks.ts";
import { useSelection } from "../../workbench/selection.ts";
import { SearchField } from "../../components/ui/SearchField.tsx";
import { Tag } from "../../components/ui/Tag.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { InfoDock } from "../../components/ui/InfoDock.tsx";
import { SparkIcon, SendIcon, PanelToggleIcon } from "../Icons.tsx";

const TABS = ["Preview", "Profile", "Lineage", "Versions", "Label"] as const;
type Tab = (typeof TABS)[number];

type DemoDataset = {
  id: string;
  name: string;
  meta: string;
  rows: number;
  cols: number;
  quality: string;
  usedBy: string;
  tag?: string;
  type: string;
  desc: string;
};

const DEMO_DATASETS: DemoDataset[] = [
  {
    id: "umami_flavour_v2.tsv",
    name: "umami_flavour_v2.tsv",
    meta: "608 × 26 · v1",
    rows: 608,
    cols: 26,
    quality: "94%",
    usedBy: "2 flows",
    type: "Upload · tab-separated",
    desc: "Peptide sequences labelled umami or non-umami, with physico-chemical descriptors.",
  },
  {
    id: "peptide_descriptors.csv",
    name: "peptide_descriptors.csv",
    meta: "1,204 × 48 · v3",
    rows: 1204,
    cols: 48,
    quality: "98%",
    usedBy: "1 flow",
    type: "Upload · comma-separated",
    desc: "Calculated structural features and amino acid frequencies.",
  },
  {
    id: "panel_scores.parquet",
    name: "panel_scores.parquet",
    meta: "92 × 12 · v1",
    rows: 92,
    cols: 12,
    quality: "100%",
    usedBy: "0 flows",
    tag: "Queued",
    type: "Arrow Parquet · binary",
    desc: "Human sensory panel scores across 8 tasting sessions.",
  },
  {
    id: "field_takes.zip",
    name: "field_takes.zip",
    meta: "38 files · audio",
    rows: 38,
    cols: 4,
    quality: "91%",
    usedBy: "1 flow",
    type: "Archive · audio",
    desc: "Field microphone recordings for acoustic aroma response.",
  },
];

type PreviewRow = {
  id: number;
  sequence: string;
  length: number;
  mol_weight: string;
  isAberrant?: boolean;
  pI: string;
  label: string;
};

const PREVIEW_ROWS: PreviewRow[] = [
  { id: 1, sequence: "EDLGHPK", length: 7, mol_weight: "794.9", pI: "4.53", label: "umami" },
  { id: 2, sequence: "DES", length: 3, mol_weight: "349.3", pI: "3.23", label: "umami" },
  { id: 3, sequence: "KGGWAPLL", length: 8, mol_weight: "841.0", pI: "9.70", label: "non-umami" },
  { id: 4, sequence: "EEDG", length: 4, mol_weight: "—", pI: "3.10", label: "umami" },
  { id: 5, sequence: "AFPGPVQ", length: 7, mol_weight: "2,140.6", isAberrant: true, pI: "5.95", label: "non-umami" },
];

export function DatasetsPage() {
  const loadedTables = useLoadedTables();
  const versions = usePipelineVersions();
  const { setNav, selectPipelineVersion } = useSelection();

  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string>("umami_flavour_v2.tsv");
  const [activeTab, setActiveTab] = useState<Tab>("Preview");
  const [composerText, setComposerText] = useState("");

  const activeDataset = DEMO_DATASETS.find((d) => d.id === selectedId) ?? DEMO_DATASETS[0]!;

  const filteredDatasets = DEMO_DATASETS.filter((d) =>
    d.name.toLowerCase().includes(query.trim().toLowerCase()),
  );

  const handleOpenInFlow = () => {
    const firstFlow = versions.data?.[0];
    if (firstFlow) selectPipelineVersion(firstFlow.id);
    setNav("Flow");
  };

  return (
    <div className="dsx-page">
      {/* 280px Datasets Sidebar */}
      <aside className="dsx-sidebar" aria-label="Datasets sidebar">
        <div className="dsx-sidebar-head">
          <h2 className="dsx-sidebar-title">Datasets</h2>
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Search datasets"
          />
        </div>

        <div className="dsx-sidebar-list">
          {filteredDatasets.map((ds) => {
            const isSelected = ds.id === selectedId;
            return (
              <button
                key={ds.id}
                type="button"
                className={`dsx-dataset-item ${isSelected ? "selected" : ""}`}
                onClick={() => setSelectedId(ds.id)}
              >
                <div className="dsx-item-header">
                  <span className="dsx-item-name">{ds.name}</span>
                  {ds.tag && <Tag tone="queued">{ds.tag}</Tag>}
                </div>
                <span className="dsx-item-sub">{ds.meta}</span>
              </button>
            );
          })}
        </div>

        <div className="dsx-sidebar-dock">
          <InfoDock
            title="Info"
            rows={[
              { k: "Rows", v: activeDataset.rows.toLocaleString() },
              { k: "Quality", v: activeDataset.quality },
              { k: "Used by", v: activeDataset.usedBy },
            ]}
          />
        </div>
      </aside>

      {/* Main Dataset Area */}
      <main className="dsx-main" aria-label="Dataset detail">
        {/* Dataset Header */}
        <header className="dsx-detail-head">
          <div className="dsx-head-meta">
            <span className="dsx-eyebrow">{activeDataset.type}</span>
            <h1 className="dsx-title">{activeDataset.name.replace(/\.[^/.]+$/, "")}</h1>
            <p className="dsx-subtitle">{activeDataset.desc}</p>
          </div>
          <div className="dsx-head-actions">
            <Button variant="secondary" size="sm">
              Share
            </Button>
            <Button variant="primary" size="sm" onClick={handleOpenInFlow}>
              Open in flow
            </Button>
          </div>
        </header>

        {/* Tab Strip: Preview · Profile · Lineage · Versions · Label */}
        <div className="dsx-subtabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={activeTab === t}
              className={`dsx-tab-btn ${activeTab === t ? "active" : ""}`}
              onClick={() => setActiveTab(t)}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Tab Body */}
        <div className="dsx-tab-content">
          {activeTab === "Preview" ? (
            <div className="dsx-table-wrap">
              <table className="dsx-table">
                <thead>
                  <tr>
                    <th style={{ width: 48 }}>#</th>
                    <th>sequence</th>
                    <th style={{ textAlign: "right", width: 100 }}>length</th>
                    <th style={{ textAlign: "right", width: 140 }}>mol_weight</th>
                    <th style={{ textAlign: "right", width: 100 }}>pI</th>
                    <th style={{ width: 140 }}>label</th>
                  </tr>
                </thead>
                <tbody>
                  {PREVIEW_ROWS.map((row) => (
                    <tr key={row.id}>
                      <td className="row-num mono">{row.id}</td>
                      <td className="mono">{row.sequence}</td>
                      <td className="mono num-cell">{row.length}</td>
                      <td className={`mono num-cell ${row.isAberrant ? "val-aberrant" : ""}`}>
                        {row.mol_weight}
                      </td>
                      <td className="mono num-cell">{row.pI}</td>
                      <td>{row.label}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : activeTab === "Profile" ? (
            <div className="dsx-profile-body">
              <div className="dsx-profile-grid">
                <div className="profile-metric-card">
                  <span className="profile-metric-label">Columns</span>
                  <span className="profile-metric-val mono">{activeDataset.cols}</span>
                </div>
                <div className="profile-metric-card">
                  <span className="profile-metric-label">Total rows</span>
                  <span className="profile-metric-val mono">{activeDataset.rows.toLocaleString()}</span>
                </div>
                <div className="profile-metric-card">
                  <span className="profile-metric-label">Quality</span>
                  <span className="profile-metric-val mono">{activeDataset.quality}</span>
                </div>
                <div className="profile-metric-card">
                  <span className="profile-metric-label">Missing cells</span>
                  <span className="profile-metric-val mono">1 (0.01%)</span>
                </div>
              </div>
            </div>
          ) : activeTab === "Lineage" ? (
            <div className="dsx-lineage-body">
              <div className="lineage-flow-trace">
                <span className="trace-item">Upload ({activeDataset.name})</span>
                <span className="trace-arrow">→</span>
                <span className="trace-item">Dataset v1</span>
                <span className="trace-arrow">→</span>
                <span className="trace-item">Explore · Profile</span>
                <span className="trace-arrow">→</span>
                <span className="trace-item">Clean · Clip outliers</span>
              </div>
            </div>
          ) : activeTab === "Versions" ? (
            <div className="dsx-versions-body">
              <div className="dsx-version-item">
                <span className="version-badge mono">v3</span>
                <span className="version-desc">Added 14 synthetic peptide descriptors</span>
                <span className="version-meta">2 days ago · Mina Okafor</span>
              </div>
              <div className="dsx-version-item">
                <span className="version-badge mono">v2</span>
                <span className="version-desc">Re-profiled with clipped outliers</span>
                <span className="version-meta">5 days ago · System</span>
              </div>
              <div className="dsx-version-item">
                <span className="version-badge mono">v1</span>
                <span className="version-desc">Initial upload: 608 rows, 26 columns</span>
                <span className="version-meta">12 days ago · Mina Okafor</span>
              </div>
            </div>
          ) : (
            <div className="dsx-label-body">
              <div className="label-balance-card">
                <h3 className="label-balance-title">Target distribution · label</h3>
                <div className="label-dist-bar">
                  <div className="dist-segment umami" style={{ width: "58%" }}>
                    umami · 58% (352 rows)
                  </div>
                  <div className="dist-segment non-umami" style={{ width: "42%" }}>
                    non-umami · 42% (256 rows)
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Right 340px Copilot Column */}
      <aside className="dsx-copilot" aria-label="Copilot assistant">
        <div className="copilot-head">
          <SparkIcon />
          <strong>Copilot</strong>
          <span className="spacer" />
          <span className="chip">{activeDataset.name.replace(/\.[^/.]+$/, "")}</span>
          <button type="button" className="icon-btn icon-btn-sm" title="Toggle copilot rail">
            <PanelToggleIcon />
          </button>
        </div>

        <div className="dsx-copilot-body">
          <div className="dsx-copilot-bubble">
            <p>
              Column <code>mol_weight</code> has one aberrant value above 1,750. The Clean stage clips it.
            </p>
          </div>

          <div className="dsx-copilot-suggestions">
            <Tag tone="default" onClick={() => setActiveTab("Profile")}>
              Profile all columns
            </Tag>
          </div>
        </div>

        <div className="copilot-foot">
          <div className="composer">
            <input
              placeholder="Ask about this step"
              value={composerText}
              onChange={(e) => setComposerText(e.target.value)}
            />
            <button type="button" className="send" aria-label="Send" disabled={!composerText.trim()}>
              <SendIcon />
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
