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
type Option = Omit<(typeof pack.options)[number], "settings" | "columns" | "plots"> & {
  settings: Record<string, Setting>;
  columns: Record<string, string>;
  plots: Plot[];
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

function PlotView({ plot, missing, atDefaults, small = false }: { plot: Plot; missing: string[]; atDefaults: boolean; small?: boolean }) {
  if (missing.length > 0) return <p className="split-example-plot-note">No plot: {missing.join(", ")} is not bound.</p>;
  if (plot.final_only) return <p className="split-example-plot-note">Reads the target, so it is shown with the final score.</p>;
  if (plot.figure === null) return null;
  return (
    <>
      {!small && !atDefaults && <p className="split-example-plot-note">Drawn at the default settings. It is drawn again with yours when the step runs.</p>}
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

  const auto = byId(pack.auto.option);
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
                  <div><dt>Operator</dt><dd className="split-example-selected">{selected.label}</dd></div>
                  {Object.entries(selected.columns).map(([name, column]) => (
                    <div key={name}><dt>{name}</dt><dd>{BINDINGS[column] ?? "not bound"}</dd></div>
                  ))}
                </dl>
                <p className="split-example-reason">
                  {override ? `Auto would pick ${auto.label}: ${pack.auto.reason}` : pack.auto.reason}
                </p>
                <ul className="split-example-promises" aria-label="Promises">
                  {selected.promises.map((promise) => <li key={promise}>{promise}</li>)}
                </ul>
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
                    {option.label.replace(" split", "")}
                  </button>
                ))}
              </div>
              {missing.length > 0 && (
                <p className="split-example-warning" role="alert">
                  {selected.label} needs {missing.join(", ")}, which this project has not bound. It cannot run.
                </p>
              )}
              <h3>{selected.label} settings</h3>
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
            {custom && <p className="split-example-note">Custom code. The promises are still checked on this cell's train and test.</p>}
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
