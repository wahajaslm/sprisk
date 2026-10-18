import type { ColumnProfile, Dataset, DatasetProfile } from "@sprisk/contracts";
import { lazy, Suspense } from "react";

import { useDatasetProfile } from "../../api/datasets.ts";
import { shortName } from "../../flow/stages.ts";
import { Loading } from "../../components/ui/Loading.tsx";
import { useSelection } from "../../workbench/selection.ts";
import { correlationField, distributions, missingMap } from "./profileFigures.ts";

const PlotlyFigure = lazy(() => import("../PlotlyFigure.tsx"));

/** One table: what it is, who loads it, each column, and three pictures of its values. */
export function DatasetDetail({ dataset, usedBy }: { dataset: Dataset; usedBy: string[] }) {
  const profile = useDatasetProfile(dataset.artifact.id);
  const showRun = useSelection((s) => s.showRun);
  const setNav = useSelection((s) => s.setNav);
  const first = dataset.used_by[0];
  return (
    <section className="ds-detail" aria-label={dataset.name}>
      <aside className="ds-summary">
        <h2>{dataset.name}</h2>
        <p className="muted">{shortName(dataset.operator)}</p>
        <dl>
          <dt>Rows</dt>
          <dd>{dataset.total_rows.toLocaleString()}</dd>
          <dt>Columns</dt>
          <dd>{dataset.total_columns}</dd>
          {profile.data && (
            <>
              <dt>Missing</dt>
              <dd>{percent(missingShare(profile.data))}</dd>
            </>
          )}
          <dt>Used by</dt>
          <dd>{usedBy.join(", ")}</dd>
        </dl>
        {first && (
          <button
            type="button"
            className="page-btn"
            aria-label={`Open ${dataset.name} in Flow`}
            onClick={() => {
              showRun(first.pipeline_version_id, first.run_id, first.node_id);
              setNav("Flow");
            }}
          >
            Open in Flow
          </button>
        )}
        <p className="nv-note ds-note">
          Profiled over every row as loaded, including rows a flow holds out. Flows explore their training rows only.
        </p>
      </aside>
      <div className="ds-profile">
        {profile.isError ? (
          <p role="alert" className="error">{profile.error.message}</p>
        ) : profile.isPending ? (
          <Loading text="Profiling the table…" />
        ) : (
          <>
            {profile.data.columns.length < profile.data.total_columns && (
              <p className="muted">Showing the first {profile.data.columns.length} of {profile.data.total_columns} columns.</p>
            )}
            <Columns name={dataset.name} columns={profile.data.columns} rows={profile.data.total_rows} />
            <Plots profile={profile.data} />
          </>
        )}
      </div>
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

function missingShare(profile: DatasetProfile): number {
  const cells = profile.total_rows * profile.columns.length;
  return cells === 0 ? 0 : profile.columns.reduce((sum, c) => sum + c.missing, 0) / cells;
}

const percent = (share: number) => (share > 0 && share < 0.01 ? "<1%" : `${Math.round(share * 100)}%`);
