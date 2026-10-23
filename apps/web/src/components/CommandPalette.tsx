import { useEffect, useState, useMemo, useRef } from "react";
import { useSelection } from "../workbench/selection.ts";
import { SearchIcon } from "../views/Icons.tsx";

export type PaletteItem = {
  id: string;
  category: "Steps" | "Operators" | "Datasets" | "Actions" | "Navigation";
  title: string;
  meta?: string;
  badge?: string;
  onSelect: () => void;
};

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const setNav = useSelection((s) => s.setNav);

  const ALL_ITEMS: PaletteItem[] = useMemo(
    () => [
      // Steps
      {
        id: "step-missing",
        category: "Steps",
        title: "Missing values ≥ 20%",
        meta: "Clean · decision",
        onSelect: () => {
          setNav("Flow");
          onClose();
        },
      },
      {
        id: "step-outliers",
        category: "Steps",
        title: "Outlier filter · 3 IQR",
        meta: "Clean · transform",
        onSelect: () => {
          setNav("Flow");
          onClose();
        },
      },
      {
        id: "step-rf",
        category: "Steps",
        title: "Train Random Forest",
        meta: "Model · train",
        onSelect: () => {
          setNav("Flow");
          onClose();
        },
      },
      {
        id: "step-roc",
        category: "Steps",
        title: "ROC evaluation",
        meta: "Evaluate",
        onSelect: () => {
          setNav("Deploy");
          onClose();
        },
      },

      // Operators
      {
        id: "op-missing",
        category: "Operators",
        title: "Missing values",
        meta: "Add to canvas",
        onSelect: () => {
          setNav("Flow");
          onClose();
        },
      },
      {
        id: "op-outlier",
        category: "Operators",
        title: "Outlier detection",
        meta: "Add to canvas",
        onSelect: () => {
          setNav("Flow");
          onClose();
        },
      },
      {
        id: "op-rf",
        category: "Operators",
        title: "Random forest classifier",
        meta: "Add to canvas",
        onSelect: () => {
          setNav("Flow");
          onClose();
        },
      },

      // Datasets
      {
        id: "ds-missing",
        category: "Datasets",
        title: "missing_report.csv",
        meta: "42 × 3",
        onSelect: () => {
          setNav("Datasets");
          onClose();
        },
      },
      {
        id: "ds-umami",
        category: "Datasets",
        title: "umami_flavour_v2.parquet",
        meta: "608 × 28",
        onSelect: () => {
          setNav("Datasets");
          onClose();
        },
      },
      {
        id: "ds-test",
        category: "Datasets",
        title: "unseen_test_122.csv",
        meta: "122 × 26",
        onSelect: () => {
          setNav("Datasets");
          onClose();
        },
      },

      // Actions
      {
        id: "act-run-step",
        category: "Actions",
        title: "Run from Missing values ≥ 20%",
        badge: "⌘R",
        onSelect: () => {
          setNav("Flow");
          onClose();
        },
      },
      {
        id: "act-explain-copilot",
        category: "Actions",
        title: "Explain missing values with Copilot",
        badge: "⌘J",
        onSelect: () => {
          onClose();
        },
      },
      {
        id: "act-gen-pipeline",
        category: "Actions",
        title: "Generate pipeline from Objective",
        badge: "↵",
        onSelect: () => {
          setNav("Flow");
          onClose();
        },
      },

      // Navigation
      {
        id: "nav-obj",
        category: "Navigation",
        title: "Go to Objective",
        meta: "Studio start",
        onSelect: () => {
          setNav("Objective");
          onClose();
        },
      },
      {
        id: "nav-flow",
        category: "Navigation",
        title: "Go to Flow canvas",
        meta: "Pipeline",
        onSelect: () => {
          setNav("Flow");
          onClose();
        },
      },
      {
        id: "nav-datasets",
        category: "Navigation",
        title: "Go to Datasets",
        meta: "Data tables",
        onSelect: () => {
          setNav("Datasets");
          onClose();
        },
      },
      {
        id: "nav-notebooks",
        category: "Navigation",
        title: "Go to Notebooks",
        meta: "Python scratch",
        onSelect: () => {
          setNav("Notebooks");
          onClose();
        },
      },
      {
        id: "nav-method",
        category: "Navigation",
        title: "Go to Methodology",
        meta: "Rules & gates",
        onSelect: () => {
          setNav("Methodology");
          onClose();
        },
      },
      {
        id: "nav-exp",
        category: "Navigation",
        title: "Go to Experiments",
        meta: "Runs & comparison",
        onSelect: () => {
          setNav("Experiments");
          onClose();
        },
      },
      {
        id: "nav-deploy",
        category: "Navigation",
        title: "Go to Deploy",
        meta: "Model cards & drift",
        onSelect: () => {
          setNav("Deploy");
          onClose();
        },
      },
      {
        id: "nav-reports",
        category: "Navigation",
        title: "Go to Reports",
        meta: "Evidence ledger",
        onSelect: () => {
          setNav("Reports");
          onClose();
        },
      },
      {
        id: "nav-settings",
        category: "Navigation",
        title: "Go to Settings",
        meta: "Packs & compute",
        onSelect: () => {
          setNav("Settings");
          onClose();
        },
      },
    ],
    [setNav, onClose],
  );

  const filteredItems = useMemo(() => {
    if (!query.trim()) return ALL_ITEMS;
    const q = query.toLowerCase().trim();
    return ALL_ITEMS.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        (item.meta && item.meta.toLowerCase().includes(q)) ||
        item.category.toLowerCase().includes(q),
    );
  }, [ALL_ITEMS, query]);

  // Group filtered items by category preserving visual order
  const categories = useMemo(() => {
    const cats: { name: string; items: PaletteItem[] }[] = [];
    const catOrder = ["Steps", "Operators", "Datasets", "Actions", "Navigation"];
    for (const cat of catOrder) {
      const items = filteredItems.filter((i) => i.category === cat);
      if (items.length > 0) {
        cats.push({ name: cat, items });
      }
    }
    return cats;
  }, [filteredItems]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Keyboard navigation inside palette
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, filteredItems.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) =>
        prev === 0 ? Math.max(0, filteredItems.length - 1) : prev - 1,
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filteredItems[selectedIndex]) {
        filteredItems[selectedIndex].onSelect();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  if (!open) return null;

  let flatIndex = 0;

  return (
    <div className="cmd-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="cmd-modal" onClick={(e) => e.stopPropagation()}>
        {/* Search Input Bar */}
        <div className="cmd-input-row">
          <SearchIcon />
          <input
            ref={inputRef}
            className="cmd-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search steps, operators, datasets, actions..."
          />
          <kbd className="cmd-kbd">esc</kbd>
        </div>

        {/* Results List */}
        <div className="cmd-list" role="listbox">
          {categories.length === 0 ? (
            <div className="cmd-empty">No results for &ldquo;{query}&rdquo;</div>
          ) : (
            categories.map((cat) => (
              <div key={cat.name} className="cmd-group">
                <div className="cmd-group-label">{cat.name}</div>
                {cat.items.map((item) => {
                  const currentIdx = flatIndex++;
                  const isSelected = currentIdx === selectedIndex;
                  return (
                    <div
                      key={item.id}
                      role="option"
                      aria-selected={isSelected}
                      className={`cmd-row ${isSelected ? "selected" : ""}`}
                      onMouseEnter={() => setSelectedIndex(currentIdx)}
                      onClick={item.onSelect}
                    >
                      <span className="cmd-row-title">{item.title}</span>
                      {item.meta && <span className="cmd-row-meta">{item.meta}</span>}
                      {item.badge && <kbd className="cmd-row-badge">{item.badge}</kbd>}
                      {isSelected && !item.badge && <span className="cmd-enter-glyph">↵</span>}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer shortcuts */}
        <div className="cmd-footer">
          <span className="cmd-hint">
            <span className="cmd-hint-key">↑ ↓</span> move
          </span>
          <span className="cmd-hint">
            <span className="cmd-hint-key">↵</span> open
          </span>
          <span className="cmd-hint">
            <span className="cmd-hint-key">⌘K</span> anywhere
          </span>
        </div>
      </div>
    </div>
  );
}
