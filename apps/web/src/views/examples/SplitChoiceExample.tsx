import { lazy, Suspense, useState } from "react";

import { CodeInput } from "../CodeInput.tsx";
import { KindIcon } from "../Icons.tsx";
import { PageHeader } from "../../components/ui/PageHeader.tsx";
import { Loading } from "../../components/ui/Loading.tsx";
// Written by spikes/decorator-split/generate.py from the decorated pack. Python ran the method,
// the splits and their plots; the browser only shows the results (rule 9).
import pack from "./decorator-split.json";

const PlotlyFigure = lazy(() => import("../PlotlyFigure.tsx"));

type Setting = { type: string; minimum?: number; maximum?: number; "x-sprisk-step"?: number; default?: number };
type Plot = (typeof pack.options)[number]["plots"][number] & { figure: string | null };
type Verification = { promise: string; text: string; status: string; detail: string; evidence: Record<string, unknown> };
type Option = Omit<(typeof pack.options)[number], "settings" | "columns" | "plots" | "verifications"> & {
  settings: Record<string, Setting>;
  columns: Record<string, string>;
  plots: Plot[];
  verifications: Verification[];
};
type Values = Record<string, number>;

const OPTIONS = pack.options as Option[];
const BINDINGS: Record<string, string> = pack.bindings;

function byId(id: string): Option {
  const option = OPTIONS.find((candidate) => candidate.id === id);
  if (!option) throw new Error(`The pack has no split option ${id}`);
  return option;
}

function defaults(option: Option): Values {
  return Object.fromEntries(Object.entries(option.settings).map(([name, setting]) => [name, setting.default ?? 0]));
}

function boundArgs(option: Option, names: string[]): string[] {
  return names
    .filter((name) => option.columns[name] !== undefined && option.columns[name]! in BINDINGS)
    .map((name) => `${name}=${JSON.stringify(BINDINGS[option.columns[name]!])}`);
}

function splitCall(option: Option, values: Values): string {
  const settings = Object.entries(values).map(([name, value]) => `${name}=${value}`);
  const args = ["data", ...boundArgs(option, Object.keys(option.columns)), ...settings].join(", ");
  return `train, test = ${option.operator}(${args})\n`;
}

function plotCall(option: Option, plot: Plot): string {
  return `figure = ${plot.name}(${["train", "test", ...boundArgs(option, plot.params)].join(", ")})\n`;
}

/** Settings a person typed into the call line, kept only when they are in range. */
function readSettings(code: string, option: Option): Values {
  const call = code.slice(code.lastIndexOf(`${option.operator}(`));
  const found: Values = {};
  for (const [name, setting] of Object.entries(option.settings)) {
    const match = call.match(new RegExp(`\\b${name}\\s*=\\s*(-?\\d+(?:\\.\\d+)?)`));
    const value = match ? Number(match[1]) : Number.NaN;
    if (Number.isFinite(value) && value >= (setting.minimum ?? -Infinity) && value <= (setting.maximum ?? Infinity)) {
      found[name] = value;
    }
  }
  return found;
}

function exportedNotebook(cells: string[]): string {
  const code = (source: string) => ({ cell_type: "code", execution_count: null, metadata: {}, outputs: [], source: source.split(/(?<=\n)/) });
  return JSON.stringify({
    nbformat: 4,
    nbformat_minor: 5,
    metadata: { kernelspec: { display_name: "Python 3", language: "python", name: "python3" } },
    cells: [
      { cell_type: "markdown", metadata: {}, source: [`# ${pack.method.name}\n`, `${pack.method.question}\n`] },
      ...cells.map(code),
    ],
  }, null, 2);
}

const MARK: Record<string, string> = { pass: "✓", fail: "✗", inconclusive: "?" };

/** Evidence a person can read: counts and values, not empty example lists. */
function evidenceText(evidence: Record<string, unknown>): string {
  return Object.entries(evidence)
    .filter(([, value]) => !Array.isArray(value) || value.length > 0)
    .map(([name, value]) => `${name.replaceAll("_", " ")} ${Array.isArray(value) ? value.join(", ") : String(value)}`)
    .join(" · ");
}

function PlotView({ plot, missing, atDefaults, small = false }: { plot: Plot; missing: string[]; atDefaults: boolean; small?: boolean }) {
  if (missing.length > 0) return <p className="split-example-plot-note">No plot: {missing.join(", ")} is not bound.</p>;
  if (plot.final_only) return <p className="split-example-plot-note">Reads the target, so it is shown with the final score.</p>;
  if (plot.figure === null) return null;
  return (
    <>
      {!small && !atDefaults && <p className="split-example-plot-note">Drawn at the default settings, not yours.</p>}
      <Suspense fallback={<Loading text="Loading plot…" pad />}>
        <PlotlyFigure json={plot.figure} label={plot.title} small={small} />
      </Suspense>
    </>
  );
}

/** The split method written with decorators (spikes/decorator-split), shown on one node. */
export function SplitChoiceExample() {
  const [tab, setTab] = useState<"preview" | "source">("preview");
  const [override, setOverride] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, Values>>(() =>
    Object.fromEntries(OPTIONS.map((option) => [option.id, defaults(option)])));
  const [edited, setEdited] = useState<string | null>(null);
  const [file, setFile] = useState(pack.files[0]!.path);

  const decision = pack.decision;
  const auto = byId(decision.option);
  const selected = override ? byId(override) : auto;
  const current = values[selected.id]!;
  const code = edited ?? `${selected.definition}\n\n${splitCall(selected, current)}`;
  const custom = edited !== null && !edited.startsWith(selected.definition);
  const missing = selected.unbound;
  const atDefaults = Object.entries(defaults(selected)).every(([name, value]) => current[name] === value);
  const plotCells = selected.plots.map((plot) => `${plot.definition}\n\n${plotCall(selected, plot)}`);
  const shown = pack.files.find((candidate) => candidate.path === file)!;

  const pick = (id: string | null) => {
    setOverride(id);
    setEdited(null);
  };
  const setValue = (name: string, value: number) => {
    setValues({ ...values, [selected.id]: { ...current, [name]: value } });
    setEdited(null);
  };
  const editCell = (text: string) => {
    setEdited(text);
    setValues({ ...values, [selected.id]: { ...current, ...readSettings(text, selected) } });
  };

  return (
    <section className="split-example-page" aria-label="Composite split example">
      <PageHeader
        eyebrow="Design example · method and operators written with decorators"
        title="Split choice node"
        description="The method picks an operator from the project's columns. Override it or change a setting, and the notebook follows."
      />
      <div className="split-example-tabs" role="tablist" aria-label="Example views">
        <button type="button" role="tab" aria-selected={tab === "preview"} onClick={() => setTab("preview")}>Flow and notebook</button>
        <button type="button" role="tab" aria-selected={tab === "source"} onClick={() => setTab("source")}>Files</button>
      </div>

      {tab === "source" ? (
        <div className="split-example-files">
          <nav aria-label="Files">
            {pack.files.map((candidate) => (
              <button key={candidate.path} type="button" aria-pressed={candidate.path === file} onClick={() => setFile(candidate.path)}>
                {candidate.path}
              </button>
            ))}
          </nav>
          <CodeInput key={shown.path} value={shown.text} label={`${shown.path} source`} readOnly onChange={() => undefined} onRun={() => undefined} />
        </div>
      ) : (
        <div className="split-example-workspace">
          <section className="split-example-flow" aria-label="Flow preview">
            <div className="split-example-panel-head">
              <div>
                <h2>Flow</h2>
                <p>{pack.method.activity}: {pack.method.question}</p>
              </div>
            </div>

            <div className="split-example-canvas">
              <div className="split-example-data-node">Products</div>
              <span className="split-example-link" aria-hidden="true" />
              <article className="split-example-node" aria-label="Split node">
                <header>
                  <span className="split-example-node-icon"><KindIcon kind="decision" /></span>
                  <div>
                    <h2>Split</h2>
                    <p>{override ? "Chosen by you" : "Chosen by the method"}</p>
                  </div>
                </header>
                <dl>
                  <div><dt>Decision</dt><dd className="split-example-decision">{selected.label}</dd></div>
                  <div>
                    <dt>Why</dt>
                    <dd>
                      {override ? `Chosen by you. The method would pick: ${auto.label}.` : decision.reason}
                      {Object.entries(selected.columns).map(([name, column]) => (
                        <span key={name} className="split-example-binding">{column} → {BINDINGS[column] ?? "not bound"}</span>
                      ))}
                    </dd>
                  </div>
                  <div><dt>Implementation</dt><dd className="split-example-selected">{selected.implementation}</dd></div>
                </dl>
                <ul className="split-example-promises" aria-label="Verification">
                  {selected.verifications.length > 0
                    ? selected.verifications.map((check) => (
                      <li key={check.promise} data-status={check.status}>
                        <span>{MARK[check.status]} {check.text}</span>
                        <small>{evidenceText(check.evidence)}</small>
                      </li>
                    ))
                    : selected.promises.map((promise) => <li key={promise}><span>· {promise}</span><small>Not checked: the split cannot run.</small></li>)}
                  {selected.verifications.length > 0 && !atDefaults && <li><small>Checked at the default settings.</small></li>}
                </ul>
                {!override && (
                  <p className="split-example-record">
                    Decided from {Object.entries(decision.inputs).filter(([, value]) => value !== null).map(([name, value]) => `${name}=${String(value)}`).join(", ")} · code {decision.code}
                  </p>
                )}
                {selected.plots.map((plot) => (
                  <figure key={plot.name} className="split-example-node-plot" aria-label={`${plot.title} on the node`}>
                    <figcaption>{plot.title}</figcaption>
                    <PlotView plot={plot} missing={missing} atDefaults={atDefaults} small />
                  </figure>
                ))}
                <footer><span>train</span><span>test</span></footer>
              </article>
            </div>

            <section className="split-example-controls" aria-label="Split choices and settings">
              <h3>Choice</h3>
              <div className="split-example-choice-row">
                <button type="button" className={override === null ? "active" : ""} onClick={() => pick(null)}>Auto</button>
                {OPTIONS.map((option) => (
                  <button key={option.id} type="button" className={override === option.id ? "active" : ""} onClick={() => pick(option.id)}>
                    {option.implementation.replace(" split", "")}
                  </button>
                ))}
              </div>
              {missing.length > 0 && (
                <p className="split-example-warning" role="alert">
                  {selected.implementation} needs {missing.join(", ")}, which this project has not bound. It cannot run.
                </p>
              )}
              <h3>{selected.implementation} settings</h3>
              <div className="split-example-fields">
                {Object.entries(selected.settings).map(([name, setting]) => (
                  <label key={name}>
                    {name}
                    <input
                      aria-label={name}
                      type="number"
                      min={setting.minimum}
                      max={setting.maximum}
                      step={setting["x-sprisk-step"] ?? 1}
                      value={current[name]}
                      onChange={(event) => setValue(name, Number(event.target.value))}
                    />
                    <span>{setting.minimum}–{setting.maximum}</span>
                  </label>
                ))}
              </div>
            </section>
          </section>

          <section className="split-example-notebook" aria-label="Notebook preview">
            <div className="split-example-panel-head">
              <div>
                <h2>Notebook</h2>
                <p>Plain Python from the operator's file. Edit a setting in the call line and the node follows.</p>
              </div>
              <a
                className="page-btn"
                href={`data:application/x-ipynb+json;charset=utf-8,${encodeURIComponent(exportedNotebook([code, ...plotCells]))}`}
                download="split.ipynb"
              >
                Export .ipynb
              </a>
            </div>
            <div className="split-example-cell">
              <span className="split-example-count">[1]</span>
              <CodeInput key={selected.id} value={code} label="Split cell" onChange={editCell} onRun={editCell} />
            </div>
            {custom && <p className="split-example-note">Custom code. This example does not run or check it.</p>}
            {selected.plots.map((plot, index) => (
              <div key={plot.name}>
                <div className="split-example-cell">
                  <span className="split-example-count">[{index + 2}]</span>
                  <CodeInput key={selected.id} value={plotCells[index]!} label={`${plot.title} cell`} readOnly onChange={() => undefined} onRun={() => undefined} />
                </div>
                <div className="split-example-output">
                  <PlotView plot={plot} missing={missing} atDefaults={atDefaults} />
                </div>
              </div>
            ))}
          </section>
        </div>
      )}
    </section>
  );
}
