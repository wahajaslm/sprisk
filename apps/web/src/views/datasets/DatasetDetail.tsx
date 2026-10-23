import type { ColumnProfile, DatasetProfile, LoadedTable } from "@sprisk/contracts";
import { lazy, Suspense } from "react";

import { useDatasetProfile } from "../../api/datasets.ts";
import { Button } from "../../components/ui/Button.tsx";
import { Loading } from "../../components/ui/Loading.tsx";
import { BodySection, RowItem, RowList } from "../../components/ui/RowList.tsx";
import { correlationField, distributions, missingMap } from "./profileFigures.ts";

const PlotlyFigure = lazy(() => import("../PlotlyFigure.tsx"));

/** One step that loads the table, named for people. */
export type Use = { label: string; use: LoadedTable["used_by"][number] };

/** Each column and three pictures of the table's values. Its rows stay on the server (ADR-0038):
 * the page shows the profile, never the table. */
export function ProfileTab({ dataset }: { dataset: LoadedTable }) {
  const profile = useDatasetProfile(dataset.artifact.id);
  return (
    <div className="ds-profile">
      {/* A whole-table profile sees held-out rows (rule 8); it is for looking only. */}
      <p className="nv-note ds-note">
        Includes every row, including held-out test rows. Use it to inspect the data, not to choose features, transforms or models.
        Missing counts empty cells, NaN and infinity.
      </p>
      {profile.isError ? (
        <p role="alert" className="error">{profile.error.message}</p>
      ) : profile.isPending ? (
        <Loading text="Profiling the table…" />
      ) : (
        <>
          <Partial profile={profile.data} />
          <Columns name={dataset.name} columns={profile.data.columns} rows={profile.data.profiled_rows} />
          <Plots profile={profile.data} />
        </>
      )}
    </div>
  );
}

/** Each flow and step that loads the table, each with a way to open it. */
export function LineageTab({ lineage, onOpen }: { lineage: Use[]; onOpen: (use: Use["use"]) => void }) {
  if (lineage.length === 0) return <p className="muted">No flow loads this table yet.</p>;
  return (
    <BodySection title="Loaded by" note="Each flow and step that loads this table.">
      <RowList label="Lineage">
        {lineage.map((l) => (
          <RowItem key={l.label} name={l.label} meta={`run ${l.use.run_id.slice(-6)}`} action={<Button size="sm" onClick={() => onOpen(l.use)}>Open</Button>} />
        ))}
      </RowList>
    </BodySection>
  );
}

function Columns({ name, columns, rows }: { name: string; columns: ColumnProfile[]; rows: number }) {
  return (
    <table className="exp-table ds-columns" aria-label={`Columns of ${name}`}>
      <thead>
        <tr>
          <th scope="col">Column</th>
          <th scope="col">Type</th>
          <th scope="col">Missing</th>
          <th scope="col" className="num">Distinct</th>
          <th scope="col">Shape</th>
        </tr>
      </thead>
      <tbody>
        {columns.map((c) => {
          const share = rows === 0 ? 0 : c.missing / rows;
          return (
            <tr key={c.name}>
              <td className="mono">{c.name}</td>
              <td className="mono muted">{c.data_type}</td>
              <td>
                <span className="ds-missing">
                  <span className="ds-missing-bar" aria-hidden="true">
                    {/* Red is for problems (ADR-0061): a column 20% or more empty. */}
                    <span data-testid="missing" className={share >= MISSING_WARN ? "warn" : undefined} style={{ width: `${share * 100}%` }} />
                  </span>
                  <span className="mono">{percent(share)}</span>
                </span>
              </td>
              <td className="num mono">{c.distinct.toLocaleString()}</td>
              <td>
                <Shape column={c} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** A column's histogram as tiny bars; the Distributions plot has the detail. */
function Shape({ column }: { column: ColumnProfile }) {
  const bars = column.histogram?.bars ?? [];
  const most = Math.max(1, ...bars.map((b) => b.count));
  if (bars.length === 0) return <span className="muted">—</span>;
  return (
    <span className="nv-bars ds-shape" aria-hidden="true">
      {bars.map((b, i) => (
        <span key={i} style={{ height: `${Math.max(6, (b.count / most) * 100)}%` }} />
      ))}
    </span>
  );
}

function Plots({ profile }: { profile: DatasetProfile }) {
  const css = getComputedStyle(document.documentElement);
  const color = (token: string) => css.getPropertyValue(token).trim();
  const figures = [missingMap(profile, color), correlationField(profile, color), distributions(profile, color)];
  return (
    <section className="ds-plots" aria-label="Plots">
      {figures.map((figure) => {
        const label = String((figure.layout.title as { text: string }).text);
        return (
          <figure key={label} className="result-tile plot">
            <Suspense fallback={<Loading text="Loading figure…" />}>
              <PlotlyFigure json={JSON.stringify(figure)} label={label} />
            </Suspense>
          </figure>
        );
      })}
    </section>
  );
}

/** A large table is profiled in part; say which part. */
function Partial({ profile }: { profile: DatasetProfile }) {
  const notes = [];
  if (profile.profiled_rows < profile.total_rows)
    notes.push(`Profiled the first ${profile.profiled_rows.toLocaleString()} of ${profile.total_rows.toLocaleString()} rows.`);
  if (profile.columns.length < profile.total_columns)
    notes.push(`Showing the first ${profile.columns.length} of ${profile.total_columns} columns.`);
  const numeric = profile.columns.filter((c) => c.histogram?.kind === "bins" && c.distinct > 1).length;
  if (profile.correlation.columns.length < numeric)
    notes.push(`The correlation field shows the first ${profile.correlation.columns.length} of ${numeric} numeric columns.`);
  return notes.map((note) => (
    <p key={note} className="muted">
      {note}
    </p>
  ));
}

function missingShare(profile: DatasetProfile): number {
  const cells = profile.profiled_rows * profile.columns.length;
  return cells === 0 ? 0 : profile.columns.reduce((sum, c) => sum + c.missing, 0) / cells;
}

const MISSING_WARN = 0.2;

const percent = (share: number) => (share > 0 && share < 0.01 ? "<1%" : `${Math.round(share * 100)}%`);
