import { useState } from "react";
import { SearchField } from "../../components/ui/SearchField.tsx";
import { Tag } from "../../components/ui/Tag.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { InfoDock } from "../../components/ui/InfoDock.tsx";
import { SparkIcon, SendIcon, PanelToggleIcon, Chevron } from "../Icons.tsx";

const TABS = ["Installed", "Browse"] as const;
type Tab = (typeof TABS)[number];

type SettingSection = {
  group: string;
  num: string;
  items: {
    id: string;
    name: string;
    count: string;
    tag?: string;
    isIssue?: boolean;
  }[];
};

const DEMO_SECTIONS: SettingSection[] = [
  {
    group: "Platform",
    num: "01",
    items: [
      { id: "packs", name: "Packs", count: "3 installed" },
      { id: "plugins", name: "Plugins", count: "4 installed" },
      { id: "environments", name: "Environments", count: "3" },
      { id: "compute", name: "Compute", count: "3 pools" },
      { id: "data", name: "Data", count: "3 connections", tag: "Issue", isIssue: true },
    ],
  },
  {
    group: "Access",
    num: "02",
    items: [{ id: "members", name: "Members", count: "5" }],
  },
];

export function SettingsPage() {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string>("packs");
  const [activeTab, setActiveTab] = useState<Tab>("Installed");
  const [composerText, setComposerText] = useState("");

  return (
    <div className="set-page-layout">
      {/* 280px Settings Sidebar */}
      <aside className="set-sidebar" aria-label="Settings navigation">
        <div className="set-sidebar-head">
          <h2 className="set-sidebar-title">Settings</h2>
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Search settings"
          />
        </div>

        <div className="set-sidebar-list">
          {DEMO_SECTIONS.map((sec) => {
            const filtered = sec.items.filter(
              (item) => !query || item.name.toLowerCase().includes(query.toLowerCase()),
            );
            if (query && filtered.length === 0) return null;

            return (
              <section key={sec.group} className="set-group-section">
                <div className="set-group-header">
                  <span className="set-group-num mono">{sec.num}</span>
                  <span className="set-group-name">{sec.group}</span>
                  <span className="set-group-count mono">{sec.items.length}</span>
                  <span className="set-group-chevron open">
                    <Chevron />
                  </span>
                </div>

                <div className="set-group-items">
                  {filtered.map((item) => {
                    const isSelected = item.id === selectedId;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={`set-item ${isSelected ? "selected" : ""}`}
                        onClick={() => setSelectedId(item.id)}
                      >
                        <div className="set-item-title-row">
                          <span className="set-item-title">{item.name}</span>
                          {item.tag && (
                            <Tag tone={item.isIssue ? "danger" : "default"}>
                              {item.tag}
                            </Tag>
                          )}
                        </div>
                        <span className="set-item-sub">{item.count}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>

        <div className="set-sidebar-dock">
          <InfoDock
            title="Info"
            rows={[
              { k: "Installed", v: "3" },
              { k: "Updates", v: "1" },
            ]}
          />
        </div>
      </aside>

      {/* Main Settings Body */}
      <main className="set-main" aria-label="Settings configuration">
        {/* Header */}
        <header className="set-head">
          <div className="set-head-meta">
            <span className="set-eyebrow">Platform · domain packs</span>
            <h1 className="set-title">Packs</h1>
            <p className="set-subtitle">
              A pack adds steps, a data viewer, rules and deploy targets for one kind of data.
            </p>
          </div>
          <div className="set-head-actions">
            <Button variant="secondary" size="sm">
              Share
            </Button>
            <Button variant="primary" size="sm">
              Browse packs
            </Button>
          </div>
        </header>

        {/* Subtabs */}
        <div className="set-subtabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={activeTab === t}
              className={`set-tab-btn ${activeTab === t ? "active" : ""}`}
              onClick={() => setActiveTab(t)}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Main Content */}
        <div className="set-content">
          {/* Installed Packs List */}
          <section className="set-section">
            <div className="set-section-header">
              <h2 className="set-section-title">Installed</h2>
              <span className="set-section-sub">Used by flows in this project</span>
            </div>

            <div className="set-packs-list">
              {/* Tabular Core */}
              <div className="set-pack-row">
                <div className="set-pack-info">
                  <div className="set-pack-title-line">
                    <strong className="set-pack-name">Tabular core</strong>
                    <Tag tone="default">Core</Tag>
                  </div>
                  <span className="set-pack-desc">Built in · tables, joins, AutoML</span>
                </div>
                <div className="set-pack-action">
                  <Button variant="secondary" size="sm" disabled>
                    Included
                  </Button>
                </div>
              </div>

              {/* Audio */}
              <div className="set-pack-row">
                <div className="set-pack-info">
                  <div className="set-pack-title-line">
                    <strong className="set-pack-name">Audio</strong>
                  </div>
                  <span className="set-pack-desc mono">v1.2 · 6 steps · 3 rules · 2 targets</span>
                </div>
                <div className="set-pack-action">
                  <Button variant="secondary" size="sm">
                    Manage
                  </Button>
                </div>
              </div>

              {/* Edge and embedded */}
              <div className="set-pack-row">
                <div className="set-pack-info">
                  <div className="set-pack-title-line">
                    <strong className="set-pack-name">Edge and embedded</strong>
                    <Tag tone="danger">Update</Tag>
                  </div>
                  <span className="set-pack-desc mono">v0.9 · 4 steps · 2 rules · device targets</span>
                </div>
                <div className="set-pack-action">
                  <Button variant="secondary" size="sm">
                    Update to 1.0
                  </Button>
                </div>
              </div>
            </div>
          </section>

          {/* Audio Pack Detail Section */}
          <section className="set-detail-section">
            <div className="set-section-header">
              <h2 className="set-section-title">Audio pack adds</h2>
              <span className="set-section-sub">Everything below appears in your existing screens</span>
            </div>

            <div className="set-features-grid">
              <div className="set-feature-card">
                <span className="set-feat-name">Steps on the canvas</span>
                <span className="set-feat-desc">
                  Resample · trim silence · split clips · spectrogram · MFCC · denoise
                </span>
              </div>

              <div className="set-feature-card">
                <span className="set-feat-name">Data viewer</span>
                <span className="set-feat-desc">
                  Waveform and spectrogram per row, with playback
                </span>
              </div>

              <div className="set-feature-card">
                <span className="set-feat-name">Methodology rules</span>
                <span className="set-feat-desc">
                  Speaker leakage · sample-rate consistency · clip length
                </span>
              </div>

              <div className="set-feature-card">
                <span className="set-feat-name">Deploy targets</span>
                <span className="set-feat-desc">
                  Mobile · browser · streaming endpoint
                </span>
              </div>
            </div>
          </section>
        </div>
      </main>

      {/* Right 340px Copilot Column */}
      <aside className="set-copilot" aria-label="Copilot assistant">
        <div className="copilot-head">
          <SparkIcon />
          <strong>Copilot</strong>
          <span className="spacer" />
          <span className="chip">Packs</span>
          <button type="button" className="icon-btn icon-btn-sm" title="Toggle copilot rail">
            <PanelToggleIcon />
          </button>
        </div>

        <div className="set-copilot-body">
          <div className="set-copilot-bubble">
            <p>
              Edge and embedded 1.0 adds an int8 accuracy check. Two flows use 0.9.
            </p>
          </div>

          <div className="set-copilot-suggestions">
            <Tag tone="default">What uses this?</Tag>
          </div>
        </div>

        <div className="copilot-foot">
          <div className="composer">
            <input
              placeholder="Ask about this step"
              value={composerText}
              onChange={(e) => setComposerText(e.target.value)}
            />
            <button
              type="button"
              className="send"
              aria-label="Send"
              disabled={!composerText.trim()}
            >
              <SendIcon />
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
