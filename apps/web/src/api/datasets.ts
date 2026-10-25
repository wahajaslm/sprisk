import { useQuery } from "@tanstack/react-query";

import { getList, getOne } from "./client.ts";

/** The tables the flows load, newest first (ADR-0038). */
export const useLoadedTables = () =>
  useQuery({ queryKey: ["loaded_tables"], queryFn: () => getList("LoadedTable", "/loaded_tables?limit=50") });

/** A table's profile, computed by Python. Counts and shares only; never rows. */
export const useDatasetProfile = (artifactId: string | undefined) =>
  useQuery({
    queryKey: ["dataset-profile", artifactId],
    queryFn: () => getOne("DatasetProfile", `/artifacts/${artifactId ?? ""}/profile`),
    enabled: artifactId !== undefined,
    // An artifact never changes, so neither does its profile: kept for the session, not
    // dropped five minutes after the table was last shown.
    staleTime: Infinity,
    gcTime: Infinity,
  });
