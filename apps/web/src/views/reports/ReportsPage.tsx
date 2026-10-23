import { useState } from "react";
import { SearchField } from "../../components/ui/SearchField.tsx";
import { Tag } from "../../components/ui/Tag.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { InfoDock } from "../../components/ui/InfoDock.tsx";
import { SparkIcon, SendIcon, PanelToggleIcon, Chevron } from "../Icons.tsx";

const TABS = ["Questions", "Scientific", "Business", "Sources"] as const;
type Tab = (typeof TABS)[number];

type QuestionItem = {
  id: string;
  num: string;
  group: string;
  title: string;
  sub: string;
  tag?: string;
  isIssue?: boolean;
};

const DEMO_QUESTIONS: { group: string; num: string; items: QuestionItem[] }[] = [
  {
    group: "Business",
    num: "01",
    items: [
      {
        id: "q-biz-1",
        num: "Q1",
        group: "Business",
        title: "How much tasting-panel time...",
        sub: "Partly answered · Medium confidence",
        tag: "Issue",
        isIssue: true,
      },
      {
        id: "q-biz-2",
        num: "Q2",
        group: "Business",
        title: "Which threshold balances...",
        sub: "Needs decision · Medium confidence",
        tag: "Issue",
        isIssue: true,
      },
    ],
  },
  {
    group: "Scientific",
    num: "02",
    items: [
      {
        id: "q-sci-1",
        num: "Q1",
        group: "Scientific",
        title: "Can we predict umami taste from the peptide sequence alone?",
        sub: "Answered · High confidence",
      },
      {
        id: "q-sci-2",
        num: "Q2",
        group: "Scientific",
        title: "Which sequence features drive umami...",
        sub: "Answered · High confidence",
      },
      {
        id: "q-sci-3",
        num: "Q3",
        group: "Scientific",
        title: "Is the model reliable for very...",
        sub: "Answered · High confidence",
        tag: "Issue",
        isIssue: true,
      },
      {
        id: "q-sci-4",
        num: "Q4",
        group: "Scientific",
        title: "Does the model work on...",
        sub: "Open · No confidence",
        tag: "Queued",
      },
    ],
  },
];

export function ReportsPage() {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string>("q-sci-1");
  const [activeTab, setActiveTab] = useState<Tab>("Questions");
  const [composerText, setComposerText] = useState("");

  const allItems = DEMO_QUESTIONS.flatMap((g) => g.items);
  const activeQuestion = allItems.find((q) => q.id === selectedId) ?? allItems[2]!;

  return (
    <div className="rep-page-layout">
      {/* 280px Questions Sidebar */}
      <aside className="rep-sidebar" aria-label="Questions sidebar">
        <div className="rep-sidebar-head">
          <h2 className="rep-sidebar-title">Questions</h2>
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Search questions"
          />
        </div>

        <div className="rep-sidebar-list">
          {DEMO_QUESTIONS.map((group) => {
            const filtered = group.items.filter(
              (q) => !query || q.title.toLowerCase().includes(query.toLowerCase()),
            );
            if (query && filtered.length === 0) return null;

            return (
              <section key={group.group} className="rep-group-section">
                <div className="rep-group-header">
                  <span className="rep-group-num mono">{group.num}</span>
                  <span className="rep-group-name">{group.group}</span>
                  <span className="rep-group-count mono">{group.items.length}</span>
                  <span className="rep-group-chevron open">
                    <Chevron />
                  </span>
                </div>

                <div className="rep-group-items">
                  {filtered.map((item) => {
                    const isSelected = item.id === selectedId;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={`rep-item ${isSelected ? "selected" : ""}`}
                        onClick={() => setSelectedId(item.id)}
                      >
                        <div className="rep-item-title-row">
                          <span className="rep-item-title">{item.title}</span>
                          {item.tag && <Tag tone={item.isIssue ? "danger" : "queued"}>{item.tag}</Tag>}
                        </div>
                        <span className="rep-item-sub">{item.sub}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>

        <div className="rep-sidebar-dock">
          <InfoDock
            title="Info"
            rows={[
              { k: "Answered", v: "3 of 6" },
              { k: "Need a decision", v: "1", warn: true },
              { k: "Open", v: "1" },
            ]}
          />
        </div>
      </aside>

      {/* Main Evidence Ledger Area */}
      <main className="rep-main" aria-label="Evidence report detail">
        {/* Header */}
        <header className="rep-head">
          <div className="rep-head-meta">
            <span className="rep-eyebrow">Question ledger · project umami</span>
            <h1 className="rep-title">What we set out to answer</h1>
            <p className="rep-subtitle">
              Every question the project is answering, with its current answer, the evidence behind it and what it means.
            </p>
          </div>
          <div className="rep-head-actions">
            <Button variant="secondary" size="sm">
              Share
            </Button>
            <Button variant="primary" size="sm">
              Add question
            </Button>
          </div>
        </header>

        {/* Subtabs Strip */}
        <div className="rep-subtabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={activeTab === t}
              className={`rep-tab-btn ${activeTab === t ? "active" : ""}`}
              onClick={() => setActiveTab(t)}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Report Content */}
        <div className="rep-tab-content">
          <div className="rep-question-view">
            <div className="rep-q-meta">
              <span className="mono">Q1 Scientific question</span>
              <span className="meta-sep">·</span>
              <span>Asked by Mina Okafor on 2 Sep</span>
            </div>

            <h2 className="rep-q-title">{activeQuestion.title}</h2>

            <div className="rep-q-status-row">
              <span className="answered-pill">Answered</span>
              <div className="confidence-meter">
                <span className="conf-bar filled" />
                <span className="conf-bar filled" />
                <span className="conf-bar filled" />
              </div>
              <span className="conf-label">High confidence</span>
            </div>

            {/* Current Answer Card */}
            <div className="current-answer-card">
              <span className="card-mini-title">Current answer</span>
              <p className="current-answer-text">
                Yes. On 122 unseen peptides the model separates umami from non-umami with 0.951 ROC AUC and 0.912
                accuracy.
              </p>
            </div>

            {/* Two Columns: Reasoning & What it means */}
            <div className="rep-reasoning-grid">
              <div className="rep-reason-col">
                <h3 className="rep-section-title">Reasoning</h3>
                <p className="rep-body-text">
                  Sequence descriptors were enough to reach high accuracy without assay measurements. The result held
                  across two runs (15 and 16) and the strongest features are chemically plausible, which lowers the risk
                  of a lucky split.
                </p>
              </div>

              <div className="rep-means-col">
                <h3 className="rep-section-title">What it means</h3>
                <p className="rep-body-text">
                  The panel no longer needs to taste every candidate to find umami peptides.
                </p>
                <div className="rep-next-actions">
                  <span className="next-act-head">Next actions</span>
                  <label className="checkbox-action">
                    <input type="checkbox" />
                    <span>Confirm on run 17 when training finishes.</span>
                  </label>
                </div>
              </div>
            </div>

            {/* Evidence Section */}
            <div className="rep-evidence-section">
              <h3 className="rep-section-title">Evidence</h3>
              <div className="evidence-cards-row">
                <div className="evidence-metric-card">
                  <span className="ev-number mono">0.951</span>
                  <span className="ev-metric-name">ROC AUC</span>
                  <span className="ev-run-link mono">Run 16 · test set</span>
                </div>
                <div className="evidence-metric-card">
                  <span className="ev-number mono">0.912</span>
                  <span className="ev-metric-name">Accuracy</span>
                  <span className="ev-run-link mono">Run 16 · test set</span>
                </div>
                <div className="evidence-metric-card">
                  <span className="ev-number mono">0.948</span>
                  <span className="ev-metric-name">Previous run</span>
                  <span className="ev-run-link mono">Run 15</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
