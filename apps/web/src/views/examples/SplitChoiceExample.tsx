import { useState } from "react";

import { CodeInput } from "../CodeInput.tsx";
import { KindIcon } from "../Icons.tsx";
import { PageHeader } from "../../components/ui/PageHeader.tsx";

type Choice = "auto" | "temporal" | "group" | "random";
type OperatorChoice = Exclude<Choice, "auto">;

type GroupSettings = { groupColumn: string; testFraction: number; seed: number };
type RandomSettings = { testFraction: number; seed: number };
type TemporalSettings = { timeColumn: string; testFraction: number };

const CHOICES: { id: Choice; label: string }[] = [
  { id: "auto", label: "Auto" },
  { id: "temporal", label: "Temporal" },
  { id: "group", label: "Group" },
  { id: "random", label: "Random" },
];

const LABEL: Record<OperatorChoice, string> = {
  temporal: "Temporal split",
  group: "Group split",
  random: "Random split",
};

export const SPLIT_NODE_SOURCE = `from typing import Literal

import polars as pl
from sprisk import method, operator


SplitChoice = Literal["auto", "temporal", "group", "random"]


@operator(
    id="random_split",
    inputs=["data"],
    outputs=["train", "test"],
    tunables={
        "test_fraction": {"minimum": 0.05, "maximum": 0.40, "step": 0.05},
        "seed": {"minimum": 0, "maximum": 10000},
    },
)
def random_split(
    data: pl.DataFrame,
    test_fraction: float = 0.20,
    seed: int = 42,
):
    rows = data.with_row_index("_sprisk_row")
    test = rows.sample(fraction=test_fraction, seed=seed, shuffle=True)
    train = rows.filter(~pl.col("_sprisk_row").is_in(test["_sprisk_row"]))
    return train.drop("_sprisk_row"), test.drop("_sprisk_row")


@operator(
    id="group_split",
    inputs=["data"],
    outputs=["train", "test"],
    tunables={
        "test_fraction": {"minimum": 0.05, "maximum": 0.40, "step": 0.05},
        "seed": {"minimum": 0, "maximum": 10000},
    },
)
def group_split(
    data: pl.DataFrame,
    group_column: str,
    test_fraction: float = 0.20,
    seed: int = 42,
):
    test_groups = (
        data.select(group_column)
        .unique()
        .sample(fraction=test_fraction, seed=seed, shuffle=True)
        .get_column(group_column)
    )
    train = data.filter(~pl.col(group_column).is_in(test_groups))
    test = data.filter(pl.col(group_column).is_in(test_groups))
    return train, test


@operator(
    id="temporal_split",
    inputs=["data"],
    outputs=["train", "test"],
    tunables={
        "test_fraction": {"minimum": 0.05, "maximum": 0.40, "step": 0.05},
    },
)
def temporal_split(
    data: pl.DataFrame,
    time_column: str,
    test_fraction: float = 0.20,
):
    ordered = data.sort(time_column)
    cut = int(ordered.height * (1.0 - test_fraction))
    return ordered.head(cut), ordered.tail(ordered.height - cut)


@method(
    id="split",
    needs={
        "evidence": {
            "time_column": "data.structure.time_column",
            "group_column": "data.structure.group_column",
        },
    },
    options={
        "temporal": temporal_split,
        "group": group_split,
        "random": random_split,
    },
)
def split(
    data: pl.DataFrame,
    choice: SplitChoice = "auto",
    time_column: str | None = None,
    group_column: str | None = None,
    test_fraction: float = 0.20,
    seed: int = 42,
):
    if choice != "auto":
        return method.choose(choice, reason=f"User manually selected {choice}.")
    if time_column is not None:
        return method.choose(
            "temporal",
            reason=f"Use {time_column} so future observations cannot train the model.",
        )
    if group_column is not None:
        return method.choose(
            "group",
            reason=f"Keep every {group_column} value entirely inside train or test.",
        )
    return method.choose("random", reason="No temporal or entity boundary was found.")
`;

function functionSource(source: string, name: string): string {
  const start = source.indexOf(`def ${name}(`);
  if (start < 0) return `# ${name} is missing from the node source`;
  const ends = [source.indexOf("\n\n@operator(", start), source.indexOf("\n\n@method(", start)].filter((end) => end > start);
  const end = ends.length > 0 ? Math.min(...ends) : source.length;
  return source.slice(start, end).trim();
}

function notebookCode(
  source: string,
  override: Choice,
  selected: OperatorChoice,
  reason: string,
  group: GroupSettings,
  random: RandomSettings,
  temporal: TemporalSettings,
): string {
  const implementation = functionSource(source, `${selected}_split`);
  const parameters =
    selected === "group"
      ? `split_parameters = {\n    "group_column": ${JSON.stringify(group.groupColumn)},\n    "test_fraction": ${group.testFraction},\n    "seed": ${group.seed},\n}`
      : selected === "temporal"
        ? `split_parameters = {\n    "time_column": ${JSON.stringify(temporal.timeColumn)},\n    "test_fraction": ${temporal.testFraction},\n}`
        : `split_parameters = {\n    "test_fraction": ${random.testFraction},\n    "seed": ${random.seed},\n}`;
  return `# Resolved from the Split choice node.
# Decision: ${selected}
# Reason: ${reason}
split_choice = ${JSON.stringify(override)}
${parameters}

import polars as pl


${implementation}


train, test = ${selected}_split(data, **split_parameters)
`;
}

function readChoice(source: string): Choice | undefined {
  const found = source.match(/split_choice\s*=\s*["'](auto|temporal|group|random)["']/);
  return found?.[1] as Choice | undefined;
}

function readStringArgument(source: string, name: string): string | undefined {
  const block = source.match(/split_parameters\s*=\s*\{([\s\S]*?)\}/)?.[1] ?? "";
  const found = block.match(new RegExp(`["']${name}["']\\s*:\\s*["']([^"']+)["']`))
    ?? source.match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`));
  return found?.[1];
}

function readNumberArgument(source: string, name: string): number | undefined {
  const block = source.match(/split_parameters\s*=\s*\{([\s\S]*?)\}/)?.[1] ?? "";
  const found = block.match(new RegExp(`["']${name}["']\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`))
    ?? source.match(new RegExp(`${name}\\s*=\\s*(-?\\d+(?:\\.\\d+)?)`));
  if (!found) return undefined;
  const value = Number(found[1]);
  return Number.isFinite(value) ? value : undefined;
}

function notebookFunction(source: string, name: string): string | undefined {
  const start = source.search(new RegExp(`^def ${name}\\(`, "m"));
  if (start < 0) return undefined;
  const lines = source.slice(start).split("\n");
  let signatureComplete = false;
  let endLine = lines.length;
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!signatureComplete) {
      if (line.trimEnd().endsWith(":") && !line.startsWith("    ")) signatureComplete = true;
      continue;
    }
    if (line.trim() !== "" && !line.startsWith(" ") && !line.startsWith("\t")) {
      endLine = index;
      break;
    }
  }
  return lines.slice(0, endLine).join("\n").trimEnd();
}

function replaceNodeFunction(nodeSource: string, notebookSource: string, name: string): string {
  const replacement = notebookFunction(notebookSource, name);
  if (!replacement) return nodeSource;
  const start = nodeSource.indexOf(`def ${name}(`);
  if (start < 0) return nodeSource;
  const ends = [nodeSource.indexOf("\n\n@operator(", start), nodeSource.indexOf("\n\n@method(", start)]
    .filter((end) => end > start);
  const end = ends.length > 0 ? Math.min(...ends) : nodeSource.length;
  return `${nodeSource.slice(0, start)}${replacement}${nodeSource.slice(end)}`;
}

function exportedNotebook(code: string, selected: OperatorChoice, override: Choice): string {
  return JSON.stringify({
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {
      kernelspec: { display_name: "Python 3", language: "python", name: "python3" },
      language_info: { name: "python", version: "3.12" },
      sprisk: {
        exploration: "customer-safe-split",
        node: "validation_split",
        method: "split",
        operator: `${selected}_split`,
        choice: override,
      },
    },
    cells: [
      {
        cell_type: "markdown",
        metadata: {},
        source: [
          "# Customer-safe split\n",
          "Exported from the Split choice node. This notebook contains plain Python and does not require Sprisk.\n",
        ],
      },
      {
        cell_type: "code",
        execution_count: null,
        metadata: {
          sprisk: {
            node: "validation_split",
            method: "split",
            operator: `${selected}_split`,
          },
        },
        outputs: [],
        source: code.split(/(?<=\n)/),
      },
    ],
  }, null, 2);
}

/** A vertical example of the proposed composite method/operator node. It is deliberately
 * local UI state: the production graph remains governed by its current wire contracts. */
export function SplitChoiceExample() {
  const [tab, setTab] = useState<"preview" | "source">("preview");
  const [override, setOverride] = useState<Choice>("auto");
  const [nodeSource, setNodeSource] = useState(SPLIT_NODE_SOURCE);
  const [group, setGroup] = useState<GroupSettings>({ groupColumn: "customer_id", testFraction: 0.2, seed: 42 });
  const [random, setRandom] = useState<RandomSettings>({ testFraction: 0.2, seed: 42 });
  const [temporal, setTemporal] = useState<TemporalSettings>({ timeColumn: "created_at", testFraction: 0.2 });
  const recommended: OperatorChoice = "group";
  const selected: OperatorChoice = override === "auto" ? recommended : override;
  const reason =
    override !== "auto"
      ? `User manually selected ${override}.`
      : `Evidence identifies ${group.groupColumn} as the entity boundary, so each customer stays on one side.`;
  const materialized = notebookCode(nodeSource, override, selected, reason, group, random, temporal);
  const [notebook, setNotebook] = useState(materialized);
  const [notebookDirty, setNotebookDirty] = useState(false);
  const [syncMessage, setSyncMessage] = useState("Live sync ready");
  const editorCode = notebookDirty ? notebook : materialized;
  const notebookDownload = `data:application/x-ipynb+json;charset=utf-8,${encodeURIComponent(exportedNotebook(editorCode, selected, override))}`;

  const syncNotebook = (source: string) => {
    setNotebook(source);
    setNotebookDirty(true);
    const choice = readChoice(source);
    if (choice && choice !== override) {
      setOverride(choice);
      setSyncMessage(`Synced choice: ${choice}`);
      // A new choice resolves to a different operator, so show that implementation.
      setNotebookDirty(false);
    }
    const operator = (["temporal", "group", "random"] as const)
      .find((candidate) => source.includes(`def ${candidate}_split(`));
    const testFraction = readNumberArgument(source, "test_fraction");
    const seed = readNumberArgument(source, "seed");
    if (operator === "group") {
      setGroup((current) => ({
        groupColumn: readStringArgument(source, "group_column") ?? current.groupColumn,
        testFraction: testFraction ?? current.testFraction,
        seed: seed ?? current.seed,
      }));
      setSyncMessage("Synced Group parameters");
    } else if (operator === "random") {
      setRandom((current) => ({
        testFraction: testFraction ?? current.testFraction,
        seed: seed ?? current.seed,
      }));
      setSyncMessage("Synced Random parameters");
    } else if (operator === "temporal") {
      setTemporal((current) => ({
        timeColumn: readStringArgument(source, "time_column") ?? current.timeColumn,
        testFraction: testFraction ?? current.testFraction,
      }));
      setSyncMessage("Synced Temporal parameters");
    }
    if (operator) setNodeSource((current) => replaceNodeFunction(current, source, `${operator}_split`));
  };

  return (
    <section className="split-example-page" aria-label="Composite split example">
      <PageHeader
        eyebrow="Interactive design example · one method and three operators"
        title="Split choice node"
        description="Evidence recommends an operator. Override the choice or tune its settings and the resolved notebook changes immediately."
      />
      <div className="split-example-tabs" role="tablist" aria-label="Example views">
        <button type="button" role="tab" aria-selected={tab === "preview"} onClick={() => setTab("preview")}>Flow and notebook</button>
        <button type="button" role="tab" aria-selected={tab === "source"} onClick={() => setTab("source")}>Node code</button>
      </div>

      {tab === "source" ? (
        <div className="split-example-source">
          <div className="split-example-panel-head">
            <div>
              <h2>Editable composite source</h2>
              <p>The method, options, tunables and implementations live in this one node-owned file.</p>
            </div>
            <a className="page-btn" href="/examples/composite-split/split.py" download>Download split.py</a>
          </div>
          <CodeInput
            value={nodeSource}
            label="Decorated node source"
            onChange={(source) => { setNodeSource(source); setNotebookDirty(false); }}
            onRun={(source) => { setNodeSource(source); setNotebookDirty(false); }}
          />
        </div>
      ) : (
        <div className="split-example-workspace">
          <section className="split-example-flow" aria-label="Flow preview">
            <div className="split-example-panel-head">
              <div>
                <h2>Flow</h2>
                <p>One composite node resolves its method to one operator.</p>
              </div>
              <a className="page-btn" href="/examples/composite-split/exploration.yaml" download>Exploration YAML</a>
            </div>

            <div className="split-example-canvas">
              <div className="split-example-edge" aria-hidden="true" />
              <div className="split-example-data-node">Customer data</div>
              <article className="split-example-node" aria-label="Split choice node">
                <header>
                  <span className="split-example-node-icon"><KindIcon kind="decision" /></span>
                  <div>
                    <h2>Split</h2>
                    <p>Method + selected operator</p>
                  </div>
                </header>
                <dl>
                  <div><dt>Mode</dt><dd>{override === "auto" ? "Automatic" : "Override"}</dd></div>
                  <div><dt>Selected operator</dt><dd className="split-example-selected">{LABEL[selected]}</dd></div>
                  <div><dt>Evidence</dt><dd>entity column · {group.groupColumn}</dd></div>
                </dl>
                <p className="split-example-reason">{reason}</p>
                <footer><span>train</span><span>test</span></footer>
              </article>
            </div>

            <section className="split-example-controls" aria-label="Split choices and parameters">
              <h3>Choice</h3>
              <div className="split-example-choice-row">
                {CHOICES.map((choice) => (
                  <button key={choice.id} type="button" className={override === choice.id ? "active" : ""} onClick={() => { setOverride(choice.id); setNotebookDirty(false); }}>
                    {choice.label}
                  </button>
                ))}
              </div>
              <p className="split-example-help">Auto recommends Group from the current evidence. Any other value is an explicit exploration override.</p>
              <h3>{LABEL[selected]} parameters</h3>
              <div className="split-example-fields">
                {selected === "group" && (
                  <label>Group column<input aria-label="Group column" value={group.groupColumn} onChange={(event) => { setGroup({ ...group, groupColumn: event.target.value }); setNotebookDirty(false); }} /></label>
                )}
                {selected === "temporal" && (
                  <label>Time column<input aria-label="Time column" value={temporal.timeColumn} onChange={(event) => { setTemporal({ ...temporal, timeColumn: event.target.value }); setNotebookDirty(false); }} /></label>
                )}
                <label>
                  Test fraction
                  <input
                    aria-label="Test fraction"
                    type="number"
                    min="0.05"
                    max="0.4"
                    step="0.05"
                    value={selected === "group" ? group.testFraction : selected === "random" ? random.testFraction : temporal.testFraction}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      if (selected === "group") setGroup({ ...group, testFraction: value });
                      else if (selected === "random") setRandom({ ...random, testFraction: value });
                      else setTemporal({ ...temporal, testFraction: value });
                      setNotebookDirty(false);
                    }}
                  />
                  <span>Tunable · 0.05–0.40</span>
                </label>
                {selected !== "temporal" && (
                  <label>
                    Seed
                    <input
                      aria-label="Seed"
                      type="number"
                      min="0"
                      max="10000"
                      value={selected === "group" ? group.seed : random.seed}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        if (selected === "group") setGroup({ ...group, seed: value });
                        else setRandom({ ...random, seed: value });
                        setNotebookDirty(false);
                      }}
                    />
                    <span>Tunable · 0–10,000</span>
                  </label>
                )}
              </div>
            </section>
          </section>

          <section className="split-example-notebook" aria-label="Notebook preview">
            <div className="split-example-panel-head">
              <div>
                <h2>Resolved notebook</h2>
                <p>Edit <code>split_parameters</code> or <code>split_choice</code>; the flow controls update immediately.</p>
              </div>
              <div className="split-example-actions">
                <a className="page-btn" href={notebookDownload} download="customer-safe-split.ipynb">Export .ipynb</a>
                <span className="split-example-live" aria-live="polite">{syncMessage}</span>
              </div>
            </div>
            <div className="split-example-cell">
              <span className="split-example-count">[ ]</span>
              <CodeInput value={editorCode} label="Resolved notebook code" onChange={syncNotebook} onRun={syncNotebook} />
            </div>
            <aside>
              <strong>Round-trip metadata</strong>
              <span>node validation_split · method split · operator {selected}_split · exploration customer-safe-split</span>
            </aside>
          </section>
        </div>
      )}
    </section>
  );
}
