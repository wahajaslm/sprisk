import type { ColumnProfile, DatasetProfile, DatasetVersion, LabelProfile, LoadedTable, ProfileFinding, ProfilePlan } from "@sprisk/contracts";
import type { UseQueryResult } from "@tanstack/react-query";
import { type CSSProperties, useState } from "react";

import { useDatasetProfile, useDatasetVersionProfile, useProfilePlan, useTableShift } from "../../api/datasets.ts";
import { useQuestionVersion } from "../../api/questions.ts";
import { useOutputs, usePipelineVersions, useRunAttempts, useTablePage } from "../../api/hooks.ts";
import { latestByNode } from "../../flow/latest.ts";
import { Button } from "../../components/ui/Button.tsx";
import { Loading } from "../../components/ui/Loading.tsx";
import { BodySection } from "../../components/ui/RowList.tsx";
import { MeterRows, SolidBars } from "../../components/ui/StudioVisuals.tsx";
import { isNumeric } from "../RowsTable.tsx";
import { ColumnProfileTable, MISSING_WARN, MissingAlongRows, MissingShare, shapeOf, ValuesPerColumn } from "./ProfileSections.tsx";

/** Rows on one page of the table: one request each, never the table (ADR-0038 amendment). */
export const PREVIEW_ROWS = 50;
/** A correlation this strong or more is drawn red: two columns that say the same thing. */
const STRONG_R = 0.9;
/** Values a category's chart lists; long titles make more unreadable. */
const MAX_VALUES = 12;
/** Pairs in the strongest-pairs list, and columns in "moves most with". */
const TOP_PAIRS = 12;
const MOVES_WITH = 3;
/** A KS statistic this large means the test rows look different from the train rows. */
const SHIFT_KS = 0.2;
/** A column this strong with the label may be built from it: the design marks it "Leak?". */
const LEAK_R = 0.8;
/** A group whose label rate is this far from the overall rate is drawn red. */
const GROUP_GAP = 0.1;
/** Findings shown before "Show all": every warning, then notes up to this many in all. */
const FIRST_FINDINGS = 6;

const TOPICS: Record<ProfileFinding["topic"], string> = {
  missing: "Missing values",
  blank: "Blank text",
  duplicates: "Duplicate rows",
  identifier: "Identifier column",
  repeated_values: "Repeated values",
  constant: "Constant column",
  imbalance: "Class imbalance",
  html: "HTML in text",
  spelling: "Spelling variants",
  not_numbers: "Numbers stored as text",
  outliers: "Outliers",
  skew: "Skewed distribution",
};

/** The design's dataset Explore page (ADR-0061, ADR-0065): the rows with each column's shape
 * in its header, one column read closely, every column's gaps and outliers on one axis, how the
 * numbers move together, and what stands out. The profile is computed by Python and stored; the
 * page asks for one page of rows at a time (ADR-0038). */
export type DatasetExploreView = "Overview" | "Quality" | "Relationships" | "Modalities";

export function ExploreTab({ dataset, target, questionVersionId, view }: { dataset: LoadedTable; target?: string | undefined; questionVersionId?: string | undefined; view: DatasetExploreView }) {
  return <ProfileView profile={useDatasetProfile(dataset.artifact.id, target)} plan={useProfilePlan(dataset.artifact.id, questionVersionId)} dataset={dataset} view={view} questionVersionId={questionVersionId} />;
}

/** A registered source's Explore page (ADR-0067): its profile, read in place on its first
 * rows, every view on one page. A source is not a table sprisk holds, so it has no page of rows
 * and no split. */
export function SourceExploreTab({ source }: { source: DatasetVersion }) {
  return <ProfileView profile={useDatasetVersionProfile(source.id)} />;
}

/** The profile's views; `view` absent shows them all. */
function ProfileView({ profile, plan, dataset, view, questionVersionId }: { profile: UseQueryResult<DatasetProfile>; plan?: UseQueryResult<ProfilePlan>; dataset?: LoadedTable; view?: DatasetExploreView; questionVersionId?: string | undefined }) {
  const shows = (v: DatasetExploreView) => view === undefined || view === v;
  const [picked, setPicked] = useState<number>();
  if (profile.isError) return <p role="alert" className="error">{profile.error.message}</p>;
  if (profile.isPending) return <Loading text="Profiling the table…" />;
  const p = profile.data;
  // Until the plan arrives (or if an older server lacks it), retain the existing exploration
  // view. Once present, its explicit section ids are the authority for tabular sections.
  const applies = (id: ProfilePlan["sections"][number]["id"]) =>
    plan?.data === undefined || plan.data.sections.some((section) => section.id === id);
  const at = picked ?? firstToRead(p.columns);
  const pick = (name: string) => {
    const i = p.columns.findIndex((c) => c.name === name);
    if (i >= 0) setPicked(i);
  };
  const column = p.columns[at];
  return (
    <div className="ds-profile ds-explore">
      {shows("Overview") && plan?.data && <WhyTheseViews plan={plan.data} />}
      {shows("Overview") && sampleNote(p) && <p className="ds-overview">{sampleNote(p)}</p>}
      {shows("Overview") && dataset && applies("overview") && <LookAtRows dataset={dataset} profile={p} picked={column?.name} onPick={pick} />}
      {shows("Overview") && applies("columns") && <ColumnProfileTable profile={p} />}
      {shows("Overview") && applies("columns") && column && <ReadOneColumn profile={p} at={at} onMove={setPicked} />}

      {shows("Quality") && applies("data_quality") && <MissingShare profile={p} />}
      {shows("Quality") && applies("data_quality") && <MissingOrExtreme profile={p} picked={column?.name} onPick={pick} />}
      {shows("Quality") && applies("data_quality") && <MissingAlongRows profile={p} />}
      {shows("Quality") && applies("data_quality") && <WhatStandsOut findings={p.findings ?? []} />}

      {shows("Relationships") && applies("relationships") && (p.correlation.columns.length >= 2 || (p.label?.numbers.length ?? 0) > 0) && <RelateColumns profile={p} picked={column?.name} />}
      {shows("Relationships") && dataset && <SplitShift dataset={dataset} />}
      {shows("Relationships") && applies("target") && p.label && p.label.groups.length > 0 && <Groups label={p.label} />}

      {shows("Modalities") && <ModalitySummary profile={p} plan={plan?.data} />}
      {shows("Modalities") && questionVersionId && <AssetBindings questionVersionId={questionVersionId} />}
      {shows("Modalities") && applies("text") && <TextQuality profile={p} />}
      {shows("Modalities") && applies("categories") && <ValuesPerColumn profile={p} roles={["category", "boolean"]} title="Category distributions" />}
      {/* A whole-table profile sees held-out rows (rule 8); it is for looking only. */}
      <p className="ds-note">
        {dataset ? "Includes every row, including held-out test rows." : "Read in place from the source; nothing was copied. Includes rows a later split may hold out."} Use it to understand the data, not to choose features, transforms or models.
      </p>
    </div>
  );
}

/** What part of the table the profile read, or nothing when it read all of it. A registered
 * CSV source larger than the sample has no counted total (ADR-0067). */
export function sampleNote(p: DatasetProfile): string | undefined {
  const rows =
    p.total_rows === undefined
      ? `Profiled the first ${p.profiled_rows.toLocaleString()} rows. The total was not counted: the source has more. `
      : p.profiled_rows < p.total_rows
        ? `Profiled the first ${p.profiled_rows.toLocaleString()} of ${p.total_rows.toLocaleString()} rows. `
        : "";
  const columns = p.columns.length < p.total_columns ? `Showing the first ${p.columns.length} of ${p.total_columns} columns.` : "";
  return `${rows}${columns}`.trim() || undefined;
}

function AssetBindings({ questionVersionId }: { questionVersionId: string }) {
  const question = useQuestionVersion(questionVersionId);
  if (question.isError) return <p role="alert" className="error">{question.error.message}</p>;
  const assets = question.data?.asset_bindings ?? [];
  if (assets.length === 0) return null;
  return (
    <BodySection title="Bound assets" note="Declared in the Question Ledger. Asset files are audited only when the matching operator runs.">
      <ul className="ex-stats" aria-label="Bound assets">
        {assets.map((asset) => (
          <li key={`${asset.modality}:${asset.link_column}`}>
            <span>{asset.modality}</span>
            <span>{asset.link_column} · declared root</span>
          </li>
        ))}
      </ul>
    </BodySection>
  );
}

function ModalitySummary({ profile, plan }: { profile: DatasetProfile; plan: ProfilePlan | undefined }) {
  const active = new Set(plan?.sections.map((section) => section.id));
  const fields = [
    { id: "text", label: "Text", columns: profile.columns.filter((column) => column.role === "text") },
    { id: "categories", label: "Categories", columns: profile.columns.filter((column) => column.role === "category") },
    { id: "temporal_integrity", label: "Time", columns: profile.columns.filter((column) => column.role === "time") },
  ] as const;
  const shown = fields.filter((field) => field.columns.length > 0 && (plan === undefined || active.has(field.id)));
  if (shown.length === 0) return <p className="ds-note">No specialised modality fields are active for this dataset and question.</p>;
  return (
    <BodySection title="Detected modalities" note="Observed field roles activate specialised exploration; they do not confirm business meaning.">
      <ul className="ex-stats" aria-label="Detected modalities">
        {shown.map((field) => (
          <li key={field.id}>
            <span>{field.label}</span>
            <span>{field.columns.map((column) => column.name).join(", ")}</span>
          </li>
        ))}
      </ul>
    </BodySection>
  );
}

/** First real modality pack: every value comes from the stored tabular text profile. More
 * semantic text probes (language, PII, documents) will arrive as separate versioned facts. */
function TextQuality({ profile }: { profile: DatasetProfile }) {
  const columns = profile.columns.filter((column) => column.role === "text");
  if (columns.length === 0) return null;
  return (
    <BodySection title="Text quality" note="Blankness, markup and length are descriptive input evidence; they do not automatically clean or remove text.">
      {columns.map((column) => {
        const rows = profile.profiled_rows;
        const filled = rows === 0 ? 0 : Math.max(0, (rows - column.missing - (column.blank ?? 0)) / rows);
        const markup = column.html_share ?? 0;
        const words = column.word_counts?.bars ?? [];
        return (
          <article className="ds-column" key={column.name} aria-label={`Text quality of ${column.name}`}>
            <header className="ds-column-head">
              <h3 className="mono">{column.name}</h3>
              <span className="muted">{column.data_type}</span>
            </header>
            <MeterRows
              label={`Text quality of ${column.name}`}
              rows={[
                { name: "filled", share: filled, value: percent(filled) },
                { name: "blank", share: rows === 0 ? 0 : (column.blank ?? 0) / rows, value: `${(column.blank ?? 0).toLocaleString()} · ${percent(rows === 0 ? 0 : (column.blank ?? 0) / rows)}` },
                { name: "markup", share: markup, value: percent(markup) },
              ]}
            />
            {words.length > 0 && <SolidBars name={`Words per value in ${column.name}`} values={words.map((bar) => bar.count)} height={72} />}
          </article>
        );
      })}
    </BodySection>
  );
}

/** The plan comes from the API with the exact ledger/profile fact that selected every view. */
function WhyTheseViews({ plan }: { plan: ProfilePlan }) {
  return (
    <BodySection title="Why these views" note="Selected deterministically from the question ledger and the stored dataset profile.">
      <ol className="ex-view-plan">
        {plan.sections.map((section) => (
          <li key={section.id}>
            <strong>{section.title}</strong>
            <span>{section.reason}</span>
          </li>
        ))}
      </ol>
      {plan.limitations.map((limitation) => <p key={limitation} className="ds-note">{limitation}</p>)}
    </BodySection>
  );
}

/** The column the page opens on: a measured number, else a category, else free text. */
function firstToRead(columns: ColumnProfile[]): number {
  for (const role of ["number", "category", "boolean", "text"] as const) {
    const i = columns.findIndex((c) => c.role === role);
    if (i >= 0) return i;
  }
  return 0;
}

/** Missing cells and blank text: both are gaps a step must fill. */
const gapShare = (c: ColumnProfile, rows: number) => (rows === 0 ? 0 : (c.missing + (c.blank ?? 0)) / rows);

/** Fences only mean something for a measured number: an identifier's spread is its numbering. */
const fencesOf = (c: ColumnProfile) => (c.role === "number" ? c.fences : undefined);

const outlierCount = (c: ColumnProfile) => (c.role === "number" ? c.outliers : undefined);

const outside = (c: ColumnProfile, v: number) => {
  const f = fencesOf(c);
  return f !== undefined && (v < f.low || v > f.high);
};

/** A bin wholly outside the fences: every value in it is an outlier. */
const binOutside = (c: ColumnProfile, bar: { lower?: number; upper?: number }) => {
  const f = fencesOf(c);
  return f !== undefined && bar.lower !== undefined && bar.upper !== undefined && (bar.lower > f.high || bar.upper < f.low);
};

function LookAtRows({ dataset, profile, picked, onPick }: { dataset: LoadedTable; profile: DatasetProfile; picked: string | undefined; onPick: (name: string) => void }) {
  const [offset, setOffset] = useState(0);
  const [goTo, setGoTo] = useState("");
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const page = useTablePage(dataset.artifact.id, offset, PREVIEW_ROWS);
  const note = `All ${profile.total_columns.toLocaleString()} columns. Each header shows its distribution and how much is missing. Click a header to read that column.`;
  if (page.isError) return <BodySection title="Look at the rows" note={note}><p role="alert" className="error">The rows could not be read: {page.error.message}</p></BodySection>;
  if (page.isPending) return <BodySection title="Look at the rows" note={note}><Loading text="Reading the first rows…" /></BodySection>;
  const { total_rows: total, columns: all, rows } = page.data;
  const columns = all.map((c, at) => ({ ...c, at })).filter((c) => !hidden.has(c.name));
  const toggle = (name: string) =>
    setHidden((was) => {
      const now = new Set(was);
      if (now.has(name)) now.delete(name);
      else now.add(name);
      return now;
    });
  const last = Math.min(page.data.offset + rows.length, total);
  const jump = () => {
    const row = Number(goTo);
    if (!Number.isInteger(row) || row < 1) return;
    setOffset(Math.min(row, Math.max(1, total)) - 1);
    setGoTo("");
  };
  const of = (name: string) => profile.columns.find((c) => c.name === name);
  return (
    <BodySection title="Look at the rows" note={note}>
      <fieldset className="ds-preview-columns">
        <legend>Columns</legend>
        {all.map((c) => (
          <label key={c.name}>
            <input type="checkbox" checked={!hidden.has(c.name)} onChange={() => toggle(c.name)} />
            <span className="mono">{c.name}</span>
          </label>
        ))}
      </fieldset>
      <div className="ex-rows">
        <table aria-label={`Rows of ${dataset.name}`}>
          <thead>
            <tr>
              <th scope="col" className="ex-index">#</th>
              {columns.map((c) => {
                const p = of(c.name);
                const share = p ? gapShare(p, profile.profiled_rows) : 0;
                const shape = p ? shapeOf(p) : [];
                const bars = p?.histogram?.bars ?? [];
                return (
                  <th key={c.name} scope="col" className={`${isNumeric(c.data_type) ? "num" : ""}${c.name === picked ? " picked" : ""}`}>
                    <button type="button" onClick={() => onPick(c.name)}>
                      <span className="ex-col-name">{c.name}</span>
                      <span className="ex-col-type">{share > 0 ? `${c.data_type} · ${percent(share)} missing` : c.data_type}</span>
                      {shape.length > 1 ? (
                        <SolidBars name={`Distribution of ${c.name}`} values={shape} height={20} warn={(i) => p?.role === "number" && bars[i] !== undefined && binOutside(p, bars[i])} />
                      ) : (
                        <span className="ex-col-type ex-col-unique">{p ? `${p.distinct.toLocaleString()} unique` : ""}</span>
                      )}
                      <span className="ex-col-gap" aria-hidden="true">
                        <span style={{ width: `${share * 100}%` }} />
                      </span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={page.data.offset + r}>
                <td className="ex-index">{page.data.offset + r + 1}</td>
                {columns.map((c) => {
                  const numeric = isNumeric(c.data_type);
                  const value = row.values[c.at];
                  if (row.missing.includes(c.at)) return <td key={c.name} className={numeric ? "num missing" : "missing"}>—</td>;
                  const p = of(c.name);
                  const red = numeric && p !== undefined && outside(p, Number(value));
                  return (
                    <td key={c.name} className={`${numeric ? "num" : "ex-text"}${red ? " warn" : ""}${c.name === picked ? " picked" : ""}`} title={numeric ? undefined : String(value)}>
                      {String(value)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="ex-pager">
        <span>{`Showing rows ${(page.data.offset + 1).toLocaleString()}–${last.toLocaleString()} of ${total.toLocaleString()}. Red values fall outside the column's IQR fences; — is a missing cell.`}</span>
        <span className="ex-pager-actions">
          <Button size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PREVIEW_ROWS))}>
            Previous rows
          </Button>
          <Button size="sm" disabled={offset + PREVIEW_ROWS >= total} onClick={() => setOffset(offset + PREVIEW_ROWS)}>
            Next rows
          </Button>
          <input type="number" min={1} max={total} value={goTo} placeholder="Go to row" aria-label="Go to row" onChange={(e) => setGoTo(e.target.value)} onKeyDown={(e) => e.key === "Enter" && jump()} />
        </span>
      </div>
    </BodySection>
  );
}

function ReadOneColumn({ profile, at, onMove }: { profile: DatasetProfile; at: number; onMove: (i: number) => void }) {
  const c = profile.columns[at]!;
  const n = profile.columns.length;
  const outliers = outlierCount(c);
  return (
    <BodySection title="Read one column" note="Its distribution with the IQR fences used for clipping, and the numbers behind it.">
      <div className="ex-read">
        <div className="ex-read-head">
          <span className="ex-read-name">
            <h3>{c.name}</h3>
            <span>{c.data_type}</span>
          </span>
          <span className="ex-read-move">
            <span>{`${at + 1} of ${n}`}</span>
            <Button size="sm" disabled={at === 0} onClick={() => onMove(at - 1)}>
              Previous
            </Button>
            <Button size="sm" disabled={at === n - 1} onClick={() => onMove(at + 1)}>
              Next
            </Button>
          </span>
        </div>
        <div className="ex-read-body">
          <div className="ex-read-chart">{chartOf(c, profile.profiled_rows, profile.label)}</div>
          <ul className="ex-stats" aria-label={`Numbers of ${c.name}`}>
            {statsOf(c, profile.profiled_rows, profile.label).map(([k, v, red]) => (
              <li key={k} className={red ? "warn" : undefined}>
                <span>{k}</span>
                <span>{v}</span>
              </li>
            ))}
          </ul>
        </div>
        {outliers !== undefined && (
          <p className="ex-read-foot">{outliers === 0 ? "No value falls outside the IQR fences." : `${outliers.toLocaleString()} ${outliers === 1 ? "value falls" : "values fall"} outside the IQR fences.`}</p>
        )}
      </div>
    </BodySection>
  );
}

function chartOf(c: ColumnProfile, rows: number, label: LabelProfile | undefined) {
  const meters = (bars: { label: string; count: number }[], other?: number) => {
    const top = Math.max(...bars.map((b) => b.count), other ?? 0, 1);
    return [
      ...bars.map((b) => ({ name: b.label, share: b.count / top, value: `${b.count.toLocaleString()} · ${pct1(b.count, rows)}` })),
      ...(other ? [{ name: "Every other value", share: other / top, value: `${other.toLocaleString()} · ${pct1(other, rows)}` }] : []),
    ];
  };
  switch (c.role) {
    case "number":
      return <NumberChart c={c} label={label} />;
    case "text": {
      const words = c.word_counts?.bars ?? [];
      const repeated = (c.histogram?.bars ?? []).filter((b) => b.count > 1).slice(0, MAX_VALUES);
      return (
        <>
          {words.length > 0 && (
            <div className="sv-chart">
              <span className="sv-caption">{`Words per value · ${words[0]?.label} to ${words.at(-1)?.label}`}</span>
              <SolidBars name={`Words per value in ${c.name}`} values={words.map((b) => b.count)} height={120} />
            </div>
          )}
          {repeated.length > 0 && (
            <div className="sv-chart">
              <span className="sv-caption">{`Most repeated values · top ${repeated.length}`}</span>
              <MeterRows label={`Most repeated values of ${c.name}`} rows={meters(repeated)} />
            </div>
          )}
        </>
      );
    }
    case "category":
    case "boolean": {
      const bars = (c.histogram?.bars ?? []).slice(0, MAX_VALUES);
      const rest = (c.histogram?.bars ?? []).slice(MAX_VALUES).reduce((s, b) => s + b.count, 0) + (c.histogram?.other ?? 0);
      return bars.length > 0 ? <MeterRows label={`Most common values of ${c.name}`} rows={meters(bars, rest)} /> : null;
    }
    default:
      return <p className="muted">{c.role === "identifier" ? "An identifier names rows; its values have no distribution to show." : "Nothing to draw."}</p>;
  }
}

/** The design's column histogram: bins as solid bars, red outside the fences, each fence a
 * dashed line where it falls inside the range, and a box plot of the quartiles below. */
function NumberChart({ c, label }: { c: ColumnProfile; label: LabelProfile | undefined }) {
  const bars = c.histogram?.bars ?? [];
  const split = label?.numbers.find((n) => n.column === c.name)?.by_class;
  const tone = (k: number) => (split && split.length > 1 ? 0.72 - (0.46 * k) / (split.length - 1) : 0.72);
  const q = c.quartiles;
  const lo = bars[0]?.lower ?? q?.min;
  const hi = bars.at(-1)?.upper ?? q?.max;
  if (bars.length === 0 || lo === undefined || hi === undefined) return <p className="muted">Nothing to draw.</p>;
  const x = (v: number) => (hi === lo ? 50 : ((v - lo) / (hi - lo)) * 100);
  const top = Math.max(...bars.map((b) => b.count), 1);
  const fences = c.fences ? ([["Lower fence", c.fences.low], ["Upper fence", c.fences.high]] as const).filter(([, v]) => v > lo && v < hi) : [];
  return (
    <div className="ex-hist-wrap">
      <div className="ex-hist" role="img" aria-label={split ? `Distribution of ${c.name} by ${label?.target}` : `Distribution of ${c.name}`}>
        {bars.map((b, i) =>
          split ? (
            // One stack per bin, a segment per class, the first class at the bottom.
            <div key={i} className={`ex-stack${binOutside(c, b) ? " warn" : ""}`} style={{ height: `${(b.count / top) * 100}%` }} title={`${b.label}: ${split.map((k) => `${k.label} ${k.counts[i] ?? 0}`).join(", ")}`}>
              {split.map((k, j) => (
                <i key={k.label} style={{ flexGrow: k.counts[i] ?? 0, opacity: tone(j) / 0.72 }} />
              ))}
            </div>
          ) : (
            <div key={i} className={binOutside(c, b) ? "warn" : undefined} style={{ height: `${(b.count / top) * 100}%` }} title={`${b.label}: ${b.count.toLocaleString()}`} />
          ),
        )}
        {fences.map(([name, v]) => (
          <span key={name} className="ex-fence" style={{ left: `${x(v)}%` }}>
            <span>{`${name} ${num(v)}`}</span>
          </span>
        ))}
      </div>
      {split
        ? split.map((k, j) => k.quartiles && <BoxPlot key={k.label} name={`Box plot of ${c.name} · ${k.label}`} q={k.quartiles} x={x} tone={tone(j)} />)
        : q && <BoxPlot name={`Box plot of ${c.name}`} q={q} x={x} tone={0.72} />}
      <div className="ex-axis">
        <span>{num(lo)}</span>
        <span>{num(hi)}</span>
      </div>
      <div className="ex-legend">
        {split ? split.map((k, j) => <span key={k.label} style={{ "--tone": tone(j) } as CSSProperties}>{k.label}</span>) : <span>values</span>}
        {fencesOf(c) && <span className="warn">outside fences</span>}
      </div>
    </div>
  );
}

function BoxPlot({ name, q, x, tone }: { name: string; q: NonNullable<ColumnProfile["quartiles"]>; x: (v: number) => number; tone: number }) {
  return (
    <div className="ex-box" role="img" aria-label={name}>
      <span className="ex-box-whisker" style={{ left: `${x(q.min)}%`, width: `${x(q.max) - x(q.min)}%` }} />
      <span className="ex-box-body" style={{ left: `${x(q.q1)}%`, width: `${x(q.q3) - x(q.q1)}%`, opacity: tone / 0.72 }} />
      <span className="ex-box-median" style={{ left: `${x(q.median)}%` }} />
    </div>
  );
}

function statsOf(c: ColumnProfile, rows: number, label: LabelProfile | undefined): [string, string, boolean?][] {
  const strength = label?.numbers.find((n) => n.column === c.name);
  const filled: [string, string, boolean?][] = [
    ["Unique", c.distinct.toLocaleString()],
    ["Missing", pct1(c.missing + (c.blank ?? 0), rows), gapShare(c, rows) >= MISSING_WARN],
  ];
  const q = c.quartiles;
  // An identifier's spread is its numbering, not a quantity.
  if (c.role !== "number" || !q) {
    const first = c.histogram?.kind === "top_values" ? c.histogram.bars[0] : undefined;
    return [...filled, ...(c.blank ? [["Blank", c.blank.toLocaleString()] as [string, string]] : []), ...(first ? [["Most common", pct1(first.count, rows)] as [string, string]] : [])];
  }
  return [
    ...(c.mean !== undefined ? [["Mean", num(c.mean)] as [string, string]] : []),
    ["Median", num(q.median)],
    ...(c.std !== undefined ? [["Std", num(c.std)] as [string, string]] : []),
    ["Min", num(q.min), outside(c, q.min)],
    ["Max", num(q.max), outside(c, q.max)],
    ...filled,
    ...(c.outliers !== undefined ? [["Outliers", c.outliers.toLocaleString(), c.outliers > 0] as [string, string, boolean]] : []),
    ...(c.skewness !== undefined ? [["Skew", c.skewness.toFixed(2)] as [string, string]] : []),
    ...(strength && label ? [[label.classes.length === 2 ? "r with label" : "η with label", signed(strength.r), Math.abs(strength.r) >= LEAK_R] as [string, string, boolean]] : []),
  ];
}

/** The design's one-axis view: every column's missing share, where its gaps sit along the rows
 * and how many outliers it has, so gaps that come together line up. */
function MissingOrExtreme({ profile, picked, onPick }: { profile: DatasetProfile; picked: string | undefined; onPick: (name: string) => void }) {
  const rows = profile.profiled_rows;
  const columns = profile.columns;
  const bands = Math.max(0, ...columns.map((c) => c.missing_by_band.length));
  // As wide as the design's 26 columns at most, so a few columns do not stretch into blocks.
  const grid = { gridTemplateColumns: `repeat(${columns.length}, minmax(14px, 32px))` };
  const top = Math.max(...columns.map((c) => gapShare(c, rows)), Number.MIN_VALUE);
  const cls = (c: ColumnProfile) => (c.name === picked ? "picked" : undefined);
  return (
    <BodySection title="Check what's missing or extreme" note="Every column on one axis, so gaps that happen together line up.">
      <div className="ex-axis-scroll">
        <div className="ex-one-axis" style={{ minWidth: 96 + columns.length * 16 }}>
          <span className="ex-axis-label">Missing %</span>
          <div className="ex-missing" style={grid} role="img" aria-label="Missing share per column">
            {columns.map((c) => {
              const s = gapShare(c, rows);
              return (
                <div key={c.name} className={`${s >= MISSING_WARN ? "warn" : ""} ${cls(c) ?? ""}`}>
                  {s > 0 && <span>{Math.max(1, Math.round(s * 100))}</span>}
                  <i style={{ height: `${(s / top) * 100}%` }} />
                </div>
              );
            })}
          </div>
          <span className="ex-axis-label ex-axis-top">{`Missing cells · ${bands} bands of ${profile.band_rows.toLocaleString()} rows`}</span>
          <div className="ex-cells" role="img" aria-label="Missing cells along the rows">
            {Array.from({ length: bands }, (_, b) => (
              <div key={b} style={grid}>
                {columns.map((c) => {
                  const s = c.missing_by_band[b] ?? 0;
                  return <i key={c.name} className={s > 0 ? "gap" : cls(c)} style={s > 0 ? { opacity: 0.35 + 0.65 * s } : undefined} />;
                })}
              </div>
            ))}
          </div>
          <span className="ex-axis-label">Outliers</span>
          <ul className="ex-outliers" style={grid} aria-label="Outliers per column">
            {columns.map((c) => (
              <li key={c.name} className={cls(c)}>
                {outlierCount(c) || "·"}
              </li>
            ))}
          </ul>
          <span />
          <div className="ex-names" style={grid}>
            {columns.map((c) => (
              <button key={c.name} type="button" className={`${cls(c) ?? ""}${gapShare(c, rows) >= MISSING_WARN ? " warn" : ""}`} onClick={() => onPick(c.name)} aria-label={`Read ${c.name}`}>
                <span>{c.name}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
      <p className="ex-summary">{gapsLine(profile)}</p>
    </BodySection>
  );
}

function gapsLine(p: DatasetProfile): string {
  const rows = p.profiled_rows;
  const parts: string[] = [];
  const both = p.co_missing?.[0];
  if (both) parts.push(`${both.rows.toLocaleString()} ${both.rows === 1 ? "row misses" : "rows miss"} both ${both.column_a} and ${both.column_b}.`);
  if (p.rows_with_gap !== undefined) parts.push(p.rows_with_gap === 0 ? "No row has a gap." : `${p.rows_with_gap.toLocaleString()} of ${rows.toLocaleString()} rows have at least one gap.`);
  if (p.duplicate_rows) parts.push(`${p.duplicate_rows.toLocaleString()} ${p.duplicate_rows === 1 ? "row repeats" : "rows repeat"} an earlier row.`);
  const constant = p.columns.filter((c) => c.role === "constant").map((c) => c.name);
  parts.push(constant.length === 0 ? "No column is constant." : `${constant.join(", ")} ${constant.length === 1 ? "is" : "are"} constant.`);
  return parts.join(" ");
}

/** The design's relations view: with a label, its balance and each number's strength with it,
 * a likely leak marked; without one, the strongest pairs of numbers. Beside it the correlation
 * matrix (grey positive, red negative) and what moves most with the column being read. */
function RelateColumns({ profile, picked }: { profile: DatasetProfile; picked: string | undefined }) {
  const { columns, pairs } = profile.correlation;
  const label = profile.label && profile.label.numbers.length > 0 ? profile.label : undefined;
  return (
    <BodySection
      title={label ? "Relate columns to the label" : "Relate columns to each other"}
      note={label ? "Which columns carry signal, which leak it, and which repeat each other." : "Which measured numbers move together. Two that move as one say the same thing twice."}
    >
      <div className="sv-split">
        <div className="sv-chart">{label ? <WithLabel label={label} /> : <StrongestPairs pairs={pairs} />}</div>
        {columns.length >= 2 && (
          <div className="sv-chart">
            <Matrix columns={columns} pairs={pairs} picked={picked} />
          </div>
        )}
      </div>
    </BodySection>
  );
}

function WithLabel({ label }: { label: LabelProfile }) {
  const total = label.classes.reduce((n, c) => n + c.count, 0) + label.other;
  const shown = label.classes.slice(0, 3);
  const two = label.classes.length === 2;
  const ranked = [...label.numbers].sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
  return (
    <>
      <span className="sv-caption">
        {`Label balance · ${shown.map((c) => `${c.label} ${c.count.toLocaleString()}`).join(" · ")}${label.classes.length > 3 ? ` · ${label.classes.length - 3} more` : ""} · ${shown.map((c) => Math.round((c.count / Math.max(total, 1)) * 100)).join(" / ")}`}
      </span>
      <div className="ex-balance" role="img" aria-label="Label balance">
        {label.classes.map((c, k) => (
          <i key={c.label} style={{ flexGrow: c.count, opacity: k === 0 ? 1 : 0.36 }} title={`${c.label}: ${c.count.toLocaleString()}`} />
        ))}
      </div>
      <span className="sv-caption">{two ? "Correlation with label · point-biserial r" : "Strength with label · correlation ratio η"}</span>
      <ul className="ex-diverging" aria-label="Correlation with label">
        {ranked.map((n) => {
          const leak = Math.abs(n.r) >= LEAK_R;
          return (
            <li key={n.column} className={leak ? "warn" : undefined}>
              <span className="ex-pair">{n.column}</span>
              <span className="ex-diverging-track">
                <i style={n.r >= 0 ? { left: two ? "50%" : "0", width: `${n.r * (two ? 50 : 100)}%` } : { right: "50%", width: `${-n.r * 50}%` }} />
              </span>
              <span className="ex-r">{signed(n.r)}</span>
              <span className="ex-leak">{leak ? "Leak?" : ""}</span>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function StrongestPairs({ pairs }: { pairs: DatasetProfile["correlation"]["pairs"] }) {
  const strongest = [...pairs].sort((a, b) => Math.abs(b.pearson) - Math.abs(a.pearson)).slice(0, TOP_PAIRS);
  return (
    <>
      <span className="sv-caption">Strongest pairs · Pearson r</span>
      <ul className="ex-diverging" aria-label="Strongest pairs">
        {strongest.map((p) => (
          <li key={`${p.column_a}-${p.column_b}`} className={Math.abs(p.pearson) >= STRONG_R ? "warn" : undefined}>
            <span className="ex-pair">{`${p.column_a} · ${p.column_b}`}</span>
            <span className="ex-diverging-track">
              <i style={p.pearson >= 0 ? { left: "50%", width: `${p.pearson * 50}%` } : { right: "50%", width: `${-p.pearson * 50}%` }} />
            </span>
            <span className="ex-r">{signed(p.pearson)}</span>
            <span className="ex-leak" />
          </li>
        ))}
      </ul>
    </>
  );
}

function Matrix({ columns, pairs, picked }: { columns: string[]; pairs: DatasetProfile["correlation"]["pairs"]; picked: string | undefined }) {
  const r = new Map(pairs.flatMap((p) => [[`${p.column_a}\u0000${p.column_b}`, p.pearson], [`${p.column_b}\u0000${p.column_a}`, p.pearson]]));
  const anchor = picked !== undefined && columns.includes(picked) ? picked : columns[0]!;
  const moves = pairs
    .filter((p) => p.column_a === anchor || p.column_b === anchor)
    .map((p) => ({ name: p.column_a === anchor ? p.column_b : p.column_a, r: p.pearson }))
    .sort((a, b) => Math.abs(b.r) - Math.abs(a.r))
    .slice(0, MOVES_WITH);
  return (
    <>
      <span className="sv-caption">Between numeric columns · grey positive, red negative</span>
      <div className="ex-matrix" role="img" aria-label="Correlation matrix" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}>
        {columns.flatMap((a) =>
          columns.map((b) => {
            const v = a === b ? 1 : r.get(`${a}\u0000${b}`);
            return <i key={`${a}-${b}`} className={v !== undefined && v < 0 ? "neg" : undefined} style={{ opacity: v === undefined ? 0.15 : 0.15 + 0.85 * Math.abs(v) }} title={v === undefined ? `${a} · ${b}: too few rows` : `${a} · ${b}: ${signed(v)}`} />;
          }),
        )}
      </div>
      {moves.length > 0 && (
        <>
          <span className="sv-caption">{`Moves most with ${anchor}`}</span>
          <ul className="ex-moves" aria-label={`Moves most with ${anchor}`}>
            {moves.map((m) => (
              <li key={m.name} className={Math.abs(m.r) >= STRONG_R ? "warn" : undefined}>
                <span>{m.name}</span>
                <span>{signed(m.r)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

/** The train and test tables of the split step in the flow that loads `dataset`, once that
 * step has run. */
function useSplitTables(dataset: LoadedTable): { train: string; test: string } | undefined {
  const use = dataset.used_by[0];
  const version = usePipelineVersions().data?.find((v) => v.id === use?.pipeline_version_id);
  const split = version?.nodes.find((n) => n.operator.startsWith("sprisk.validation.") && n.operator.includes("_split@"));
  const attempts = useRunAttempts(use?.pipeline_version_id, split ? use?.run_id : undefined).data;
  const attempt = split && attempts ? latestByNode(attempts).get(split.id) : undefined;
  const outputs = useOutputs(attempt?.state === "succeeded" || attempt?.state === "cache_hit" ? attempt.id : undefined).data;
  const train = outputs?.find((o) => o.port === "train")?.artifact.id;
  const test = outputs?.find((o) => o.port === "test")?.artifact.id;
  return train && test ? { train, test } : undefined;
}

/** The design's split check: how far each numeric column's test rows sit from its train rows
 * (KS), red where they differ, and the picked column's train and test shares overlaid. */
function SplitShift({ dataset }: { dataset: LoadedTable }) {
  const tables = useSplitTables(dataset);
  const shift = useTableShift(tables?.train, tables?.test);
  const [picked, setPicked] = useState<string>();
  if (!tables) return null;
  const note = "Train and test should look alike: a column that differs between them is scored on rows unlike the ones the model learned from.";
  if (shift.isError) return <BodySection title="Check the split" note={note}><p role="alert" className="error">{shift.error.message}</p></BodySection>;
  if (shift.isPending) return <BodySection title="Check the split" note={note}><Loading text="Comparing the train and test rows…" /></BodySection>;
  const { columns, rows, other_rows } = shift.data;
  if (columns.length === 0) return <BodySection title="Check the split" note={note}><p className="muted">The split's tables share no numeric column to compare.</p></BodySection>;
  const top = Math.max(...columns.map((c) => c.ks), Number.MIN_VALUE);
  const shown = columns.find((c) => c.column === picked) ?? columns[0]!;
  const shifted = columns.filter((c) => c.ks >= SHIFT_KS);
  const share = (counts: number[]) => {
    const n = counts.reduce((a, b) => a + b, 0);
    return counts.map((c) => (n === 0 ? 0 : c / n));
  };
  const train = share(shown.counts);
  const test = share(shown.other_counts);
  const peak = Math.max(...train, ...test, Number.MIN_VALUE);
  return (
    <BodySection title="Check the split" note={note}>
      <div className="sv-split">
        <div className="sv-chart">
          <span className="sv-caption">{`Train vs test shift · KS statistic · ${rows.toLocaleString()} / ${other_rows.toLocaleString()} rows`}</span>
          <ul className="ex-shift" aria-label="Train vs test shift">
            {columns.map((c) => (
              <li key={c.column} className={`${c.ks >= SHIFT_KS ? "warn" : ""}${c.column === shown.column ? " picked" : ""}`}>
                <button type="button" onClick={() => setPicked(c.column)}>
                  <span className="ex-pair">{c.column}</span>
                  <span className="ex-shift-track">
                    <i style={{ width: `${(c.ks / top) * 100}%` }} />
                  </span>
                  <span className="ex-r">{c.ks.toFixed(2)}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="ex-summary">
            {shifted.length === 0
              ? `No column is shifted: every KS stays under ${SHIFT_KS}.`
              : `${shifted.map((c) => c.column).join(", ")} ${shifted.length === 1 ? "is" : "are"} shifted in the test rows (KS ${shifted.map((c) => c.ks.toFixed(2)).join(", ")}). Every other column stays under ${SHIFT_KS}.`}
          </p>
        </div>
        <div className="sv-chart">
          <span className="sv-caption">{`${shown.column} · train vs test, normalised · KS ${shown.ks.toFixed(2)}`}</span>
          <div className="ex-overlay" role="img" aria-label={`${shown.column} · train vs test`}>
            {train.map((t, i) => (
              <div key={i}>
                <i style={{ height: `${(t / peak) * 100}%` }} />
                <b style={{ height: `${((test[i] ?? 0) / peak) * 100}%` }} />
              </div>
            ))}
          </div>
          <div className="ex-axis">
            <span>{num(shown.lower)}</span>
            <span>{num(shown.upper)}</span>
          </div>
          <div className="ex-legend ex-legend-split">
            <span>train</span>
            <span className="hollow">test</span>
          </div>
        </div>
      </div>
    </BodySection>
  );
}

/** The design's group check: the first class's share in each value of a category, the overall
 * rate a dashed line, a value far from it red. The label rate should not depend on how the
 * data was collected. */
function Groups({ label }: { label: LabelProfile }) {
  const first = label.classes[0]!;
  const total = label.classes.reduce((n, c) => n + c.count, 0) + label.other;
  const overall = first.count / Math.max(total, 1);
  return (
    <BodySection title="Check groups" note="The label rate should not depend on how the data was collected.">
      <span className="sv-caption">{`${first.label} share by group · dashed line at the overall ${Math.round(overall * 100)}%`}</span>
      <div className="ex-groups">
        <span className="ex-overall" style={{ bottom: `calc(${overall * 100 * 0.9}% * 110 / 100 + 22px)` }} />
        {label.groups.map((g) => (
          <div key={g.column} className="ex-group" style={{ flexGrow: g.values.length }}>
            <ul aria-label={`${first.label} share by ${g.column}`}>
              {g.values.map((v) => (
                <li key={v.label} className={Math.abs(v.share - overall) >= GROUP_GAP ? "warn" : undefined} title={`${v.label}: ${Math.round(v.share * 100)}% of ${v.rows.toLocaleString()} rows`}>
                  <span>{Math.round(v.share * 100)}</span>
                  <i style={{ height: `${v.share * 90}%` }} />
                  <b>{v.label}</b>
                </li>
              ))}
            </ul>
            <span className="ex-group-name">{g.column}</span>
          </div>
        ))}
      </div>
    </BodySection>
  );
}

/** The design's decision rows: what stands out, the evidence, and the column it is about. */
function WhatStandsOut({ findings }: { findings: ProfileFinding[] }) {
  const [all, setAll] = useState(false);
  const warnings = findings.filter((f) => f.level === "warning").length;
  const shown = all ? findings : findings.slice(0, Math.max(warnings, FIRST_FINDINGS));
  return (
    <BodySection title="What stands out" note="Warnings first. Each is counted from the rows; none is a decision. The Investigation tab turns them into decisions.">
      {findings.length === 0 ? (
        <p className="muted">Nothing stands out in these rows.</p>
      ) : (
        <ul className="ex-findings" aria-label="What stands out">
          {shown.map((f) => (
            <li key={`${f.topic}:${f.column ?? ""}`} className={f.level === "warning" ? "warn" : undefined}>
              <span className="ex-finding-title">{TOPICS[f.topic]}</span>
              <span className="ex-finding-text">
                {f.text}
                {f.example !== undefined && (
                  <span className="ds-example">
                    Example: <q className="mono">{f.example}</q>
                  </span>
                )}
              </span>
              <span className="ex-finding-column">{f.column ?? "whole table"}</span>
            </li>
          ))}
        </ul>
      )}
      {shown.length < findings.length && (
        <Button size="sm" onClick={() => setAll(true)}>
          {`Show all ${findings.length} findings`}
        </Button>
      )}
    </BodySection>
  );
}

const signed = (r: number) => `${r >= 0 ? "+" : "−"}${Math.abs(r).toFixed(2)}`;

const num = (n: number) => (Number.isInteger(n) ? n.toLocaleString() : Number(n.toPrecision(4)).toLocaleString());

const pct1 = (n: number, rows: number) => (rows === 0 ? "—" : n / rows < 0.001 && n > 0 ? "<0.1%" : `${((n / rows) * 100).toFixed(1)}%`);

const percent = (share: number) => (share > 0 && share < 0.01 ? "<1%" : `${Math.round(share * 100)}%`);
