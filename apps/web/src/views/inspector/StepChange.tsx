import type { Attempt, PipelineVersion } from "@sprisk/contracts";
import { useQueries } from "@tanstack/react-query";

import { useDatasetProfiles } from "../../api/datasets.ts";
import { outputsQuery } from "../../api/hooks.ts";
import { PARQUET } from "../../api/media.ts";
import { Loading } from "../../components/ui/Loading.tsx";
import { hasOutputs, latestByNode } from "../../flow/latest.ts";
import { stepOf } from "../../flow/ports.ts";
import { PlotTile } from "../PlotTile.tsx";
import { tokenColor } from "../tokenColor.ts";
import { columnsChange, missingBeforeAfter, type PortTable, rowsInOut } from "./stepChange.ts";

/** The tables a step read (by its own input port) and wrote, as artifact ids. */
function useStepTables(pipeline: PipelineVersion, nodeId: string, attempts: Attempt[]) {
  const latest = latestByNode(attempts);
  const own = latest.get(nodeId);
  const into = pipeline.edges.filter((e) => stepOf(e.to) === nodeId);
  const sources = [...new Set(into.map((e) => stepOf(e.from)))].flatMap((id) => {
    const attempt = latest.get(id);
    return attempt && hasOutputs(attempt) ? [{ id, attempt }] : [];
  });
  const read = useQueries({ queries: [...sources.map((s) => outputsQuery(s.attempt.id)), ...(own && hasOutputs(own) ? [outputsQuery(own.id)] : [])] });
  const outputsOf = (i: number) => (read[i]?.data ?? []).filter((o) => o.artifact.media_type === PARQUET);
  const inputs = into.flatMap((e) => {
    const [from, port] = e.from.split(".");
    const at = sources.findIndex((s) => s.id === from);
    const artifact = at >= 0 ? outputsOf(at).find((o) => o.port === port)?.artifact.id : undefined;
    return artifact ? [{ port: e.to.split(".")[1] ?? e.to, artifact }] : [];
  });
  const outputs = own && hasOutputs(own) ? outputsOf(sources.length).map((o) => ({ port: o.port, artifact: o.artifact.id })) : [];
  return { inputs, outputs, error: read.find((q) => q.isError)?.error, pending: read.some((q) => q.isPending) };
}

/** What a step did to its tables, for any step that reads or writes one: rows in and out,
 * columns added or removed, and missing values before and after (ADR-0065). Drawn from the
 * tables' stored profiles; the browser reads no rows. */
export function StepChange({ pipeline, nodeId, attempts }: { pipeline: PipelineVersion; nodeId: string; attempts: Attempt[] }) {
  const tables = useStepTables(pipeline, nodeId, attempts);
  const ids = [...tables.inputs, ...tables.outputs].map((t) => t.artifact);
  const profiles = useDatasetProfiles(ids);
  if (tables.error) return <p role="alert" className="error">The step's tables could not be read: {tables.error.message}</p>;
  if (tables.outputs.length === 0 || tables.inputs.length === 0) return null;
  const failed = profiles.find((p) => p.isError);
  if (failed?.error) return <p role="alert" className="error">A table could not be profiled: {failed.error.message}</p>;
  if (tables.pending || profiles.some((p) => p.isPending)) return <Loading text="Comparing the step's tables…" />;
  const profileOf = (artifact: string) => profiles[ids.indexOf(artifact)]?.data;
  const withProfile = (list: { port: string; artifact: string }[]): PortTable[] =>
    list.flatMap((t) => {
      const profile = profileOf(t.artifact);
      return profile ? [{ port: t.port, profile }] : [];
    });
  const inputs = withProfile(tables.inputs);
  const outputs = withProfile(tables.outputs);
  const [first, firstOut] = [inputs[0]?.profile, outputs[0]?.profile];
  const change = first && firstOut ? columnsChange(first, firstOut) : { added: [], removed: [] };
  const missing = first && firstOut ? missingBeforeAfter(first, firstOut, tokenColor) : null;
  return (
    <section className="step-change" aria-label="What this step did">
      <h3 className="rd-label">What this step did</h3>
      <div className="step-change-charts">
        <PlotTile figure={rowsInOut(inputs, outputs, tokenColor)} label="Rows in and out" />
        {missing && <PlotTile figure={missing} label="Missing values before and after" />}
      </div>
      {(change.added.length > 0 || change.removed.length > 0) && (
        <dl className="step-change-columns">
          {change.added.length > 0 && (
            <div>
              <dt>Columns added</dt>
              <dd className="mono">{change.added.join(", ")}</dd>
            </div>
          )}
          {change.removed.length > 0 && (
            <div>
              <dt>Columns removed</dt>
              <dd className="mono">{change.removed.join(", ")}</dd>
            </div>
          )}
        </dl>
      )}
    </section>
  );
}
