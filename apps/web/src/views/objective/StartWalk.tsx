import type { QuestionVersion, WalkStopReason } from "@sprisk/contracts";
import { useState } from "react";

import { useStartWalk, useWalk } from "../../api/walks.ts";
import { Button } from "../../components/ui/Button.tsx";
import { LOCAL_PROJECT } from "../../notebook/document.ts";
import { useSelection } from "../../workbench/selection.ts";

// A walk is bounded (ADR-0060). Enough rounds and time for a first look at a local file.
const MAX_ACTIONS = 50;
const MAX_WALL_SECONDS = 600;

const STOPPED: Record<WalkStopReason, string> = {
  complete: "Walk complete",
  needs_person: "Needs your answer",
  limitation: "Stopped at a limitation",
  uncovered: "No method covers the next step",
  source_changed: "A source file changed",
  run_failed: "A run failed",
  stale: "The flow changed outside the walk",
  budget_exhausted: "Out of budget",
  error: "Stopped by an error",
};

/** Starts the engine on this question and the files a person names, then follows it. */
export function StartWalk({ question }: { question: QuestionVersion }) {
  const [sourceText, setSourceText] = useState("");
  const startWalk = useStartWalk();
  const walk = useWalk(startWalk.data?.id);
  const { selectPipelineVersion, setNav } = useSelection();
  const sources = sourceText.split("\n").map((s) => s.trim()).filter((s) => s !== "");
  const detail = walk.data;
  const head = detail?.walk.head_pipeline_version_id;

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 10 }} aria-label="Start a walk">
      <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: "var(--fs-13)" }}>
        <span>Source files</span>
        <textarea
          className="ds-input"
          rows={2}
          value={sourceText}
          onChange={(e) => setSourceText(e.target.value)}
          placeholder="One path per line, e.g. data/x_train.csv"
        />
      </label>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Button
          variant="primary"
          size="sm"
          disabled={sources.length === 0 || startWalk.isPending}
          onClick={() =>
            startWalk.mutate({
              project_id: LOCAL_PROJECT,
              question_version_id: question.id,
              sources,
              max_actions: MAX_ACTIONS,
              max_wall_seconds: MAX_WALL_SECONDS,
            })
          }
        >
          Start walk
        </Button>
        {detail && (
          <span style={{ fontSize: "var(--fs-12-5)", color: "var(--text-muted)" }}>
            {detail.walk.stop ? STOPPED[detail.walk.stop.reason] : "Walking"}
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
            Open in flow
          </Button>
        )}
      </div>
      {startWalk.error && (
        <p role="alert" className="error" style={{ margin: 0 }}>
          {startWalk.error.message}
        </p>
      )}
      {walk.isError && (
        <p role="alert" className="error" style={{ margin: 0 }}>
          Walk {startWalk.data?.id} cannot be read: {walk.error.message}
        </p>
      )}
      {detail?.walk.stop && <p style={{ margin: 0 }}>{detail.walk.stop.detail}</p>}
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
