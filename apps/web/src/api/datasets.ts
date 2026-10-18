import { useQuery } from "@tanstack/react-query";

import { getList, getOne } from "./client.ts";

/** The tables the flows load, newest first (ADR-0038). */
export const useDatasets = () => useQuery({ queryKey: ["datasets"], queryFn: () => getList("Dataset", "/datasets?limit=50") });

/** A table's profile, computed by Python. Counts and shares only; never rows. */
export const useDatasetProfile = (artifactId: string | undefined) =>
  useQuery({
    queryKey: ["dataset-profile", artifactId],
    queryFn: () => getOne("DatasetProfile", `/artifacts/${artifactId ?? ""}/profile`),
    enabled: artifactId !== undefined,
    staleTime: Infinity, // an artifact never changes, so neither does its profile
  });
