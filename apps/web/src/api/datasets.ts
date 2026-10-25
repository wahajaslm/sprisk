import { useQueries, useQuery } from "@tanstack/react-query";

import { getList, getOne } from "./client.ts";

/** The tables the flows load, newest first (ADR-0038). */
export const useLoadedTables = () =>
  useQuery({ queryKey: ["loaded_tables"], queryFn: () => getList("LoadedTable", "/loaded_tables?limit=50") });

/** A table's profile, computed by Python once and kept by the server. Counts and shares only;
 * never rows. An artifact never changes, so neither does its profile: kept for the session,
 * not dropped five minutes after the table was last shown. */
const profileQuery = (artifactId: string) => ({
  queryKey: ["dataset-profile", artifactId],
  queryFn: () => getOne("DatasetProfile", `/artifacts/${artifactId}/profile`),
  staleTime: Infinity,
  gcTime: Infinity,
});

export const useDatasetProfile = (artifactId: string | undefined) => useQuery({ ...profileQuery(artifactId ?? ""), enabled: artifactId !== undefined });

/** The profiles of several tables, one query each, in the order given. */
export const useDatasetProfiles = (artifactIds: string[]) => useQueries({ queries: artifactIds.map(profileQuery) });
