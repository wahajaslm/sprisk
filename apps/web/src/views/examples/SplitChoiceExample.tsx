import { lazy, Suspense, useState } from "react";

import { CodeInput } from "../CodeInput.tsx";
import { KindIcon } from "../Icons.tsx";
import { PageHeader } from "../../components/ui/PageHeader.tsx";
import { Loading } from "../../components/ui/Loading.tsx";
// Written by spikes/decorator-split/generate.py from the decorated pack. Python ran the method
// and the chart step; the browser only shows the results (rule 9).
import pack from "./decorator-split.json";

const PlotlyFigure = lazy(() => import("../PlotlyFigure.tsx"));

type Setting = { type: string; minimum?: number; maximum?: number; "x-sprisk-step"?: number; default?: number };
type Option = Omit<(typeof pack.options)[number], "settings" | "concepts"> & {
  settings: Record<string, Setting>;
  concepts: Record<string, string>;
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

/** The concepts this option needs that the project has not bound to a column. */
function unbound(option: Option): string[] {
  return Object.values(option.concepts).filter((concept) => !(concept in BINDINGS));
}

function callLine(option: Option, values: Values): string {
  const columns = Object.entries(option.concepts)
    .filter(([, concept]) => concept in BINDINGS)
    .map(([name, concept]) => `${name}=${JSON.stringify(BINDINGS[concept])}`);
  const settings = Object.entries(values).map(([name, value]) => `${name}=${value}`);
  const args = ["data", ...columns, ...settings].join(", ");
  const picked = option.outputs.map((output) => `step["${output}"]`).join(", ");
  return `step = ${option.operator}(${args})\n${option.outputs.join(", ")} = ${picked}\n`;
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

function exportedNotebook(splitCode: string, option: Option): string {
  const cell = (source: string, operator: string) => ({
    cell_type: "code",
    execution_count: null,
    metadata: { sprisk: { method: "split_method", operator } },
    outputs: [],
    source: source.split(/(?<=\n)/),
  });
  return JSON.stringify({
    nbformat: 4,
    nbformat_minor: 5,
    metadata: { kernelspec: { display_name: "Python 3", language: "python", name: "python3" } },
    cells: [
      { cell_type: "markdown", metadata: {}, source: [`# ${pack.method.name}\n`, `${pack.method.question}\n`] },
      cell(splitCode, option.operator),
      cell(pack.chart_cell, "split_chart"),
    ],
  }, null, 2);
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
  const code = edited ?? `${selected.definition}\n\n${callLine(selected, current)}`;
  const custom = edited !== null && !edited.startsWith(selected.definition);
  const missing = unbound(selected);
  const atDefaults = Object.entries(defaults(selected)).every(([name, value]) => current[name] === value);
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
        description="The method picks an operator from the project's bindings. Override it or change a setting, and the notebook follows."
      />
      <div className="split-example-tabs" role="tablist" aria-label="Example views">
        <button type="button" role="tab" aria-selected={tab === "preview"} onClick={() => setTab("preview")}>Flow and notebook</button>
        <button type="button" role="tab" aria-selected={tab === "source"} onClick={() => setTab("source")}>Pack files</button>
      </div>

      {tab === "source" ? (
        <div className="split-example-files">
          <nav aria-label="Pack files">
            {(["written", "generated"] as const).map((kind) => (
              <div key={kind}>
                <h3>{kind === "written" ? "Written by a person" : "Generated · Rust reads these"}</h3>
                {pack.files.filter((candidate) => candidate.kind === kind).map((candidate) => (
                  <button key={candidate.path} type="button" aria-pressed={candidate.path === file} onClick={() => setFile(candidate.path)}>
                    {candidate.path}
                  </button>
                ))}
              </div>
            ))}
          </nav>
          <CodeInput
            key={shown.path}
            value={shown.text}
            label={`${shown.path} source`}
            language={shown.path.endsWith(".yaml") ? "yaml" : "python"}
            readOnly
            onChange={() => undefined}
            onRun={() => undefined}
          />
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
                  {Object.entries(selected.concepts).map(([name, concept]) => (
                    <div key={name}><dt>{name}</dt><dd>{BINDINGS[concept] ?? "not bound"}</dd></div>
                  ))}
                </dl>
                <p className="split-example-reason">
                  {override ? `Auto would pick ${auto.label}: ${pack.auto.reason}` : pack.auto.reason}
                </p>
                <ul className="split-example-promises" aria-label="Promises">
                  {selected.promises.map((promise) => <li key={promise}>{promise}</li>)}
                </ul>
                <footer><span>train</span><span>test</span></footer>
              </article>
              <span className="split-example-link" aria-hidden="true" />
              <div className="split-example-data-node">Split chart</div>
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
                <p>Plain Python, made from the operator functions. Edit a setting in the call line and the node follows.</p>
              </div>
              <a
                className="page-btn"
                href={`data:application/x-ipynb+json;charset=utf-8,${encodeURIComponent(exportedNotebook(code, selected))}`}
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
            <div className="split-example-cell">
              <span className="split-example-count">[2]</span>
              <CodeInput value={pack.chart_cell} label="Chart cell" readOnly onChange={() => undefined} onRun={() => undefined} />
            </div>
            <div className="split-example-output">
              {selected.chart === null ? (
                <p>No chart: the split cannot run until {missing.join(", ")} is bound.</p>
              ) : (
                <>
                  {!atDefaults && <p>Drawn at the default settings. It is drawn again with yours when the step runs.</p>}
                  <Suspense fallback={<Loading text="Loading chart…" pad />}>
                    <PlotlyFigure json={selected.chart} label="Rows in train and test" />
                  </Suspense>
                </>
              )}
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
