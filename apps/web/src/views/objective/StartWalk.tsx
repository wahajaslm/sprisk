import type { QuestionVersion, WalkAsk, WalkStopReason } from "@sprisk/contracts";
import { useState } from "react";
import { ulid } from "ulid";

import { useSaveQuestionVersion } from "../../api/questions.ts";
import { useStartWalk, useWalk } from "../../api/walks.ts";
import { Button } from "../../components/ui/Button.tsx";
import { timestamp } from "../../flow/edit.ts";
import { LOCAL_PROJECT } from "../../notebook/document.ts";
import { useSelection } from "../../workbench/selection.ts";
import { beforeWalk, withAnswers } from "./ledger.ts";

// A walk is bounded (ADR-0060). Enough rounds and time for a first look at a local file.
const MAX_ACTIONS = 50;
const MAX_WALL_SECONDS = 600;

const STOPPED: Record<WalkStopReason, string> = {
  complete: "Run complete",
  needs_person: "Needs your answer",
  limitation: "Stopped at a limitation",
  uncovered: "No method covers the next step",
  source_changed: "A source file changed",
  run_failed: "A run failed",
  stale: "The pipeline changed outside the run",
  budget_exhausted: "Out of budget",
  unverified: "A promise did not pass",
  error: "Stopped by an error",
};

/** Starts the engine on this question and the files a person names, then follows it. When the
 * walk's look stops with questions, they are answered here in one revision, and the walk starts
 * again on it (ADR-0063 amendment). */
export function StartWalk({ question }: { question: QuestionVersion }) {
  const [sourceText, setSourceText] = useState("");
  const startWalk = useStartWalk();
  const saveQuestion = useSaveQuestionVersion();
  const walk = useWalk(startWalk.data?.id);
  const { selectPipelineVersion, setNav } = useSelection();
  const sources = sourceText.split("\n").map((s) => s.trim()).filter((s) => s !== "");
  const detail = walk.data;
  const head = detail?.walk.head_pipeline_version_id;
  const missing = beforeWalk(question);
  const asks = detail?.walk.stop?.asks ?? [];

  const start = (questionId: string) =>
    startWalk.mutate({
      project_id: LOCAL_PROJECT,
      question_version_id: questionId,
      sources,
      max_actions: MAX_ACTIONS,
      max_wall_seconds: MAX_WALL_SECONDS,
    });

  const answer = (answers: Record<string, string>) =>
    saveQuestion.mutate(withAnswers(question, answers, `qv_${ulid()}`, timestamp()), {
      onSuccess: (revised) => start(revised.id),
    });

  return (
    <section className="start-walk" aria-label="Start a run">
      <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: "var(--fs-13)" }}>
        <span>Source files</span>
        <textarea
          className="ds-textarea"
          rows={2}
          value={sourceText}
          onChange={(e) => setSourceText(e.target.value)}
          placeholder="One path per line, e.g. data/x_train.csv"
        />
      </label>
      {missing.length > 0 && <p style={{ margin: 0 }}>State before the run: {missing.join(", ")}.</p>}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Button
          variant="primary"
          size="sm"
          disabled={sources.length === 0 || missing.length > 0 || startWalk.isPending}
          onClick={() => start(question.id)}
        >
          Start run
        </Button>
        {detail && (
          <span style={{ fontSize: "var(--fs-12-5)", color: "var(--text-muted)" }}>
            {detail.walk.stop ? STOPPED[detail.walk.stop.reason] : "Running"}
          </span>
        )}
        {head && (
          <Button
            size="sm"
            onClick={() => {
              selectPipelineVersion(head);
              setNav("Flow");
            }}
          >
            Open in pipeline
          </Button>
        )}
      </div>
      {startWalk.error && (
        <p role="alert" className="error" style={{ margin: 0 }}>
          {startWalk.error.message}
        </p>
      )}
      {saveQuestion.error && (
        <p role="alert" className="error" style={{ margin: 0 }}>
          The answers were not saved: {saveQuestion.error.message}
        </p>
      )}
      {walk.isError && (
        <p role="alert" className="error" style={{ margin: 0 }}>
          Run {startWalk.data?.id} cannot be read: {walk.error.message}
        </p>
      )}
      {asks.length > 0 ? (
        <Asks key={detail?.walk.id} asks={asks} saving={saveQuestion.isPending} onAnswer={answer} />
      ) : (
        detail?.walk.stop && <p style={{ margin: 0 }}>{detail.walk.stop.detail}</p>
      )}
      {detail && detail.steps.length > 0 && (
        <ol style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
          {detail.steps.map((step) => (
            <li key={step.round} style={{ fontSize: "var(--fs-12-5)" }}>
              <span style={{ color: "var(--text-muted)" }}>{step.action} · </span>
              {step.reason}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** The look's questions as one list: a method's ask offers its options, the one it would take
 * picked; a fact the question states is answered on the question. */
function Asks({ asks, saving, onAnswer }: {
  asks: WalkAsk[];
  saving: boolean;
  onAnswer: (answers: Record<string, string>) => void;
}) {
  const offered = asks.filter((ask) => ask.options && ask.option);
  const [picked, setPicked] = useState<Record<string, string>>(() =>
    Object.fromEntries(offered.map((ask) => [ask.decides, ask.option ?? ""])),
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }} aria-label="Questions before the run">
      {asks.map((ask) =>
        ask.options ? (
          <fieldset key={ask.decides} style={{ margin: 0, display: "flex", flexDirection: "column", gap: 4 }}>
            <legend style={{ fontSize: "var(--fs-13)" }}>{ask.question}</legend>
            {ask.options.map((option) => (
              <label key={option.id} style={{ fontSize: "var(--fs-12-5)", display: "flex", gap: 6 }}>
                <input
                  type="radio"
                  name={ask.decides}
                  checked={picked[ask.decides] === option.id}
                  onChange={() => setPicked({ ...picked, [ask.decides]: option.id })}
                />
                {option.label}
                {option.id === ask.option && <span style={{ color: "var(--text-muted)" }}> (suggested)</span>}
              </label>
            ))}
          </fieldset>
        ) : (
          <p key={ask.decides} style={{ margin: 0, fontSize: "var(--fs-13)" }}>
            {ask.question}
          </p>
        ),
      )}
      {offered.length > 0 && (
        <div>
          <Button variant="primary" size="sm" disabled={saving} onClick={() => onAnswer(picked)}>
            Answer and continue
          </Button>
        </div>
      )}
    </div>
  );
}
