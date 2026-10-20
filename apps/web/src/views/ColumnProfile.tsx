import type { TablePage } from "@sprisk/contracts";

import { useTablePage } from "../api/hooks.ts";
import { Loading } from "../components/ui/Loading.tsx";

/** A profile has one row per data column; more than this many is paged by the table view. */
const MAX_PROFILED = 200;

type Summary = Record<string, string | undefined>;

/** Rows of DuckDB SUMMARIZE (written by the profile step) keyed by column name. */
function summaries(page: TablePage): Summary[] {
  return page.rows.map((row) =>
    Object.fromEntries(page.columns.map((c, i) => [c.name, row.missing.includes(i) ? undefined : row.values[i]])),
  );
}

/** One card per data column: type, missing share, distinct count and spread. Display only;
 * the numbers come from the profile step (rule 9). */
export function ColumnProfile({ artifactId }: { artifactId: string }) {
  const page = useTablePage(artifactId, 0, MAX_PROFILED);
  if (page.isPending) return <Loading text="Loading profile…" />;
  if (page.isError) return <p role="alert" className="error">{page.error.message}</p>;
  const columns = summaries(page.data);
  if (columns.length === 0) return <p className="muted">The profile has no columns.</p>;
  return (
    <section className="profile" aria-label="Column profile">
      {columns.map((s) => (
        <ProfileCard key={s.column_name} summary={s} />
      ))}
      {page.data.total_rows > columns.length && (
        <p className="muted">First {columns.length} of {page.data.total_rows} columns.</p>
      )}
    </section>
  );
}

function ProfileCard({ summary: s }: { summary: Summary }) {
  const name = s.column_name ?? "?";
  const spread = spreadOf(s);
  return (
    <div role="group" aria-label={name} className="profile-card">
      <div className="profile-head">
        <span className="profile-name">{name}</span>
        <span className="col-type">{s.column_type}</span>
      </div>
      <div className="profile-facts">
        <span className={Number(s.null_percentage) > 0 ? "warn" : undefined}>{s.null_percentage ?? "?"}% missing</span>
        <span>{s.approx_unique ?? "?"} distinct</span>
        {s.avg !== undefined && (
          <span>
            mean {round(s.avg)}
            {s.std !== undefined && ` ± ${round(s.std)}`}
          </span>
        )}
      </div>
      {spread ? <SpreadStrip {...spread} /> : <p className="profile-range">{s.min} … {s.max}</p>}
    </div>
  );
}

type Spread = { min: number; q25: number; q50: number; q75: number; max: number };

function spreadOf(s: Summary): Spread | undefined {
  const values = [s.min, s.q25, s.q50, s.q75, s.max].map(Number);
  if (values.some((v) => !Number.isFinite(v)) || [s.q25, s.q50, s.q75].some((v) => v === undefined)) return undefined;
  const [min, q25, q50, q75, max] = values as [number, number, number, number, number];
  return { min, q25, q50, q75, max };
}

/** The five-number summary as plain numbers; the plots live in Visualizations, drawn by Python. */
function SpreadStrip({ min, q25, q50, q75, max }: Spread) {
  return (
    <p className="profile-range" aria-label={`min ${min}, q25 ${q25}, median ${q50}, q75 ${q75}, max ${max}`}>
      min {min} · q25 {q25} · median {q50} · q75 {q75} · max {max}
    </p>
  );
}

const round = (text: string) => Number(Number(text).toPrecision(3)).toString();
