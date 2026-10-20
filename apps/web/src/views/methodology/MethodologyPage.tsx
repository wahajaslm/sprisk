import type { MethodologyRule } from "@sprisk/contracts";
import { useState } from "react";

import { useMethodologyRules, useMethodologyRuleSource } from "../../api/methodology.ts";
import { Loading } from "../../components/ui/Loading.tsx";
import { CodeInput } from "../CodeInput.tsx";
import { MethodologyMap } from "./MethodologyMap.tsx";
import { stageName } from "./ruleTree.ts";

const ignore = () => undefined;

/** The rule packs (ADR-0042) as a map of stages and rules, and the picked rule's guidance
 * and code beside it. */
export function MethodologyPage() {
  const rules = useMethodologyRules();
  const [filter, setFilter] = useState("");
  const [picked, setPicked] = useState<string>();
  if (rules.isError) return <p role="alert" className="error pad">{rules.error.message}</p>;
  if (rules.isPending) return <Loading text="Loading methodology rules…" pad />;
  if (rules.data.length === 0) return <p className="muted pad">No methodology rules are loaded.</p>;

  const query = filter.trim().toLowerCase();
  const shown = rules.data.filter((r) => `${r.name} ${r.decides}`.toLowerCase().includes(query));
  const current = shown.find((r) => r.id === picked) ?? shown[0];

  return (
    <main className="mth-page">
      <div className="mth-canvas">
        <div className="mth-toolbar">
          <input type="search" className="ds-filter" aria-label="Filter rules" placeholder="Filter rules" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        <MethodologyMap rules={shown} picked={current?.id} onPick={setPicked} />
      </div>
      <aside className="mth-side">{current && <RuleDetail key={current.id} rule={current} />}</aside>
    </main>
  );
}

function RuleDetail({ rule }: { rule: MethodologyRule }) {
  const [tab, setTab] = useState<"overview" | "code">("overview");
  const source = useMethodologyRuleSource(rule.id);
  const python = source.data?.files.some((f) => f.language === "python");
  return (
    <section className="dsx-detail" aria-label={rule.name}>
      <header className="dsx-title">
        <div>
          <h1>{rule.name}</h1>
          <p className="muted">
            {stageName(rule.stage)} · decides <code>{rule.decides}</code> · <span className="tech">{rule.id}</span>
          </p>
          {source.data && <p className="mth-tag">{python ? "Python decide() in rule.py" : "No rule.py yet: manifest only"}</p>}
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

      {rule.status === "active" ? (
        <>
          <section>
            <h2 className="dsx-h">Reads</h2>
            <ul className="mth-rows">
              {(rule.reads ?? []).map((name) => (
                <li key={name}>
                  <code>{name}</code>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h2 className="dsx-h">Examples</h2>
            <p className="muted">Run as tests on every change, so they always hold.</p>
            <ol className="mth-rows">
              {(rule.examples ?? []).map((example, i) => (
                <li key={i} aria-label={`Example ${i + 1}`}>
                  <span>
                    {Object.entries(example.given).map(([name, value]) => (
                      <code key={name}>
                        {name} = {typeof value === "object" ? `${value.value} (${value.origin})` : String(value)}
                      </code>
                    ))}
                    {Object.keys(example.given).length === 0 && <span className="muted">nothing known</span>}
                  </span>
                  <span className="mth-tag">
                    → {example.shortlist ? `shortlist: ${example.shortlist.join(", ")}` : (rule.alternatives.find((a) => a.id === example.picks)?.label ?? example.picks)}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </>
      ) : (
        <section>
          <h2 className="dsx-h">Observes</h2>
          <p className="muted">Draft: not run yet. These notes are the design for its code.</p>
          <ul className="mth-rows">
            {(rule.observes ?? []).map((o) => {
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
      )}

      {rule.selection === "shortlist" && (
        <section>
          <h2 className="dsx-h">Where the candidates come from</h2>
          <p>Every registered model that fits the task. The rule puts forward the ones worth comparing; cross-validation picks the winner (ADR-0044).</p>
        </section>
      )}

      {rule.alternatives.length > 0 && (
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
                {a.condition && <p className="muted">When: {a.condition}</p>}
                <p className="muted">Why: {a.rationale}</p>
              </li>
            ))}
          </ol>
        </section>
      )}

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
