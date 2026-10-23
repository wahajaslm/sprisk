import { useEffect, useState } from "react";

import { usePipelineVersions, useRuns, useStartRun } from "../api/hooks.ts";
import { flows } from "../flow/flows.ts";
import { useQuestionVersions } from "../api/questions.ts";
import { flowName } from "../flow/labels.ts";
import { currentQuestion, openEntries } from "./objective/ledger.ts";
import { NAV, useSelection } from "../workbench/selection.ts";
import { Chevron, Logo } from "./Icons.tsx";
import { ImportNotebook } from "./ImportNotebook.tsx";

/** Local mode has one project (the CLI's LOCAL_PROJECT). */
const PROJECT = "Local project";

export function TopBar() {
  const { nav, setNav, pipelineVersionId, selectPipelineVersion, selectRun } = useSelection();
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

  return (
    <header className="topbar" role="banner">
      {/* Col 1: logo, above the 56px rail */}
      <div className="logo-cell">
        <div className="logo-icon-box">
          <Logo />
        </div>
      </div>

      {/* Col 2, over the sidebar: product and the project and flow switcher */}
      <div className="topbar-brand">
        <span className="product-name">Flow Studio</span>
        <div className="switcher-wrap">
          <button
            type="button"
            className="switcher"
            aria-label="Project and flow"
            aria-haspopup="listbox"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {/* The design's pill names the flow; the project is the only one in local mode. */}
            <span className="switcher-name" title={PROJECT}>
              {current ? flowName(current) : versions.isPending ? "loading…" : "No flow yet"}
            </span>
            <Chevron />
          </button>
          {menuOpen && (
            <div className="menu" role="listbox" aria-label="Flows">
              <p className="menu-title">Flows</p>
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

      </div>

      {/* Col 3, over the centre pane: the page tabs */}
      <nav className="nav" aria-label="Main Navigation">
          {NAV.map((item) => {
            const active = nav === item;
            return (
              <button
                key={item}
                type="button"
                aria-current={active ? "page" : undefined}
                className={active ? "active" : ""}
                onClick={() => setNav(item)}
              >
                {item}
                {item === "Objective" && openCount > 0 && <span className="tab-badge-open">{openCount}</span>}
              </button>
            );
          })}
        </nav>

      {/* Col 4: status and the page's primary action */}
      <div className="topbar-actions">
        {nav === "Objective" ? (
          questions.isError ? (
            <span role="alert" className="error">{questions.error.message}</span>
          ) : (
          <span className="runstate">
            {question === undefined ? "No question yet" : openCount > 0 ? `${openCount} open in ledger` : "Ledger complete"}
          </span>
          )
        ) : (
          <>
            {versions.isError && <span role="alert" className="error">{versions.error.message}</span>}
            {runs.isError && <span role="alert" className="error">{runs.error.message}</span>}
            {startRun.isError && <span role="alert" className="error">{startRun.error.message}</span>}
            <span className={`runstate ${latestRun?.status ?? "none"}`}>
              {runState}
            </span>
            <button
              type="button"
              className="run-button primary"
              disabled={pipelineVersionId === undefined || startRun.isPending}
              onClick={() => {
                if (pipelineVersionId) startRun.mutate(pipelineVersionId, { onSuccess: (run) => selectRun(run.id) });
              }}
            >
              Run flow
            </button>
          </>
        )}
      </div>
    </header>
  );
}
