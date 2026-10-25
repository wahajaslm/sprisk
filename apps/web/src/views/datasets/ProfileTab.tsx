import type { ColumnProfile, ColumnRole, DatasetProfile, LoadedTable, ProfileFinding } from "@sprisk/contracts";
import { type ReactNode, useState } from "react";

import { useDatasetProfile } from "../../api/datasets.ts";
import { Button } from "../../components/ui/Button.tsx";
import { Loading } from "../../components/ui/Loading.tsx";
import { BodySection } from "../../components/ui/RowList.tsx";
import { MeterRows, SolidBars } from "../../components/ui/StudioVisuals.tsx";
import { Cells } from "../charts/StudioCharts.tsx";

/** A column this empty or more is a warning (the design's missing threshold). */
export const MISSING_WARN = 0.2;
/** Numeric columns a correlation field needs before it is drawn. */
const MIN_CORRELATED = 3;
/** Values a column's chart lists; long titles make more unreadable. */
const MAX_VALUES = 12;
/** A correlation this strong or more is drawn red: two columns that say the same thing. */
const STRONG_R = 0.9;
/** Findings shown before "Show all": every warning, then notes up to this many in all. */
const FIRST_FINDINGS = 6;

/** Each role in words, in the order the page lists them. */
const ROLES: Record<ColumnRole, { one: string; many: string }> = {
  text: { one: "free text", many: "free text" },
  category: { one: "category", many: "categories" },
  number: { one: "number", many: "numbers" },
  time: { one: "date or time", many: "dates or times" },
  boolean: { one: "yes/no", many: "yes/no" },
  identifier: { one: "identifier", many: "identifiers" },
  constant: { one: "constant", many: "constants" },
  empty: { one: "empty", many: "empty" },
};

/** What the table holds, as the design's dataset page shows it (ADR-0061, ADR-0065): the
 * missing share per column, one profile row per column, what stands out, each column's values,
 * and where values are missing along the rows. One surface, split by hairlines. Computed by
 * Python and stored; a profile request sends no rows (ADR-0038). */
export function ProfileTab({ dataset }: { dataset: LoadedTable }) {
  const profile = useDatasetProfile(dataset.artifact.id);
  if (profile.isError) return <p role="alert" className="error">{profile.error.message}</p>;
  if (profile.isPending) return <Loading text="Profiling the table…" />;
  const p = profile.data;
  const findings = p.findings ?? [];
  return (
    <div className="ds-profile">
      {(p.profiled_rows < p.total_rows || p.columns.length < p.total_columns) && (
        <p className="ds-overview">
          {p.profiled_rows < p.total_rows && `Profiled the first ${p.profiled_rows.toLocaleString()} of ${p.total_rows.toLocaleString()} rows. `}
          {p.columns.length < p.total_columns && `Showing the first ${p.columns.length} of ${p.total_columns} columns.`}
        </p>
      )}
      <MissingShare profile={p} />
      <BodySection title="Column profile" note={rolesLine(p)}>
        <ProfileTable profile={p} />
      </BodySection>
      <BodySection title="Findings" note="What stands out, warnings first. Each is counted from the rows; none is a decision.">
        {findings.length === 0 ? <p className="muted">Nothing stands out in these rows.</p> : <Findings findings={findings} />}
      </BodySection>
      <BodySection title="Values per column" note="Each column's distribution, by what its values suggest it holds. Identifiers have none to show.">
        {p.columns.map((c) => (
          <ColumnValues key={c.name} column={c} rows={p.profiled_rows} findings={findings.filter((f) => f.column === c.name)} />
        ))}
      </BodySection>
      <MissingAlongRows profile={p} />
      {p.correlation.columns.length >= MIN_CORRELATED && <Correlation profile={p} />}
      {/* A whole-table profile sees held-out rows (rule 8); it is for looking only. */}
      <p className="ds-note">Includes every row, including held-out test rows. Use it to understand the data, not to choose features, transforms or models.</p>
    </div>
  );
}

const share = (c: ColumnProfile, rows: number) => (rows === 0 ? 0 : (c.missing + (c.blank ?? 0)) / rows);

/** The design's missing chart: one bar per column, emptiest first, red at or above the
 * threshold, the threshold a dashed line. Blank text counts: it is a gap a step must fill. */
function MissingShare({ profile }: { profile: DatasetProfile }) {
  const rows = profile.profiled_rows;
  const sorted = [...profile.columns].sort((a, b) => share(b, rows) - share(a, rows));
  const gappy = sorted.filter((c) => share(c, rows) > 0);
  const over = gappy.filter((c) => share(c, rows) >= MISSING_WARN).length;
  return (
    <BodySection title="Missing values" note={over > 0 ? `${over} ${over === 1 ? "column" : "columns"} at or above ${percent(MISSING_WARN)} empty · missing cells and blank text` : "Missing cells and blank text, per column"}>
      <span className="sv-caption">Missing share per column</span>
      <SolidBars name="Missing share per column" values={sorted.map((c) => share(c, rows))} warn={(i) => share(sorted[i]!, rows) >= MISSING_WARN} />
      {gappy.length === 0 ? (
        <p className="muted">Every column is filled in every row.</p>
      ) : (
        <MeterRows label="Missing per column" rows={gappy.map((c) => ({ name: c.name, share: share(c, rows) / Math.max(share(gappy[0]!, rows), Number.MIN_VALUE), value: pct1(c.missing + (c.blank ?? 0), rows), warn: share(c, rows) >= MISSING_WARN }))} />
      )}
    </BodySection>
  );
}

/** The design's column profile table: one hairline row per column. */
function ProfileTable({ profile }: { profile: DatasetProfile }) {
  const rows = profile.profiled_rows;
  return (
    <table className="exp-table ds-columns" aria-label="Column profile">
      <thead>
        <tr>
          <th scope="col">Column</th>
          <th scope="col">Role</th>
          <th scope="col">Type</th>
          <th scope="col">Missing</th>
          <th scope="col" className="num">Unique</th>
          <th scope="col" className="num">Median</th>
          <th scope="col">Distribution</th>
        </tr>
      </thead>
      <tbody>
        {profile.columns.map((c) => {
          const gap = share(c, rows);
          const warn = gap >= MISSING_WARN;
          const shape = shapeOf(c);
          return (
            <tr key={c.name} className={warn ? "warn" : undefined}>
              <td className="mono">{c.name}</td>
              <td className="muted">{ROLES[c.role ?? "category"].one}</td>
              <td className="mono muted">{c.data_type}</td>
              <td>
                <span className="ds-missing">
                  <span className="ds-missing-bar" aria-hidden="true">
                    <span className={warn ? "warn" : undefined} style={{ width: `${gap * 100}%` }} />
                  </span>
                  <span className="mono">{percent(gap)}</span>
                </span>
              </td>
              <td className="num mono">{c.distinct.toLocaleString()}</td>
              <td className="num mono">{c.quartiles && c.role !== "identifier" ? num(c.quartiles.median) : "—"}</td>
              <td className="ds-spark">{shape.length > 1 ? <SolidBars name={`Distribution of ${c.name}`} values={shape} height={22} /> : <span className="muted">—</span>}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** The counts a column's sparkline and chart draw: a number's bins, a category's most common
 * values, a text column's words per value. An identifier has none worth drawing. */
export function shapeOf(c: ColumnProfile): number[] {
  if (c.role === "identifier" || c.role === "constant" || c.role === "empty") return [];
  if (c.role === "text") return (c.word_counts?.bars ?? []).map((b) => b.count);
  return (c.histogram?.bars ?? []).map((b) => b.count);
}

function Findings({ findings }: { findings: ProfileFinding[] }) {
  const [all, setAll] = useState(false);
  const warnings = findings.filter((f) => f.level === "warning").length;
  const shown = all ? findings : findings.slice(0, Math.max(warnings, FIRST_FINDINGS));
  return (
    <>
      <FindingList findings={shown} />
      {shown.length < findings.length && (
        <Button size="sm" onClick={() => setAll(true)}>
          {`Show all ${findings.length} findings`}
        </Button>
      )}
    </>
  );
}

function FindingList({ findings }: { findings: ProfileFinding[] }) {
  return (
    <ul className="ds-findings" aria-label="Findings">
      {findings.map((f) => (
        <li key={`${f.topic}:${f.column ?? ""}`} className={f.level === "warning" ? "warn" : undefined}>
          <span className="ds-finding-level">{f.level === "warning" ? "Warning" : "Note"}</span>
          <span>
            {f.text}
            {f.example !== undefined && (
              <span className="ds-example">
                Example: <q className="mono">{f.example}</q>
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** One column's values, beside what it is: a category's most common values as rows, a text
 * column's words per value and its repeated values, a number's spread. */
function ColumnValues({ column, rows, findings }: { column: ColumnProfile; rows: number; findings: ProfileFinding[] }) {
  const role = column.role ?? "category";
  return (
    <article className="ds-column" aria-label={column.name}>
      <header className="ds-column-head">
        <h3 className="mono">{column.name}</h3>
        <span className="muted">{`${ROLES[role].one} · ${column.data_type}`}</span>
      </header>
      <dl className="ds-column-facts">
        {factsOf(column, rows).map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd className="mono">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="ds-column-charts">{chartsOf(column, rows)}</div>
      {findings.length > 0 && <FindingList findings={findings} />}
    </article>
  );
}

function chartsOf(column: ColumnProfile, rows: number) {
  const meters = (bars: { label: string; count: number }[], other?: number) => {
    const top = Math.max(...bars.map((b) => b.count), other ?? 0, 1);
    return [
      ...bars.map((b) => ({ name: b.label, share: b.count / top, value: `${b.count.toLocaleString()} · ${pct1(b.count, rows)}` })),
      ...(other ? [{ name: "Every other value", share: other / top, value: `${other.toLocaleString()} · ${pct1(other, rows)}` }] : []),
    ];
  };
  const block = (caption: string, body: ReactNode) => (
    <div className="sv-chart" key={caption}>
      <span className="sv-caption">{caption}</span>
      {body}
    </div>
  );
  switch (column.role) {
    case "text": {
      const repeated = (column.histogram?.bars ?? []).filter((b) => b.count > 1).slice(0, MAX_VALUES);
      const words = column.word_counts?.bars ?? [];
      return (
        <>
          {words.length > 0 && block(`Words per value · ${words[0]?.label} to ${words.at(-1)?.label}`, <SolidBars name={`Words per value in ${column.name}`} values={words.map((b) => b.count)} height={96} />)}
          {repeated.length > 0 && block(`Most repeated values · top ${repeated.length}`, <MeterRows label={`Most repeated values of ${column.name}`} rows={meters(repeated)} />)}
        </>
      );
    }
    case "category":
    case "boolean": {
      const bars = (column.histogram?.bars ?? []).slice(0, MAX_VALUES);
      const rest = (column.histogram?.bars ?? []).slice(MAX_VALUES).reduce((n, b) => n + b.count, 0) + (column.histogram?.other ?? 0);
      return bars.length > 0 ? block(`Most common values · ${column.distinct.toLocaleString()} distinct`, <MeterRows label={`Most common values of ${column.name}`} rows={meters(bars, rest)} />) : null;
    }
    case "number": {
      const bars = column.histogram?.bars ?? [];
      return bars.length > 0 ? block(`Distribution · ${bars[0]?.label.split("–")[0]} to ${bars.at(-1)?.label.split("–").at(-1)}`, <SolidBars name={`Distribution of ${column.name}`} values={bars.map((b) => b.count)} height={96} />) : null;
    }
    default:
      return <p className="muted">{column.role === "identifier" ? "An identifier names rows; its values have no distribution to show." : "Nothing to draw."}</p>;
  }
}

function factsOf(column: ColumnProfile, rows: number): [string, string][] {
  const facts: [string, string][] = [
    ["filled", rows === 0 ? "—" : percent((rows - column.missing - (column.blank ?? 0)) / rows)],
    ["distinct", column.distinct.toLocaleString()],
  ];
  if (column.blank) facts.push(["blank", column.blank.toLocaleString()]);
  const q = column.quartiles;
  // An identifier's spread is its numbering, not a quantity.
  if (q && column.role !== "identifier") facts.push(["min", num(q.min)], ["median", num(q.median)], ["middle half", `${num(q.q1)} – ${num(q.q3)}`], ["max", num(q.max)]);
  if (column.html_share) facts.push(["with HTML", percent(column.html_share)]);
  return facts;
}

/** Where values are missing along the rows, one row per column with a gap: a pattern (gaps
 * that start at one row) shows here, not in a count. */
function MissingAlongRows({ profile }: { profile: DatasetProfile }) {
  const gappy = profile.columns.filter((c) => c.missing > 0);
  if (gappy.length === 0) return null;
  const bands = gappy[0]?.missing_by_band.length ?? 0;
  return (
    <BodySection title="Missing along the rows" note={`Share missing in each of ${bands} bands of ${profile.band_rows.toLocaleString()} rows, in row order: gaps that sit together show as a block.`}>
      {gappy.map((c) => (
        <div className="sv-chart" key={c.name}>
          <span className="sv-caption">{c.name}</span>
          <SolidBars name={`Where ${c.name} is missing`} values={c.missing_by_band} warn={(i) => (c.missing_by_band[i] ?? 0) >= MISSING_WARN} height={40} />
        </div>
      ))}
    </BodySection>
  );
}

/** The design's correlation matrix: |r| as light, red where two columns move together. */
function Correlation({ profile }: { profile: DatasetProfile }) {
  const { columns, pairs } = profile.correlation;
  const r = new Map(pairs.flatMap((p) => [[`${p.column_a}\u0000${p.column_b}`, p.pearson], [`${p.column_b}\u0000${p.column_a}`, p.pearson]]));
  const at = (i: number, j: number) => (i === j ? 1 : (r.get(`${columns[i]}\u0000${columns[j]}`) ?? null));
  return (
    <BodySection title="Correlation" note="Which measured numbers move together. Two that move as one say the same thing twice.">
      <span className="sv-caption">{`Correlation matrix · ${columns.length} measured numbers · |r| as density, red at ${STRONG_R} or more`}</span>
      <Cells name="Correlation matrix" rows={columns} columns={columns.length} value={at} warn={(i, j) => i !== j && Math.abs(at(i, j) ?? 0) >= STRONG_R} height={Math.max(80, columns.length * 28)} />
    </BodySection>
  );
}

function rolesLine(profile: DatasetProfile): string {
  return (Object.keys(ROLES) as ColumnRole[])
    .map((role) => ({ role, n: profile.columns.filter((c) => c.role === role).length }))
    .filter((g) => g.n > 0)
    .map((g) => `${g.n} ${g.n === 1 ? ROLES[g.role].one : ROLES[g.role].many}`)
    .join(" · ");
}

const num = (n: number) => (Number.isInteger(n) ? n.toLocaleString() : Number(n.toPrecision(4)).toLocaleString());

const pct1 = (n: number, rows: number) => (rows === 0 ? "—" : n / rows < 0.001 ? "<0.1%" : `${((n / rows) * 100).toFixed(1)}%`);

const percent = (share: number) => (share > 0 && share < 0.01 ? "<1%" : `${Math.round(share * 100)}%`);
