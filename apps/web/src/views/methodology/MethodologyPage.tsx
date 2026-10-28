import type { FlowDecisions, MethodologyRule } from "@sprisk/contracts";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { useMethodologyRules, useMethodologyRuleSource, useMethods } from "../../api/methodology.ts";
import { useFlowDecisions } from "../../api/walks.ts";
import { useOperators } from "../../api/hooks.ts";
import { Button } from "../../components/ui/Button.tsx";
import { InfoDock } from "../../components/ui/InfoDock.tsx";
import { ListRow } from "../../components/ui/ListRow.tsx";
import { Loading } from "../../components/ui/Loading.tsx";
import { PageFrame } from "../../components/ui/PageFrame.tsx";
import { SearchField } from "../../components/ui/SearchField.tsx";
import { SideGroup } from "../../components/ui/SideGroup.tsx";
import { BodySection, RowItem, RowList } from "../../components/ui/RowList.tsx";
import { Sidebar } from "../../components/ui/Sidebar.tsx";
import { CodeInput } from "../CodeInput.tsx";
import { useSelection } from "../../workbench/selection.ts";
import { type Chapter, chapterReached, chapters, ends } from "./flowGraph.ts";
import { DataFlowMap } from "./DataFlowMap.tsx";
import { DecisionOrderMap } from "./DecisionOrderMap.tsx";
import { FlowMap } from "./FlowMap.tsx";
import { MethodologyCanvas } from "./MethodologyCanvas.tsx";
import { MethodologyMap } from "./MethodologyMap.tsx";
import { RuleTree } from "./RuleTree.tsx";
import { DECIDED, decidedOnFlow, lookedAt, type OnFlow, routeWhen, stageName, withSettings } from "./ruleTree.ts";

const ignore = () => undefined;

const TABS = ["Map", "Decision order", "Data flow", "Overview", "Code", "Used in"] as const;
/** Map is the design's rule tree; Canvas, Tree and Flow are the ADR-0059 views of the same rules. */
const VIEWS = ["map", "canvas", "tree", "flow"] as const;
type View = (typeof VIEWS)[number];
type Tab = (typeof TABS)[number];

/** The methodology map (ADR-0059) in the Flow Studio frame: the rules by stage beside it, and
 * the picked rule's map, overview, code and the steps it decides on the selected pipeline. */
export function MethodologyPage() {
  const rules = useMethodologyRules();
  const versionId = useSelection((s) => s.pipelineVersionId);
  const flowDecisions = useFlowDecisions(versionId);
  const decided = useMemo(() => decidedOnFlow(flowDecisions.data?.decisions ?? []), [flowDecisions.data]);
  const [filter, setFilter] = useState("");
  const [path, setPath] = useState(false);
  const [picked, setPicked] = useState<string>();
  const [view, setView] = useState<View>("map");
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
  const onFlow = current && decided.get(current.id);
  const pickedId = current?.id === pickedRule ? picked : current?.id;

  return (
    <PageFrame
      label="Methodology"
      flush={tab === "Map" || tab === "Decision order" || tab === "Data flow"}
      sidebar={
        <Sidebar
          title="Rules"
          search={<SearchField value={filter} onChange={setFilter} placeholder="Filter rules" ariaLabel="Filter rules" />}
          dock={
            current && (
              <InfoDock
                rows={[
                  { k: "Status", v: current.status },
                  { k: "Stage", v: stageName(current.stage) },
                  { k: "On this pipeline", v: onFlow ? DECIDED : "—" },
                ]}
              />
            )
          }
        >
          {all.map((c) => (
            <SideGroup key={c.key} label={stageName(c.stage)} meta={c.rules.length}>
              {c.rules.map((r) => {
                return (
                  <ListRow
                    key={r.id}
                    title={r.name}
                    meta={r.decides}
                    {...(decided.has(r.id) ? { badge: DECIDED } : r.status === "draft" ? { badge: "Draft" } : {})}
                    selected={r.id === current?.id}
                    onClick={() => setPicked(r.id)}
                  />
                );
              })}
            </SideGroup>
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
          {view === "map" ? (
            <RuleTree chapters={all} picked={current?.id} onPick={setPicked} />
          ) : view === "canvas" ? (
            <MethodologyCanvas rules={shown} decided={decided} path={path && versionId !== undefined} picked={pickedId} onPick={setPicked} />
          ) : view === "tree" ? (
            <MethodologyMap rules={shown} decided={decided} path={path && versionId !== undefined} picked={pickedId} onPick={setPicked} />
          ) : chapter ? (
            <>
              <Stepper all={all} at={at} decided={decided} onChoose={setChapterKey} />
              <FlowMap chapter={chapter} decided={decided} path={path && versionId !== undefined} {...ends(all, at)} picked={pickedId} onPick={setPicked} />
            </>
          ) : (
            <p className="muted pad">No rule matches.</p>
          )}
          {current && (
            <aside className="mth-card">
              <RuleCard key={current.id} rule={current} decided={onFlow} route={pickedRoute} onOpen={setTab} />
            </aside>
          )}
          <div className="mth-bar">
            <div className="mth-views" role="radiogroup" aria-label="View">
              {VIEWS.map((v) => (
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
            <label className="mth-toggle" title={versionId ? "Light the selected pipeline's path through the tree" : "Select a pipeline first"}>
              <input type="checkbox" role="switch" checked={path && versionId !== undefined} disabled={!versionId} onChange={(e) => setPath(e.target.checked)} /> Pipeline path
            </label>
            <FlowSummary versionId={versionId} flow={flowDecisions.data} error={flowDecisions.error ?? undefined} />
          </div>
        </div>
      )}
      {tab === "Decision order" && <MethodsTab view={DecisionOrderMap} picked={current?.id} onPick={setPicked} />}
      {tab === "Data flow" && <MethodsTab view={DataFlowMap} picked={current?.id} onPick={setPicked} />}
      {tab === "Overview" && current && <RuleDetail rule={current} decided={onFlow} route={pickedRoute} />}
      {tab === "Code" && current && <RuleCode ruleRef={current.id} />}
      {tab === "Used in" && current && <UsedIn rule={current} versionId={versionId} flow={flowDecisions.data} />}
    </PageFrame>
  );
}

type MethodsView = typeof DecisionOrderMap;

/** The methods drawn by `view`: in the order the engine decides them, or as what they do to the data. */
function MethodsTab({ view: View, picked, onPick }: { view: MethodsView; picked: string | undefined; onPick: (id: string) => void }) {
  const methods = useMethods();
  const operators = useOperators();
  // The page's pick when it is a method, so the sidebar and the canvas show the same one;
  // else the last method picked here.
  const [mine, setMine] = useState<string>();
  const shown = methods.data?.some((m) => m.id === picked) ? picked : mine;
  if (methods.isError) return <p role="alert" className="error pad">{methods.error.message}</p>;
  if (operators.isError) return <p role="alert" className="error pad">{operators.error.message}</p>;
  if (methods.isPending || operators.isPending) return <Loading text="Loading the methods…" />;
  return (
    <div className="mth-canvas">
      <View
        methods={methods.data}
        operators={operators.data}
        picked={shown}
        onPick={(id) => {
          setMine(id);
          onPick(id);
        }}
      />
    </div>
  );
}

/** What the selected flow's walk decided by this method: its option, why, and the steps it shaped. */
function UsedIn({ rule, versionId, flow }: { rule: MethodologyRule; versionId: string | undefined; flow: FlowDecisions | undefined }) {
  if (!versionId) return <p className="muted">Select a pipeline to see where this method acts on it.</p>;
  if (!flow) return <Loading text="Reading the pipeline's decisions…" />;
  const mine = flow.decisions.find((d) => d.method === rule.id);
  if (!mine) return <p className="muted">This method decided nothing on the selected pipeline.</p>;
  return (
    <BodySection title="On the selected pipeline" note="What this method chose, and each step it shaped.">
      <RowList label="Used in">
        <RowItem key="option" name={mine.label} meta={mine.reason} />
        {mine.steps.map((step) => (
          <RowItem key={step} name={`Step ${step}`} meta={mine.label} />
        ))}
      </RowList>
    </BodySection>
  );
}

/** The stages in decision order, one chosen: each says how many decisions it holds, and for
 * the selected flow, whether the flow reaches it. */
function Stepper({ all, at, decided, onChoose }: { all: Chapter[]; at: number; decided: Map<string, OnFlow>; onChoose: (key: string) => void }) {
  return (
    <nav className="mth-stepper" aria-label="Stages">
      {all.map((c, i) => {
        const reached = chapterReached(c, decided);
        const laneStart = c.lane !== undefined && all[i - 1]?.lane !== c.lane;
        return (
          <span key={c.key} className="mth-step-wrap">
            {laneStart && <span className="mth-step-lane">{c.lane![0]!.toUpperCase() + c.lane!.slice(1)}</span>}
            <button type="button" className={`mth-step${reached ? " reached" : ""}`} aria-current={i === at ? "step" : undefined} onClick={() => onChoose(c.key)}>
              <span className="mth-node-code">{c.code}</span> {stageName(c.stage)}
              <span className="mth-step-count">{c.rules.length}</span>
            </button>
          </span>
        );
      })}
    </nav>
  );
}

/** What the selected flow's walk decided: how many decisions, or that no walk made it. */
function FlowSummary({ versionId, flow, error }: { versionId: string | undefined; flow: FlowDecisions | undefined; error: Error | undefined }) {
  if (!versionId) return <span className="muted">Select a pipeline to see what was decided on it.</span>;
  if (error) return <span role="alert" className="error">{error.message}</span>;
  if (!flow) return <Loading text="Reading the pipeline's decisions…" />;
  const count = flow.decisions.length;
  return (
    <span className="mth-summary" aria-label="Pipeline decisions">
      {flow.walk_id === undefined ? "No walk made this pipeline." : count === 1 ? "1 decision on this pipeline." : `${count} decisions on this pipeline.`}
    </span>
  );
}

/** The design's rule card over the map: what the rule chose on this flow, its alternatives with
 * the rule's pick marked, and the way into its overview and code. */
function RuleCard({ rule, decided, route, onOpen }: { rule: MethodologyRule; decided: OnFlow | undefined; route: string | undefined; onOpen: (tab: Tab) => void }) {
  const chosen = rule.alternatives.find((a) => a.id === decided?.option);
  return (
    <section className="mth-detail compact" aria-label={rule.name}>
      <header className="mth-detail-head">
        <span className="mth-eyebrow">
          {stageName(rule.stage)} · {rule.decides}
        </span>
        <h2>{rule.name}</h2>
        {rule.question && <p>{rule.question}</p>}
      </header>
      <div className="mth-chosen">
        <span>Chosen on this pipeline</span>
        <strong>{chosen ? chosen.label : "Not decided on this pipeline"}</strong>
      </div>
      {decided && (
        <section className="mth-on-flow" aria-label="On this pipeline">
          <h3 className="dsx-h">On this pipeline</h3>
          <p>{decided.reason}</p>
        </section>
      )}
      {rule.alternatives.length > 0 && (
        <section>
          <h3 className="dsx-h">Alternatives</h3>
          <ol className="mth-alts compact">
            {rule.alternatives.map((a) => (
              <PickedItem key={a.id} picked={a.id === route}>
                <span className={`mth-radio${a.id === chosen?.id ? " on" : ""}`} aria-hidden="true" />
                <span>
                  <strong>{a.label}</strong>
                  {a.id === chosen?.id && <span className="mth-pick">Rule's pick</span>}
                </span>
              </PickedItem>
            ))}
          </ol>
        </section>
      )}
      <div className="mth-card-foot">
        <Button variant="primary" onClick={() => onOpen("Overview")}>
          Open rule
        </Button>
        <Button onClick={() => onOpen("Code")}>Code</Button>
      </div>
    </section>
  );
}

/** The picked rule in full: what it decides, its status on the selected flow, and its overview. */
function RuleDetail({ rule, decided, route }: { rule: MethodologyRule; decided: OnFlow | undefined; route: string | undefined }) {
  const source = useMethodologyRuleSource(rule.id);
  const python = source.data?.files.some((f) => f.language === "python");
  return (
    <section className="mth-detail" aria-label={rule.name}>
      <header className="mth-detail-head">
        <h2>{rule.name}</h2>
        <p className="muted">
          {stageName(rule.stage)} · decides <code>{rule.decides}</code>
          {" "}· <span className="tech">{rule.id}</span>
        </p>
        {source.data && <p className="mth-tag">{python ? "Python decide() in rule.py" : "No rule.py yet: manifest only"}</p>}
      </header>
      {decided && (
        <section className="mth-on-flow" aria-label="On this pipeline">
          <h3 className="dsx-h">On this pipeline</h3>
          <p>
            <span className="mth-chip settled">{DECIDED}</span>
            {decided.step && (
              <>
                {" "}
                step <code>{decided.step}</code>
              </>
            )}
          </p>
          <p>{decided.reason}</p>
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
