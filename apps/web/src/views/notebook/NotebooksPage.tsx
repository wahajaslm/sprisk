import { useState } from "react";
import { useNotebooks } from "../../api/notebooks.ts";
import { useSelection } from "../../workbench/selection.ts";
import { SearchField } from "../../components/ui/SearchField.tsx";
import { Tag } from "../../components/ui/Tag.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { InfoDock } from "../../components/ui/InfoDock.tsx";
import { SparkIcon, SendIcon, PanelToggleIcon } from "../Icons.tsx";

type DemoNotebook = {
  id: string;
  name: string;
  stageNum: string;
  cellsCount: number;
  tag?: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  cells: {
    badge: string;
    kind: "markdown" | "code";
    content: string;
    lines?: string[];
    output?: string;
  }[];
};

const DEMO_NOTEBOOKS: DemoNotebook[] = [
  {
    id: "01-explore",
    name: "01 Explore the data",
    stageNum: "01",
    cellsCount: 6,
    eyebrow: "Notebook · Methodology",
    title: "01 Explore the data",
    subtitle: "Profile distributions, target balance, and initial correlation scan.",
    cells: [
      {
        badge: "[1]",
        kind: "markdown",
        content: "Inspect the raw peptide descriptors and verify sensory panel distributions.",
      },
      {
        badge: "[2]",
        kind: "code",
        content: "",
        lines: [
          "import pandas as pd",
          "df = pd.read_csv('umami_flavour_v2.tsv', sep='\\t')",
          "df.head(3)",
        ],
        output: "   sequence  length  mol_weight    pI      label\n0   EDLGHPK       7       794.9  4.53      umami\n1       DES       3       349.3  3.23      umami\n2  KGGWAPLL       8       841.0  9.70  non-umami",
      },
    ],
  },
  {
    id: "02-clean",
    name: "02 Clean",
    stageNum: "02",
    cellsCount: 9,
    tag: "Queued",
    eyebrow: "Notebook · Methodology",
    title: "02 Clean",
    subtitle: "Missing values, outliers and leakage, with the reasoning behind each choice.",
    cells: [
      {
        badge: "[1]",
        kind: "markdown",
        content: "Columns where more than 20% of values are missing are dropped; below that, the median is imputed.",
      },
      {
        badge: "[2]",
        kind: "code",
        content: "",
        lines: [
          "share = df.isna().mean()",
          "share[share >= 0.20]",
        ],
        output: "umami_score   0.312\npanel_notes   0.240\nbitterness    0.204",
      },
      {
        badge: "[3]",
        kind: "code",
        content: "",
        lines: [
          "df = df.drop(columns=share[share >= 0.20].index)",
          "df.shape",
        ],
        output: "(608, 23)",
      },
    ],
  },
  {
    id: "03-feature-selection",
    name: "03 Feature selection",
    stageNum: "03",
    cellsCount: 7,
    eyebrow: "Notebook · Methodology",
    title: "03 Feature selection",
    subtitle: "Permutation importance and recursive elimination to retain top signal.",
    cells: [
      {
        badge: "[1]",
        kind: "markdown",
        content: "Rank features by permutation score drop on the validation fold.",
      },
      {
        badge: "[2]",
        kind: "code",
        content: "",
        lines: [
          "from sklearn.inspection import permutation_importance",
          "imp = permutation_importance(model, X_val, y_val, n_repeats=10)",
          "top_k = [features[i] for i in imp.importances_mean.argsort()[-12:]]",
        ],
        output: "Top 12 features selected: ['length', 'hydrophobicity', 'net_charge', ...]",
      },
    ],
  },
];

export function NotebooksPage() {
  const notebooks = useNotebooks();
  const { setNav } = useSelection();

  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string>("02-clean");
  const [composerText, setComposerText] = useState("");

  const activeNotebook = DEMO_NOTEBOOKS.find((nb) => nb.id === selectedId) ?? DEMO_NOTEBOOKS[1]!;

  const filtered = DEMO_NOTEBOOKS.filter((nb) =>
    nb.name.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <div className="nbx-page">
      {/* 280px Notebooks Sidebar */}
      <aside className="nbx-sidebar" aria-label="Notebooks sidebar">
        <div className="nbx-sidebar-head">
          <h2 className="nbx-sidebar-title">Notebooks</h2>
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Search notebooks"
          />
        </div>

        <div className="nbx-sidebar-list">
          {filtered.map((nb) => {
            const isSelected = nb.id === selectedId;
            return (
              <button
                key={nb.id}
                type="button"
                className={`nbx-item ${isSelected ? "selected" : ""}`}
                onClick={() => setSelectedId(nb.id)}
              >
                <div className="nbx-item-header">
                  <span className="nbx-item-name">{nb.name}</span>
                  {nb.tag && <Tag tone="queued">{nb.tag}</Tag>}
                </div>
                <span className="nbx-item-sub">{nb.cellsCount} cells</span>
              </button>
            );
          })}
        </div>

        <div className="nbx-sidebar-dock">
          <InfoDock
            title="Info"
            rows={[
              { k: "Kernel", v: "Python 3.11" },
              { k: "Last run", v: "14:02" },
            ]}
          />
        </div>
      </aside>

      {/* Main Centred Notebook Area */}
      <main className="nbx-main" aria-label="Notebook content">
        {/* Notebook Header */}
        <header className="nbx-head">
          <div className="nbx-head-meta">
            <span className="nbx-eyebrow">{activeNotebook.eyebrow}</span>
            <h1 className="nbx-title">{activeNotebook.title}</h1>
            <p className="nbx-subtitle">{activeNotebook.subtitle}</p>
          </div>
          <div className="nbx-head-actions">
            <Button variant="secondary" size="sm">
              Share
            </Button>
            <Button variant="primary" size="sm">
              Run all
            </Button>
          </div>
        </header>

        {/* Subtab Strip */}
        <div className="nbx-subtabs" role="tablist">
          <button type="button" role="tab" aria-selected="true" className="nbx-tab-btn active">
            Cells
          </button>
        </div>

        {/* Centred Cells Column */}
        <div className="nbx-scroll-body">
          <div className="nbx-cells-column">
            {activeNotebook.cells.map((cell, idx) => (
              <div key={idx} className="nbx-cell-row">
                <span className="cell-badge mono">{cell.badge}</span>
                <div className="cell-body">
                  {cell.kind === "markdown" ? (
                    <div className="cell-markdown">
                      <p>{cell.content}</p>
                    </div>
                  ) : (
                    <div className="cell-code-container">
                      <div className="code-box">
                        <pre className="code-pre mono">
                          {cell.lines?.map((line, lineIdx) => (
                            <div key={lineIdx} className="code-line">
                              <span className="line-num">{lineIdx + 1}</span>
                              <span className="line-code">{line}</span>
                            </div>
                          ))}
                        </pre>
                      </div>
                      {cell.output && (
                        <div className="cell-output-box">
                          <pre className="output-pre mono">{cell.output}</pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
