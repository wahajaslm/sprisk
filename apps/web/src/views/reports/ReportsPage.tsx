import { useState } from "react";
import type { PipelineVersion, QuestionVersion, Unknown } from "@sprisk/contracts";

import { useLoadedTables } from "../../api/datasets.ts";
import { usePipelineVersions } from "../../api/hooks.ts";
import { useQuestionVersions } from "../../api/questions.ts";
import { Button } from "../../components/ui/Button.tsx";
import { InfoDock } from "../../components/ui/InfoDock.tsx";
import { ListRow } from "../../components/ui/ListRow.tsx";
import { Loading } from "../../components/ui/Loading.tsx";
import { PageFrame } from "../../components/ui/PageFrame.tsx";
import { SectionLabel } from "../../components/ui/SectionLabel.tsx";
import { Sidebar } from "../../components/ui/Sidebar.tsx";
import { flows } from "../../flow/flows.ts";
import { flowName } from "../../flow/labels.ts";
import { tableSize } from "../datasets/tableSize.ts";
import { useSelection } from "../../workbench/selection.ts";
import { currentQuestion, openEntries } from "../objective/ledger.ts";

const TABS = ["Questions", "Sources"] as const;
type Tab = (typeof TABS)[number];

const BLOCKS: Record<Unknown["blocks"], string> = { planning: "planning", execution: "running", release: "release" };

/** One entry of the ledger: the objective itself, or one open unknown. */
type Entry = { key: string; number: number } & ({ kind: "objective" } | { kind: "unknown"; unknown: Unknown });

/** The question ledger: what the analysis set out to answer, what is still open, and its sources. */
export function ReportsPage() {
  const questions = useQuestionVersions();
  const versions = usePipelineVersions();
  const pipelineVersionId = useSelection((s) => s.pipelineVersionId);
  const setNav = useSelection((s) => s.setNav);
  const [tab, setTab] = useState<Tab>("Questions");
  const [picked, setPicked] = useState("objective");

  if (questions.isError) return <p role="alert" className="error pad">{questions.error.message}</p>;
  if (questions.isPending) return <Loading text="Loading the question ledger…" pad />;

  const question = currentQuestion(questions.data, versions.data?.find((v) => v.id === pipelineVersionId));
  const entries: Entry[] = question
    ? [
        { key: "objective", number: 1, kind: "objective" },
        ...question.unknowns.map((unknown, i) => ({ key: `unknown-${i}`, number: i + 2, kind: "unknown" as const, unknown })),
      ]
    : [];
  const entry = entries.find((e) => e.key === picked) ?? entries[0];
  const open = question ? openEntries(question) : 0;
  // A group label starts each run of unknowns that block the same stage.
  const startsGroup = (i: number) => {
    const e = entries[i]!;
    const before = entries[i - 1];
    return e.kind === "unknown" && (before?.kind !== "unknown" || before.unknown.blocks !== e.unknown.blocks);
  };

  return (
    <PageFrame
      sidebar={
        <Sidebar
          title="Questions"
          meta={String(entries.length)}
          dock={
            question && (
              <InfoDock
                title="Ledger"
                rows={[
                  { k: "Open", v: String(open), warn: open > 0 },
                  { k: "Assumptions", v: String(question.assumptions.length) },
                  { k: "Criteria", v: String(question.acceptance_criteria.length) },
                ]}
              />
            )
          }
        >
          {!question && <p className="muted pad">No question yet. State one on the Objective page.</p>}
          {question &&
            entries.map((e, i) => (
              <div key={e.key}>
                {e.kind === "unknown" && startsGroup(i) && <SectionLabel>Before {BLOCKS[e.unknown.blocks]}</SectionLabel>}
                <ListRow
                  title={e.kind === "objective" ? question.objective.value : e.unknown.question}
                  meta={e.kind === "objective" ? `${question.task.value} · ${open} open` : "Open"}
                  warn={e.kind === "unknown"}
                  selected={e.key === entry?.key}
                  onClick={() => setPicked(e.key)}
                />
              </div>
            ))}
        </Sidebar>
      }
      header={{
        eyebrow: "Question ledger",
        title: "What we set out to answer",
        actions: (
          <>
            <Button onClick={() => window.print()}>Export report</Button>
            <Button variant="primary" onClick={() => setNav("Objective")}>
              Add question
            </Button>
          </>
        ),
      }}
      tabs={{ label: "Report", items: TABS.map((t) => ({ value: t, label: t })), value: tab, onChange: (t) => setTab(t as Tab) }}
    >
      {tab === "Questions" && question && entry && (
        <EntryReport entry={entry} question={question} history={questions.data} versions={versions.data ?? []} />
      )}
      {tab === "Sources" && <Sources />}
    </PageFrame>
  );
}

function EntryReport({ entry, question, history, versions }: {
  entry: Entry;
  question: QuestionVersion;
  history: QuestionVersion[];
  versions: PipelineVersion[];
}) {
  const { selectPipelineVersion, setNav } = useSelection();
  const objective = entry.kind === "objective";
  const open = objective ? openEntries(question) > 0 : true;
  const usesQuestion = (id: string) => versions.find((v) => v.id === id)?.question_version_id === question.id;
  const usedBy = flows(versions).filter((f) => f.ids.some(usesQuestion));
  const revisions = history.filter((q) => q.investigation_id === question.investigation_id);
  return (
    <article className="report-entry">
      <header className="report-entry-head">
        <span className="report-eyebrow">
          Q{entry.number} · {objective ? "objective" : "open question"} · {day(question.created_at)}
        </span>
        <h2 className="report-question">{objective ? question.objective.value : entry.unknown.question}</h2>
        <span className={`report-status${open ? " open" : ""}`}>{open ? "Open" : "Stated"}</span>
      </header>

      <section className="report-answer" aria-label="Current answer">
        <h3 className="report-h">Current answer</h3>
        {objective ? (
          <dl className="report-facts">
            <dt>Task</dt>
            <dd>{question.task.value}</dd>
            <dt>Target</dt>
            <dd>{question.target?.value ?? "Not stated"}</dd>
            <dt>Unit</dt>
            <dd>{question.unit_of_analysis?.value ?? "Not stated"}</dd>
            <dt>Horizon</dt>
            <dd>{question.prediction_horizon?.value ?? "Not stated"}</dd>
          </dl>
        ) : (
          <p>Not answered yet. It must be settled before {BLOCKS[entry.unknown.blocks]}.</p>
        )}
      </section>

      {objective && (
        <>
          <ListSection label="Assumptions" items={question.assumptions.map((a) => a.value)} />
          <ListSection label="Acceptance criteria" items={question.acceptance_criteria.map((c) => c.value)} />
          <section className="report-section" aria-label="Evidence">
            <h3 className="report-h">Evidence</h3>
            {usedBy.length === 0 ? (
              <p className="muted">No flow uses this question yet.</p>
            ) : (
              <div className="report-links">
                {usedBy.map(({ head }) => (
                  <Button key={head.id} onClick={() => { selectPipelineVersion(head.id); setNav("Flow"); }}>
                    Open flow {flowName(head)}
                  </Button>
                ))}
              </div>
            )}
          </section>
          <section className="report-section" aria-label="History">
            <h3 className="report-h">History</h3>
            <ol className="report-history">
              {revisions.map((q, i) => (
                <li key={q.id}>
                  <span className="mono">v{revisions.length - i}</span>
                  <span>{q.objective.value}</span>
                  <span className="muted">{day(q.created_at)}</span>
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
    </article>
  );
}

function ListSection({ label, items }: { label: string; items: string[] }) {
  return (
    <section className="report-section" aria-label={label}>
      <h3 className="report-h">{label}</h3>
      {items.length === 0 ? <p className="muted">None written down.</p> : <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul>}
    </section>
  );
}

function Sources() {
  const tables = useLoadedTables();
  if (tables.isError) return <p role="alert" className="error pad">{tables.error.message}</p>;
  if (tables.isPending) return <Loading text="Loading sources…" pad />;
  if (tables.data.length === 0) return <p className="muted pad">No data loaded yet.</p>;
  return (
    <ul className="row-list" aria-label="Sources">
      {tables.data.map((t) => (
        <li key={t.artifact.id} className="row-list-item">
          <span className="row-list-name">{t.name}</span>
          <span className="row-list-meta">{tableSize(t)}</span>
        </li>
      ))}
    </ul>
  );
}

const day = (timestamp: string) => new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
