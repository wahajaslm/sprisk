import { useState } from "react";
import type { QuestionVersion } from "@sprisk/contracts";

import { useQuestionVersions } from "../../api/questions.ts";
import { usePipelineVersions } from "../../api/hooks.ts";
import { Sidebar } from "../../components/ui/Sidebar.tsx";
import { ListRow } from "../../components/ui/ListRow.tsx";
import { InfoDock } from "../../components/ui/InfoDock.tsx";
import { SearchField } from "../../components/ui/SearchField.tsx";
import { PageHeader } from "../../components/ui/PageHeader.tsx";
import { Tabs } from "../../components/ui/Tabs.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Tag } from "../../components/ui/Tag.tsx";
import { Loading } from "../../components/ui/Loading.tsx";
import { useWorkbench } from "../../workbench/workbench.ts";
import { ReportsIcon } from "../Icons.tsx";

const TABS = ["Ledger", "Criteria", "Assumptions", "Unknowns"] as const;
type Tab = (typeof TABS)[number];

export function ReportsPage() {
  const questionsQuery = useQuestionVersions();
  const pipelinesQuery = usePipelineVersions();
  const sidebarOpen = useWorkbench((s) => s.sidebarOpen);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string>();
  const [activeTab, setActiveTab] = useState<Tab>("Ledger");

  if (questionsQuery.isError) {
    return <p role="alert" className="error pad">{questionsQuery.error.message}</p>;
  }
  if (questionsQuery.isPending) {
    return <Loading text="Loading reports…" pad />;
  }

  const questions = questionsQuery.data ?? [];
  const filtered = questions.filter(
    (q) => !query || q.objective.value.toLowerCase().includes(query.toLowerCase()) || q.id.toLowerCase().includes(query.toLowerCase()),
  );

  const selectedQuestion = filtered.find((q) => q.id === selectedId) ?? filtered[0];

  return (
    <div className={`reports-page-layout ${sidebarOpen ? "with-sidebar" : "folded-sidebar"}`}>
      {/* 280px Design System Sidebar */}
      <Sidebar
        title="Ledger"
        meta={String(questions.length)}
        search={
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Search questions"
          />
        }
        dock={
          selectedQuestion ? (
            <InfoDock
              title="Question Metadata"
              rows={[
                { k: "Task", v: selectedQuestion.task.value },
                { k: "Target", v: selectedQuestion.target?.value ?? "None" },
                { k: "Unit", v: selectedQuestion.unit_of_analysis?.value ?? "—" },
              ]}
            />
          ) : undefined
        }
      >
        {questions.length === 0 ? (
          <p className="muted pad" style={{ padding: "16px 12px", fontSize: "var(--fs-13)" }}>
            No question revisions recorded yet. Start in Objective to state questions.
          </p>
        ) : (
          filtered.map((q) => {
            const isSelected = selectedQuestion?.id === q.id;
            return (
              <ListRow
                key={q.id}
                title={q.objective.value}
                meta={`${q.task.value} · target: ${q.target?.value ?? "None"}`}
                selected={isSelected}
                onClick={() => setSelectedId(q.id)}
              />
            );
          })
        )}
      </Sidebar>

      {/* Main Content Area */}
      <main className="center-screen reports-main">
        {selectedQuestion ? (
          <>
            <PageHeader
              title={selectedQuestion.objective.value}
              description={`Revision ${selectedQuestion.id.slice(-8)} · Target: ${selectedQuestion.target?.value ?? "None"}`}
              actions={
                <Button variant="secondary" onClick={() => window.print()}>
                  Export report
                </Button>
              }
            />
            <Tabs
              items={TABS.map((t) => ({ value: t, label: t }))}
              value={activeTab}
              onChange={(t) => setActiveTab(t as Tab)}
            />

            <div style={{ flex: 1, overflow: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
              {activeTab === "Ledger" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border-panel)", borderRadius: "var(--radius-sm)", padding: 18 }}>
                    <h3 style={{ margin: "0 0 10px", fontSize: "var(--fs-14)", fontWeight: "var(--fw-medium)" }}>Objective</h3>
                    <p style={{ margin: 0, fontSize: "var(--fs-13-5)", color: "var(--text-secondary)", lineHeight: 1.5 }}>{selectedQuestion.objective.value}</p>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
                    <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border-panel)", borderRadius: "var(--radius-sm)", padding: 14 }}>
                      <span style={{ fontSize: "var(--fs-12)", color: "var(--text-label)" }}>Task type</span>
                      <p style={{ margin: "4px 0 0", fontSize: "var(--fs-14)", fontWeight: "var(--fw-medium)" }}>{selectedQuestion.task.value}</p>
                    </div>
                    <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border-panel)", borderRadius: "var(--radius-sm)", padding: 14 }}>
                      <span style={{ fontSize: "var(--fs-12)", color: "var(--text-label)" }}>Target variable</span>
                      <p style={{ margin: "4px 0 0", fontSize: "var(--fs-14)", fontWeight: "var(--fw-medium)" }}>{selectedQuestion.target?.value ?? "None"}</p>
                    </div>
                    <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border-panel)", borderRadius: "var(--radius-sm)", padding: 14 }}>
                      <span style={{ fontSize: "var(--fs-12)", color: "var(--text-label)" }}>Analysis unit</span>
                      <p style={{ margin: "4px 0 0", fontSize: "var(--fs-14)", fontWeight: "var(--fw-medium)" }}>{selectedQuestion.unit_of_analysis?.value ?? "—"}</p>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "Criteria" && (
                <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border-panel)", borderRadius: "var(--radius-sm)", padding: 18 }}>
                  <h3 style={{ margin: "0 0 10px", fontSize: "var(--fs-14)", fontWeight: "var(--fw-medium)" }}>Acceptance Criteria</h3>
                  <p style={{ margin: 0, fontSize: "var(--fs-13-5)", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                    {selectedQuestion.acceptance_criteria?.map((c) => c.value).join("; ") || "No explicit acceptance criteria specified for this revision."}
                  </p>
                </div>
              )}

              {activeTab === "Assumptions" && (
                <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border-panel)", borderRadius: "var(--radius-sm)", padding: 18 }}>
                  <h3 style={{ margin: "0 0 10px", fontSize: "var(--fs-14)", fontWeight: "var(--fw-medium)" }}>Assumptions</h3>
                  <p style={{ margin: 0, fontSize: "var(--fs-13-5)", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                    {selectedQuestion.assumptions?.map((a) => a.value).join("; ") || "No domain assumptions documented for this revision."}
                  </p>
                </div>
              )}

              {activeTab === "Unknowns" && (
                <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border-panel)", borderRadius: "var(--radius-sm)", padding: 18 }}>
                  <h3 style={{ margin: "0 0 10px", fontSize: "var(--fs-14)", fontWeight: "var(--fw-medium)" }}>Documented Unknowns</h3>
                  <p style={{ margin: 0, fontSize: "var(--fs-13-5)", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                    {selectedQuestion.unknowns?.map((u) => u.question).join("; ") || "No open unknowns tracked for this revision."}
                  </p>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="reports-empty-viewport">
            <div className="reports-empty-card">
              <div className="reports-empty-icon">
                <ReportsIcon size={28} />
              </div>
              <h3 className="reports-empty-title">No Questions in the Ledger</h3>
              <p className="reports-empty-sub">
                Revisions, acceptance criteria, assumptions, and audited evidence will appear here as you develop workflows in Objective and Flow.
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
