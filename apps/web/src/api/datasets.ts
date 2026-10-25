import { useQueries, useQuery } from "@tanstack/react-query";

import { getList, getOne } from "./client.ts";

/** The tables the flows load, newest first (ADR-0038). */
export const useLoadedTables = () =>
  useQuery({ queryKey: ["loaded_tables"], queryFn: () => getList("LoadedTable", "/loaded_tables?limit=50") });

/** A table's profile, computed by Python once and kept by the server. Counts and shares only;
 * never rows. An artifact never changes, so neither does its profile: kept for the session,
 * not dropped five minutes after the table was last shown. */
const profileQuery = (artifactId: string, target?: string) => ({
  queryKey: ["dataset-profile", artifactId, target ?? ""],
  queryFn: () => getOne("DatasetProfile", `/artifacts/${artifactId}/profile${target ? `?target=${encodeURIComponent(target)}` : ""}`),
  staleTime: Infinity,
  gcTime: Infinity,
});

/** With `target`, the profile also relates the columns to that label (ADR-0065). */
export const useDatasetProfile = (artifactId: string | undefined, target?: string) => useQuery({ ...profileQuery(artifactId ?? "", target), enabled: artifactId !== undefined });

/** The profiles of several tables, one query each, in the order given. */
export const useDatasetProfiles = (artifactIds: string[]) => useQueries({ queries: artifactIds.map((id) => profileQuery(id)) });
