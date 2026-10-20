import type { ColumnProfile, DatasetProfile, LoadedTable } from "@sprisk/contracts";
import { lazy, Suspense, useState } from "react";

import { useDatasetProfile } from "../../api/datasets.ts";
import { shortName } from "../../flow/stages.ts";
import { Loading } from "../../components/ui/Loading.tsx";
import { useSelection } from "../../workbench/selection.ts";
import { correlationField, distributions, missingMap } from "./profileFigures.ts";

const PlotlyFigure = lazy(() => import("../PlotlyFigure.tsx"));

/** One table: what it is, who loads it, each column, and three pictures of its values. */
export function DatasetDetail({ dataset, usedBy }: { dataset: LoadedTable; usedBy: string[] }) {
  const profile = useDatasetProfile(dataset.artifact.id);
  const showRun = useSelection((s) => s.showRun);
  const setNav = useSelection((s) => s.setNav);
  const [tab, setTab] = useState<"columns" | "visuals">("columns");
  const first = dataset.used_by[0];

  return (
    <section className="dsx-detail" aria-label={dataset.name}>
      <header className="dsx-title">
        <div>
          <h1>{dataset.name}</h1>
          <p className="muted">Loaded by {shortName(dataset.operator)} · Used by {usedBy.join(", ") || "—"}</p>
        </div>
      </header>
      <div className="dsx-tabs" role="tablist" aria-label="Dataset view tabs">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "columns"}
          className={`dsx-tab-btn${tab === "columns" ? " active" : ""}`}
          onClick={() => setTab("columns")}
        >
          Columns & Schema ({profile.data ? profile.data.columns.length : dataset.total_columns})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "visuals"}
          className={`dsx-tab-btn${tab === "visuals" ? " active" : ""}`}
          onClick={() => setTab("visuals")}
        >
          Distributions & Correlations
        </button>
      </div>
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
          <div className={`dsx-tab-pane${tab === "columns" ? " active" : ""}`} data-active={tab === "columns"}>
            <Columns name={dataset.name} columns={profile.data.columns} rows={profile.data.profiled_rows} />
          </div>
          <div className={`dsx-tab-pane${tab === "visuals" ? " active" : ""}`} data-active={tab === "visuals"}>
            <Plots profile={profile.data} />
          </div>
        </>
      )}
    </section>
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
                    <span className={share > 0 ? "warn" : undefined} style={{ width: `${share * 100}%` }} />
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

const percent = (share: number) => (share > 0 && share < 0.01 ? "<1%" : `${Math.round(share * 100)}%`);
