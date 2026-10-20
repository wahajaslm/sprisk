import type { MethodologyRule, MethodologyStage } from "@sprisk/contracts";
import { useState } from "react";

import { useMethodologyRules, useMethodologyRuleSource } from "../../api/methodology.ts";
import { Loading } from "../../components/ui/Loading.tsx";
import { CodeInput } from "../CodeInput.tsx";

/** ADR-0042: stages run in this order. */
const STAGES: MethodologyStage[] = ["question", "data", "cleaning", "split", "features", "models", "evaluation", "reporting"];
const stageName = (stage: MethodologyStage) => stage[0]!.toUpperCase() + stage.slice(1);
const ignore = () => undefined;

/** The rule packs (ADR-0042): every rule by stage, and the picked one's guidance and code. */
export function MethodologyPage() {
  const rules = useMethodologyRules();
  const [filter, setFilter] = useState("");
  const [picked, setPicked] = useState<string>();
  if (rules.isError) return <p role="alert" className="error pad">{rules.error.message}</p>;
  if (rules.isPending) return <Loading text="Loading methodology rules…" pad />;

  const query = filter.trim().toLowerCase();
  const shown = rules.data.filter((r) => `${r.name} ${r.decides}`.toLowerCase().includes(query));
  const byStage = STAGES.map((stage) => ({ stage, rules: shown.filter((r) => r.stage === stage) })).filter((g) => g.rules.length > 0);
  const current = shown.find((r) => r.id === picked) ?? byStage[0]?.rules[0];

  return (
    <main className="dsx">
      <nav className="dsx-side" aria-label="Methodology rules">
        <header className="dsx-side-head">
          <p className="eyebrow">Methodology · {rules.data.length === 1 ? "1 rule" : `${rules.data.length} rules`}</p>
          <input type="search" className="ds-filter" aria-label="Filter rules" placeholder="Filter rules" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </header>
        {rules.data.length === 0 ? (
          <p className="muted pad">No methodology rules are loaded.</p>
        ) : (
          <div className="mth-groups">
            {byStage.map((group) => (
              <section key={group.stage}>
                <h2 className="mth-stage">{stageName(group.stage)}</h2>
                <ul className="dsx-list mth-list">
                  {group.rules.map((rule) => (
                    <li key={rule.id}>
                      <button type="button" className={`dsx-item${rule === current ? " picked" : ""}`} aria-pressed={rule === current} onClick={() => setPicked(rule.id)}>
                        <span className="dsx-item-name mth-item-name">{rule.name}</span>
                        <span className="dsx-item-meta">{rule.decides}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </nav>
      <div className="dsx-main">{current && <RuleDetail key={current.id} rule={current} />}</div>
    </main>
  );
}

function RuleDetail({ rule }: { rule: MethodologyRule }) {
  const [tab, setTab] = useState<"overview" | "code">("overview");
  return (
    <section className="dsx-detail" aria-label={rule.name}>
      <header className="dsx-title">
        <div>
          <h1>{rule.name}</h1>
          <p className="muted">
            {stageName(rule.stage)} · decides <code>{rule.decides}</code> · <span className="tech">{rule.id}</span>
          </p>
        </div>
      </header>
      <div className="dsx-tabs" role="tablist" aria-label="Rule view tabs">
        {(["overview", "code"] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={`dsx-tab-btn${tab === t ? " active" : ""}`} onClick={() => setTab(t)}>
            {t === "overview" ? "Overview" : "Code"}
          </button>
        ))}
      </div>
      {tab === "overview" ? <Overview rule={rule} /> : <RuleCode ruleRef={rule.id} />}
    </section>
  );
}

function Overview({ rule }: { rule: MethodologyRule }) {
  const { provenance } = rule;
  return (
    <div className="mth-overview">
      <section>
        <h2 className="dsx-h">Pitfall it prevents</h2>
        <p>{provenance.pitfall}</p>
        {provenance.corner_cases.length > 0 && (
          <ul className="mth-bullets">
            {provenance.corner_cases.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="dsx-h">Source</h2>
        <dl className="mth-facts">
          <dt>Standard</dt>
          <dd>{provenance.standard}</dd>
          <dt>Citation</dt>
          <dd>{provenance.citation}</dd>
        </dl>
      </section>

      <section>
        <h2 className="dsx-h">Observes</h2>
        <ul className="mth-rows">
          {rule.observes.map((o) => {
            const name = "profile" in o ? o.profile : o.fact;
            return (
              <li key={name}>
                <code>{name}</code>
                <span className="muted">{o.description}</span>
                <span className="mth-tag">
                  {"profile" in o ? "profile" : "fact"}
                  {o.required ? " · required" : ""}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <h2 className="dsx-h">Alternatives</h2>
        <ol className="mth-alts">
          {rule.alternatives.map((a) => (
            <li key={a.id}>
              <div className="mth-alt-head">
                <strong>{a.label}</strong>
                <span className="mth-tag">{a.action.operator ?? a.action.type}</span>
              </div>
              <p>{a.description}</p>
              <p className="muted">When: {a.condition}</p>
              <p className="muted">Why: {a.rationale}</p>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h2 className="dsx-h">Verified by</h2>
        <p>
          <code>{rule.verification.check_id}</code>
        </p>
        <p className="muted">{rule.verification.invariant}</p>
      </section>
    </div>
  );
}

function RuleCode({ ruleRef }: { ruleRef: string }) {
  const source = useMethodologyRuleSource(ruleRef);
  const [path, setPath] = useState<string>();
  if (source.isError) return <p role="alert" className="error">{source.error.message}</p>;
  if (source.isPending) return <Loading text="Loading code…" />;

  const file = source.data.files.find((f) => f.path === path) ?? source.data.files[0]!;
  return (
    <div className="code-editor mth-code">
      <div className="code-actions">
        {source.data.files.map((f) => (
          <button key={f.path} type="button" className="page-btn" aria-pressed={f === file} onClick={() => setPath(f.path)}>
            {f.path}
          </button>
        ))}
        <span className="spacer" />
        {source.data.files.length === 1 && <span className="muted">This rule has no rule.py yet.</span>}
      </div>
      <CodeInput key={file.path} value={file.text} label={`Code of ${file.path}`} language={file.language} readOnly onChange={ignore} onRun={ignore} />
    </div>
  );
}
