import type { ColumnProfile, ColumnRole, DatasetProfile, LoadedTable, ProfileFinding } from "@sprisk/contracts";
import { lazy, Suspense } from "react";

import { useDatasetProfile } from "../../api/datasets.ts";
import { Loading } from "../../components/ui/Loading.tsx";
import { BodySection } from "../../components/ui/RowList.tsx";
import { correlationField, missingAndBlank, numberBins, valueBars, wordCounts } from "./profileFigures.ts";

const PlotlyFigure = lazy(() => import("../PlotlyFigure.tsx"));

/** Repeated text values a chart lists; long titles make more unreadable. */
const MAX_REPEATED = 15;

/** Numeric columns a correlation field needs before it is drawn. */
const MIN_CORRELATED = 3;

/** Each role in words, in the order the overview lists them. */
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

/** What the table holds: its columns by role, what stands out, where values are missing, and
 * one card per column with the chart its role calls for (ADR-0065). Computed by Python; a
 * profile request sends no rows (ADR-0038). */
export function ProfileTab({ dataset }: { dataset: LoadedTable }) {
  const profile = useDatasetProfile(dataset.artifact.id);
  if (profile.isError) return <p role="alert" className="error">{profile.error.message}</p>;
  if (profile.isPending) return <Loading text="Profiling the table…" />;
  const p = profile.data;
  const findings = p.findings ?? [];
  const missing = figureOf(missingAndBlank(p, tokenColor));
  const correlated = p.correlation.columns.length >= MIN_CORRELATED;
  return (
    <div className="ds-profile">
      <Overview profile={p} />
      <BodySection title="Findings" note="What stands out, warnings first. Each is counted from the rows; none is a decision.">
        {findings.length === 0 ? <p className="muted">Nothing stands out in these rows.</p> : <FindingList findings={findings} />}
      </BodySection>
      <BodySection title="Missing and blank values" note="Missing: an empty cell, NaN or infinity. Blank: text that is empty or only spaces, which an imputer does not see.">
        {missing ?? <p className="muted">Every column is filled in every row.</p>}
      </BodySection>
      <BodySection title="Columns" note="One card per column, with the chart its role calls for. A role is a guess from the values, never a confirmed meaning.">
        {p.columns.map((c) => (
          <ColumnCard key={c.name} column={c} rows={p.profiled_rows} findings={findings.filter((f) => f.column === c.name)} />
        ))}
      </BodySection>
      {correlated && <BodySection title="Correlation" note="Pearson correlation between measured numbers; identifiers and category codes are left out.">{figureOf(correlationField(p, tokenColor))}</BodySection>}
      {/* A whole-table profile sees held-out rows (rule 8); it is for looking only. */}
      <p className="ds-note">Includes every row, including held-out test rows. Use it to understand the data, not to choose features, transforms or models.</p>
    </div>
  );
}

function Overview({ profile }: { profile: DatasetProfile }) {
  const groups = (Object.keys(ROLES) as ColumnRole[])
    .map((role) => ({ role, names: profile.columns.filter((c) => c.role === role).map((c) => c.name) }))
    .filter((g) => g.names.length > 0);
  return (
    <BodySection title="Overview">
      <p className="ds-overview">
        {`${profile.total_rows.toLocaleString()} rows and ${profile.total_columns} columns.`}
        {profile.profiled_rows < profile.total_rows && ` Profiled the first ${profile.profiled_rows.toLocaleString()} rows.`}
        {profile.columns.length < profile.total_columns && ` Showing the first ${profile.columns.length} columns.`}
      </p>
      <dl className="ds-roles" aria-label="Columns by role">
        {groups.map((g) => (
          <div key={g.role}>
            <dt>{`${g.names.length} ${g.names.length === 1 ? ROLES[g.role].one : ROLES[g.role].many}`}</dt>
            <dd className="mono">{g.names.join(", ")}</dd>
          </div>
        ))}
      </dl>
    </BodySection>
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

function ColumnCard({ column, rows, findings }: { column: ColumnProfile; rows: number; findings: ProfileFinding[] }) {
  const role = column.role ?? "category";
  const figures = chartsOf(column, rows);
  return (
    <article className="ds-column" aria-label={column.name}>
      <header className="ds-column-head">
        <h3 className="mono">{column.name}</h3>
        <span className="ds-role">{ROLES[role].one}</span>
        <span className="muted mono">{column.data_type}</span>
      </header>
      <dl className="ds-column-facts">
        {factsOf(column, rows).map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd className="mono">{v}</dd>
          </div>
        ))}
      </dl>
      {figures.length > 0 && <div className="ds-column-charts">{figures.map((f) => figureOf(f))}</div>}
      {findings.length > 0 && <FindingList findings={findings} />}
    </article>
  );
}

type Figure = NonNullable<ReturnType<typeof missingAndBlank>>;

/** The charts a column's role calls for. An identifier, a date or a constant has no chart that
 * says more than its facts. */
function chartsOf(column: ColumnProfile, rows: number): Figure[] {
  switch (column.role) {
    case "text": {
      // Free text is mostly unique; only values that repeat say something.
      const repeated = (column.histogram?.bars ?? []).filter((b) => b.count > 1).slice(0, MAX_REPEATED);
      const words = column.word_counts ? [wordCounts(column, tokenColor)] : [];
      const most = repeated.length > 0 ? [valueBars({ ...column, histogram: { kind: "top_values", bars: repeated } }, rows, tokenColor, "Most repeated values")] : [];
      return [...words, ...most];
    }
    case "category":
    case "boolean":
      return column.histogram ? [valueBars(column, rows, tokenColor)] : [];
    case "number":
      return column.histogram ? [numberBins(column, tokenColor)] : [];
    default:
      return [];
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
  if (column.rarest_share !== undefined && column.role === "category") facts.push(["rarest value", percent(column.rarest_share)]);
  return facts;
}

function figureOf(figure: Figure | null) {
  if (!figure) return null;
  const label = String((figure.layout.title as { text: string }).text);
  return (
    // A chart that sets its own height (bars that grow with their count) keeps it.
    <figure key={label} className="result-tile plot" style={figure.layout.height ? { height: figure.layout.height, minHeight: 0 } : undefined}>
      <Suspense fallback={<Loading text="Loading figure…" />}>
        <PlotlyFigure json={JSON.stringify(figure)} label={label} />
      </Suspense>
    </figure>
  );
}

function tokenColor(token: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(token).trim();
}

const num = (n: number) => (Number.isInteger(n) ? n.toLocaleString() : Number(n.toPrecision(4)).toLocaleString());

const percent = (share: number) => (share > 0 && share < 0.01 ? "<1%" : `${Math.round(share * 100)}%`);
