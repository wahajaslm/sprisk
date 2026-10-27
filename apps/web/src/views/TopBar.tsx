import { useEffect, useState } from "react";

import { usePipelineVersions, useRuns, useStartRun } from "../api/hooks.ts";
import { flows } from "../flow/flows.ts";
import { useQuestionVersions } from "../api/questions.ts";
import { flowName } from "../flow/labels.ts";
import { currentQuestion, openEntries } from "./objective/ledger.ts";
import { NAV, NAV_LABEL, useSelection } from "../workbench/selection.ts";
import { useWorkbench } from "../workbench/workbench.ts";
import { LAYOUT, P } from "../styles/palette.ts";
import { ImportNotebook } from "./ImportNotebook.tsx";

/** Local mode has one project (the CLI's LOCAL_PROJECT). */
const PROJECT = "Local project";

/** The design's top bar: its columns line up with the rail, the sidebar, the centre and the
 * Copilot column below. Status and the primary action sit over Copilot while it is open. */
export function TopBar() {
  const { nav, setNav, pipelineVersionId, selectPipelineVersion, selectRun } = useSelection();
  const { copilotOpen, sidebarOpen } = useWorkbench();
  const questions = useQuestionVersions();
  const versions = usePipelineVersions();
  const runs = useRuns(pipelineVersionId);
  const startRun = useStartRun();
  const [menuOpen, setMenuOpen] = useState(false);
  const [importing, setImporting] = useState(false);

  // Open the newest flow and its newest run by default. A comparison saved later is not a flow.
  useEffect(() => {
    const newest = flows(versions.data ?? [])[0]?.head;
    if (pipelineVersionId === undefined && newest) selectPipelineVersion(newest.id);
  }, [versions.data, pipelineVersionId, selectPipelineVersion]);
  const latestRun = runs.data?.[0];
  const latestRunId = latestRun?.id;
  // Also when the selection was cleared, e.g. by picking the flow that is already open.
  const runId = useSelection((s) => s.runId);
  useEffect(() => {
    if (latestRunId && runId === undefined) selectRun(latestRunId);
  }, [latestRunId, runId, selectRun]);

  const current = versions.data?.find((v) => v.id === pipelineVersionId);
  const question = currentQuestion(questions.data ?? [], current);
  const openCount = question ? openEntries(question) : 0;
  const runState = startRun.isPending
    ? "Starting run…"
    : latestRun === undefined
      ? "Not run yet"
      : latestRun.status === "succeeded"
        ? "Graph up to date"
        : latestRun.status === "running" || latestRun.status === "queued"
          ? "Executing graph…"
          : `Last run ${latestRun.status}`;

  const errors = [versions, runs, startRun].flatMap((q) => (q.isError ? [q.error.message] : []));
  const status = (
    <>
      {errors.map((message) => (
        <span key={message} role="alert" style={{ fontSize: "12.5px", color: P.redHex, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: "0" }}>
          {message}
        </span>
      ))}
      {nav === "Objective" ? (
        questions.isError ? (
          <span role="alert" style={{ fontSize: "12.5px", color: P.redHex, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: "0" }}>
            {questions.error.message}
          </span>
        ) : (
          <span style={{ fontSize: "12.5px", color: "var(--t-faint,#8c8c8c)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: "0" }}>
            {question === undefined ? "No question yet" : openCount > 0 ? `${openCount} open in ledger` : "Ledger complete"}
          </span>
        )
      ) : (
        <>
          <span style={{ fontSize: "12.5px", color: "var(--t-faint,#8c8c8c)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: "0" }}>
            {runState}
          </span>
          <button
            type="button"
            className="dx-btn"
            disabled={pipelineVersionId === undefined || startRun.isPending}
            onClick={() => {
              if (pipelineVersionId) startRun.mutate(pipelineVersionId, { onSuccess: (run) => selectRun(run.id) });
            }}
            style={{ height: "30px", padding: "0 12px", borderRadius: "var(--r-sm,6px)", background: "var(--t-primary,#f2f2f2)", color: "var(--bg-app,#0a0a0a)", display: "flex", alignItems: "center", fontSize: "13px", fontWeight: "550", cursor: "pointer", whiteSpace: "nowrap" }}
          >
            Run pipeline
          </button>
        </>
      )}
    </>
  );

  return (
    <header role="banner" style={{ display: "grid", gridTemplateColumns: `var(--size-rail) ${sidebarOpen ? "var(--size-sidebar)" : "auto"} minmax(0,1fr) ${copilotOpen ? "var(--size-copilot)" : "var(--size-copilot-rail)"}`, columnGap: LAYOUT.gap, minWidth: "0" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: "24px", height: "24px", borderRadius: "var(--r-sm,6px)", background: "var(--t-primary,#f2f2f2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="var(--bg-app,#0a0a0a)" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <path d="M3 4.5h10M3 8h6.5M3 11.5h3.5" />
          </svg>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "12px", paddingLeft: "14px", minWidth: "0", position: "relative" }}>
        <span style={{ fontSize: "14px", fontWeight: "550", letterSpacing: "-0.01em", whiteSpace: "nowrap" }}>Flow Studio</span>
        <button
          type="button"
          className="dx-btn dx-h-08"
          aria-label="Project and pipeline"
          aria-haspopup="listbox"
          aria-expanded={menuOpen}
          title={PROJECT}
          onClick={() => setMenuOpen((open) => !open)}
          style={{ height: "28px", padding: "0 10px", borderRadius: "var(--r-sm,6px)", background: "rgba(var(--ink-rgb,255,255,255),0.05)", display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "var(--t-secondary,#d4d4d4)", whiteSpace: "nowrap", minWidth: "0" }}
        >
          {/* The design's pill names the flow; the project is the only one in local mode. */}
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{current ? flowName(current) : versions.isPending ? "loading…" : "No pipeline yet"}</span>
          <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" aria-hidden="true" style={{ flexShrink: "0" }}>
            <path d="M2.5 3.75L5 6.25l2.5-2.5" />
          </svg>
        </button>
        {menuOpen && (
          <div className="menu" role="listbox" aria-label="Pipelines">
            <p className="menu-title">Pipelines</p>
            {flows(versions.data ?? []).map(({ head, ids }) => (
              <button
                key={head.id}
                type="button"
                role="option"
                aria-selected={pipelineVersionId !== undefined && ids.includes(pipelineVersionId)}
                className="menu-item"
                onClick={() => {
                  selectPipelineVersion(head.id);
                  setMenuOpen(false);
                }}
              >
                <span>{flowName(head)}</span>
                <span className="menu-meta">
                  {head.nodes.length} steps · {ids.length === 1 ? "1 version" : `${ids.length} versions`}
                </span>
              </button>
            ))}
            <button
              type="button"
              className="menu-item"
              onClick={() => {
                setImporting(true);
                setMenuOpen(false);
              }}
            >
              Import notebook…
            </button>
          </div>
        )}
        {importing && <ImportNotebook onClose={() => setImporting(false)} />}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "14px", padding: "0 12px 0 10px", minWidth: "0", overflow: "hidden" }}>
        <nav aria-label="Main Navigation" style={{ display: "flex", alignItems: "stretch", gap: "0", height: "48px", minWidth: "0", overflowX: "auto", scrollbarWidth: "none" }}>
          {NAV.map((item) => {
            const active = nav === item;
            return (
              <button
                key={item}
                type="button"
                className="dx-btn dx-h-text"
                aria-current={active ? "page" : undefined}
                onClick={() => setNav(item)}
                style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: "0", padding: "0 8px", fontSize: "13.5px", fontWeight: "500", cursor: "pointer", color: active ? P.t0 : P.t3, boxShadow: active ? `inset 0 -1px 0 ${P.t0}` : "none" }}
              >
                {NAV_LABEL[item]}
                {item === "Objective" && openCount > 0 && (
                  <span style={{ fontSize: "11px", fontWeight: "500", padding: "1px 6px", borderRadius: "var(--r-sm,6px)", color: P.redHex, background: `rgba(${P.red},0.12)` }}>{openCount}</span>
                )}
              </button>
            );
          })}
        </nav>
        <span style={{ flex: "1" }} />
        {!copilotOpen && <div style={{ display: "flex", alignItems: "center", gap: "10px", flexShrink: "1", minWidth: "0" }}>{status}</div>}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "10px", paddingRight: "14px", minWidth: "0", overflow: "hidden" }}>
        {copilotOpen && status}
      </div>
    </header>
  );
}
