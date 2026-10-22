import type { MethodologyReviewItem, MethodologyRule } from "@sprisk/contracts";
import { useMemo, useState } from "react";

import { useMethodologyReview, useMethodologyRules, useMethodologyRuleSource } from "../../api/methodology.ts";
import { Loading } from "../../components/ui/Loading.tsx";
import { CodeInput } from "../CodeInput.tsx";
import { useSelection } from "../../workbench/selection.ts";
import { MethodologyMap, STATUS_LABEL } from "./MethodologyMap.tsx";
import { activation, givenText, isOpen, reviewByRule, routeWhen, stageName } from "./ruleTree.ts";

const ignore = () => undefined;

/** The methodology map (ADR-0059): stages, decisions and their routes, with the selected
 * flow's status on each decision, and the picked rule's guidance and code beside it. */
export function MethodologyPage() {
  const rules = useMethodologyRules();
  const versionId = useSelection((s) => s.pipelineVersionId);
  const review = useMethodologyReview(versionId);
  const reviews = useMemo(() => reviewByRule(review.data?.items ?? []), [review.data]);
  const [filter, setFilter] = useState("");
  const [path, setPath] = useState(false);
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
          <label className="mth-toggle" title={versionId ? "Light the selected flow's path through the tree" : "Select a flow first"}>
            <input type="checkbox" role="switch" checked={path && versionId !== undefined} disabled={!versionId} onChange={(e) => setPath(e.target.checked)} /> Pipeline path
          </label>
          <ReviewSummary versionId={versionId} items={review.data?.items} next={review.data?.next} error={review.error?.message} />
        </div>
        <MethodologyMap rules={shown} reviews={reviews} path={path && versionId !== undefined} picked={current?.id} onPick={setPicked} />
      </div>
      <aside className="mth-side">{current && <RuleDetail key={current.id} rule={current} review={reviews.get(current.id)} />}</aside>
    </main>
  );
}

/** What the selected flow's review says: how many decisions are open, and what to do next. */
function ReviewSummary({ versionId, items, next, error }: { versionId: string | undefined; items: MethodologyReviewItem[] | undefined; next: number[] | undefined; error: string | undefined }) {
  if (!versionId) return <span className="muted">Select a flow to see its status on each decision.</span>;
  if (error) return <span role="alert" className="error">{error}</span>;
  if (!items || !next) return <Loading text="Reviewing the flow…" />;
  const open = items.filter((i) => isOpen(i.status)).length;
  const first = next[0] === undefined ? undefined : items[next[0]];
  return (
    <span className="mth-summary" aria-label="Flow review">
      {open === 0 ? "Nothing open on this flow." : `${open} open on this flow.`}
      {first && (
        <>
          {" "}
          Next: <strong>{first.decides}</strong> ({STATUS_LABEL[first.status].toLowerCase()})
        </>
      )}
    </span>
  );
}

function RuleDetail({ rule, review }: { rule: MethodologyRule; review: MethodologyReviewItem | undefined }) {
  const [tab, setTab] = useState<"overview" | "code">("overview");
  const source = useMethodologyRuleSource(rule.id);
  const python = source.data?.files.some((f) => f.language === "python");
  return (
    <section className="dsx-detail" aria-label={rule.name}>
      <header className="dsx-title">
        <div>
          <h1>{rule.name}</h1>
          <p className="muted">
            {stageName(rule.stage)} · decides <code>{rule.decides}</code>
            {activation(rule) && ` · ${activation(rule)}`} · <span className="tech">{rule.id}</span>
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
      {review && (
        <section className="mth-on-flow" aria-label="On this flow">
          <h2 className="dsx-h">On this flow</h2>
          <p>
            <span className={`mth-chip ${review.status}`}>{STATUS_LABEL[review.status]}</span>
            {review.subject_node_id && (
              <>
                {" "}
                step <code>{review.subject_node_id}</code>
              </>
            )}
          </p>
          <p>{review.reason}</p>
        </section>
      )}
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
                        {name} = {typeof value === "object" && !Array.isArray(value) ? `${value.value} (${value.origin})` : givenText(value)}
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
                {routeWhen(rule, a.id) && <p className="muted">When: {routeWhen(rule, a.id)}</p>}
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
