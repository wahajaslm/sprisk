import type { MethodologyReviewItem, MethodologyRule } from "@sprisk/contracts";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { useMethodologyReview, useMethodologyRules, useMethodologyRuleSource } from "../../api/methodology.ts";
import { Button } from "../../components/ui/Button.tsx";
import { InfoDock } from "../../components/ui/InfoDock.tsx";
import { ListRow } from "../../components/ui/ListRow.tsx";
import { Loading } from "../../components/ui/Loading.tsx";
import { PageFrame } from "../../components/ui/PageFrame.tsx";
import { SearchField } from "../../components/ui/SearchField.tsx";
import { SectionLabel } from "../../components/ui/SectionLabel.tsx";
import { Sidebar } from "../../components/ui/Sidebar.tsx";
import { CodeInput } from "../CodeInput.tsx";
import { useSelection } from "../../workbench/selection.ts";
import { type Chapter, chapters, chapterState, ends } from "./flowGraph.ts";
import { FlowMap } from "./FlowMap.tsx";
import { MethodologyCanvas } from "./MethodologyCanvas.tsx";
import { MethodologyMap, STATUS_LABEL } from "./MethodologyMap.tsx";
import { activation, givenText, isOpen, lookedAt, reviewByRule, routeWhen, stageName, withSettings } from "./ruleTree.ts";

const ignore = () => undefined;

const TABS = ["Map", "Overview", "Code", "Used in"] as const;
type Tab = (typeof TABS)[number];

/** The methodology map (ADR-0059) in the Flow Studio frame: the rules by stage beside it, and
 * the picked rule's map, overview, code and the steps it decides on the selected flow. */
export function MethodologyPage() {
  const rules = useMethodologyRules();
  const versionId = useSelection((s) => s.pipelineVersionId);
  const review = useMethodologyReview(versionId);
  const reviews = useMemo(() => reviewByRule(review.data?.items ?? []), [review.data]);
  const [filter, setFilter] = useState("");
  const [path, setPath] = useState(false);
  const [picked, setPicked] = useState<string>();
  const [view, setView] = useState<"map" | "tree" | "flow">("map");
  const [drafts, setDrafts] = useState(false);
  const [chapterKey, setChapterKey] = useState<string>();
  const [tab, setTab] = useState<Tab>("Map");
  const empty = (body: ReactNode) => <PageFrame header={{ eyebrow: "Methodology", title: "Rules" }}>{body}</PageFrame>;
  if (rules.isError) return empty(<p role="alert" className="error">{rules.error.message}</p>);
  if (rules.isPending) return empty(<Loading text="Loading methodology rules…" />);
  if (rules.data.length === 0) return empty(<p className="muted">No methodology rules are loaded.</p>);

  const query = filter.trim().toLowerCase();
  // The map and the flow show what runs: the active rules, and the drafts only when asked.
  const shown = rules.data.filter((r) => `${r.name} ${r.decides}`.toLowerCase().includes(query) && (view === "tree" || drafts || r.status === "active"));
  const [pickedRule, pickedRoute] = (picked ?? "").split("#");
  const current = shown.find((r) => r.id === pickedRule) ?? shown[0];
  const all = chapters(shown);
  // The chosen stage, else the one holding the picked rule, else the first.
  const byKey = all.findIndex((c) => c.key === chapterKey);
  const byRule = all.findIndex((c) => current !== undefined && c.rules.includes(current));
  const at = byKey >= 0 ? byKey : Math.max(0, byRule);
  const chapter = all[at];
  const onFlow = current && reviews.get(current.id);
  const pickedId = current?.id === pickedRule ? picked : current?.id;

  return (
    <PageFrame
      label="Methodology"
      flush={tab === "Map"}
      sidebar={
        <Sidebar
          title="Rules"
          meta={`${shown.length} rules`}
          search={<SearchField value={filter} onChange={setFilter} placeholder="Filter rules" ariaLabel="Filter rules" />}
          dock={
            current && (
              <InfoDock
                title="Rule"
                rows={[
                  { k: "Status", v: current.status },
                  { k: "Stage", v: stageName(current.stage) },
                  { k: "On this flow", v: onFlow ? STATUS_LABEL[onFlow.status] : "—", warn: onFlow !== undefined && isOpen(onFlow.status) },
                ]}
              />
            )
          }
        >
          {all.map((c) => (
            <div key={c.key}>
              <SectionLabel num={c.code} trailing={c.rules.length}>
                {stageName(c.stage)}
              </SectionLabel>
              {c.rules.map((r) => {
                const item = reviews.get(r.id);
                return (
                  <ListRow
                    key={r.id}
                    title={r.name}
                    meta={r.decides}
                    {...(item ? { badge: STATUS_LABEL[item.status] } : r.status === "draft" ? { badge: "Draft" } : {})}
                    warn={item !== undefined && isOpen(item.status)}
                    selected={r.id === current?.id}
                    onClick={() => setPicked(r.id)}
                  />
                );
              })}
            </div>
          ))}
          {shown.length === 0 && <p className="muted pad">No rule matches.</p>}
        </Sidebar>
      }
      header={
        current
          ? { eyebrow: `${stageName(current.stage)} · decides ${current.decides}`, title: current.question ?? current.name, description: current.provenance.pitfall }
          : { eyebrow: "Methodology", title: "No rule matches" }
      }
      tabs={{ label: "Rule", items: TABS.map((t) => ({ value: t, label: t })), value: tab, onChange: (t) => setTab(t as Tab) }}
    >
      {tab === "Map" && (
        <div className="mth-canvas">
          <div className="mth-toolbar">
            <div className="mth-views" role="radiogroup" aria-label="View">
              {(["map", "tree", "flow"] as const).map((v) => (
                <button key={v} type="button" role="radio" aria-checked={view === v} onClick={() => setView(v)}>
                  {v[0]!.toUpperCase() + v.slice(1)}
                </button>
              ))}
            </div>
            {view !== "tree" && (
              <label className="mth-toggle">
                <input type="checkbox" role="switch" checked={drafts} onChange={(e) => setDrafts(e.target.checked)} /> Show drafts
              </label>
            )}
            <label className="mth-toggle" title={versionId ? "Light the selected flow's path through the tree" : "Select a flow first"}>
              <input type="checkbox" role="switch" checked={path && versionId !== undefined} disabled={!versionId} onChange={(e) => setPath(e.target.checked)} /> Pipeline path
            </label>
            <ReviewSummary versionId={versionId} items={review.data?.items} next={review.data?.next} error={review.error?.message} />
          </div>
          {view === "map" ? (
            <MethodologyCanvas rules={shown} reviews={reviews} path={path && versionId !== undefined} picked={pickedId} onPick={setPicked} />
          ) : view === "tree" ? (
            <MethodologyMap rules={shown} reviews={reviews} path={path && versionId !== undefined} picked={pickedId} onPick={setPicked} />
          ) : chapter ? (
            <>
              <Stepper all={all} at={at} reviews={reviews} onChoose={setChapterKey} />
              <FlowMap chapter={chapter} reviews={reviews} path={path && versionId !== undefined} {...ends(all, at)} picked={pickedId} onPick={setPicked} />
            </>
          ) : (
            <p className="muted pad">No rule matches.</p>
          )}
          {current && (
            <aside className="mth-card">
              <RuleDetail key={current.id} rule={current} review={onFlow} route={pickedRoute} onOpen={setTab} />
            </aside>
          )}
        </div>
      )}
      {tab === "Overview" && current && <RuleDetail rule={current} review={onFlow} route={pickedRoute} />}
      {tab === "Code" && current && <RuleCode ruleRef={current.id} />}
      {tab === "Used in" && current && <UsedIn rule={current} versionId={versionId} items={review.data?.items} />}
    </PageFrame>
  );
}

/** The steps of the selected flow this rule decides, with its status and reason on each. */
function UsedIn({ rule, versionId, items }: { rule: MethodologyRule; versionId: string | undefined; items: MethodologyReviewItem[] | undefined }) {
  if (!versionId) return <p className="muted">Select a flow to see where this rule acts on it.</p>;
  if (!items) return <Loading text="Reviewing the flow…" />;
  const mine = items.filter((i) => i.rule === rule.id);
  if (mine.length === 0) return <p className="muted">This rule decides nothing on the selected flow.</p>;
  return (
    <ul className="row-list" aria-label="Used in">
      {mine.map((i) => (
        <li key={`${i.subject_node_id ?? "flow"}-${i.decides}`} className="row-list-item">
          <span className="row-list-name">{i.subject_node_id ? `Step ${i.subject_node_id}` : "The flow"}</span>
          <span className={`row-list-meta${isOpen(i.status) ? " warn" : ""}`}>
            {STATUS_LABEL[i.status]} · {i.reason}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The stages in decision order, one chosen: each says how many decisions it holds, and for
 * the selected flow, whether the flow reaches it and how many of its decisions are open. */
function Stepper({ all, at, reviews, onChoose }: { all: Chapter[]; at: number; reviews: Map<string, MethodologyReviewItem>; onChoose: (key: string) => void }) {
  return (
    <nav className="mth-stepper" aria-label="Stages">
      {all.map((c, i) => {
        const { open, reached } = chapterState(c, reviews);
        const laneStart = c.lane !== undefined && all[i - 1]?.lane !== c.lane;
        return (
          <span key={c.key} className="mth-step-wrap">
            {laneStart && <span className="mth-step-lane">{c.lane![0]!.toUpperCase() + c.lane!.slice(1)}</span>}
            <button type="button" className={`mth-step${reached ? " reached" : ""}`} aria-current={i === at ? "step" : undefined} onClick={() => onChoose(c.key)}>
              <span className="mth-node-code">{c.code}</span> {stageName(c.stage)}
              <span className="mth-step-count">{c.rules.length}</span>
              {open > 0 && <span className="mth-step-open" title={`${open} open on this flow`} />}
            </button>
          </span>
        );
      })}
    </nav>
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

/** The picked rule: what it decides, its status on the selected flow, and its overview. On the
 * map it floats as a card with links to the full Overview and Code tabs. */
function RuleDetail({ rule, review, route, onOpen }: { rule: MethodologyRule; review: MethodologyReviewItem | undefined; route: string | undefined; onOpen?: (tab: Tab) => void }) {
  const source = useMethodologyRuleSource(rule.id);
  const python = source.data?.files.some((f) => f.language === "python");
  return (
    <section className="mth-detail" aria-label={rule.name}>
      <header className="mth-detail-head">
        <h2>{rule.name}</h2>
        <p className="muted">
          {stageName(rule.stage)} · decides <code>{rule.decides}</code>
          {activation(rule) && ` · ${activation(rule)}`} · <span className="tech">{rule.id}</span>
        </p>
        {source.data && <p className="mth-tag">{python ? "Python decide() in rule.py" : "No rule.py yet: manifest only"}</p>}
        {onOpen && (
          <div className="mth-detail-links">
            <Button size="sm" onClick={() => onOpen("Overview")}>Overview</Button>
            <Button size="sm" onClick={() => onOpen("Code")}>Code</Button>
          </div>
        )}
      </header>
      {review && (
        <section className="mth-on-flow" aria-label="On this flow">
          <h3 className="dsx-h">On this flow</h3>
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
      <Overview rule={rule} route={route} />
    </section>
  );
}

function Overview({ rule, route }: { rule: MethodologyRule; route: string | undefined }) {
  const { provenance } = rule;
  return (
    <div className="mth-overview">
      {lookedAt(rule).length > 0 && (
        <section>
          <h2 className="dsx-h">Looks at</h2>
          <p>{lookedAt(rule).join(", ")}</p>
        </section>
      )}
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
              <PickedItem key={a.id} picked={a.id === route}>
                <div className="mth-alt-head">
                  <strong>{a.label}</strong>
                  <span className="mth-tag">{a.action.operator ?? a.action.type}</span>
                </div>
                <p>{a.description}</p>
                {a.when && <p>When {withSettings(a.when, rule.policy_thresholds)}</p>}
                {routeWhen(rule, a.id) && <p className="muted">{a.when ? "Tested example" : "When"}: {routeWhen(rule, a.id)}</p>}
                <p className="muted">Why: {a.rationale}</p>
              </PickedItem>
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

/** A route in the detail, marked and brought into view when a person clicked it on the map. */
function PickedItem({ picked, children }: { picked: boolean; children: ReactNode }) {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (picked) ref.current?.scrollIntoView?.({ block: "nearest" });
  }, [picked]);
  return (
    <li ref={ref} aria-current={picked} className={picked ? "selected" : undefined}>
      {children}
    </li>
  );
}
