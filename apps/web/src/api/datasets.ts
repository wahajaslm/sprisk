import type { CreateDatasetVersion, DatasetVersion } from "@sprisk/contracts";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";

import { getList, getOne, postOne } from "./client.ts";

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

/** The API-owned, deterministic explanation of which Explore views apply to this table.
 * React renders its fixed order and reasons; it never chooses sections itself. */
export const useProfilePlan = (artifactId: string | undefined, questionVersionId?: string) =>
  useQuery({
    queryKey: ["dataset-profile-plan", artifactId, questionVersionId ?? ""],
    queryFn: () => getOne("ProfilePlan", `/artifacts/${artifactId}/profile_plan${questionVersionId ? `?question_version_id=${encodeURIComponent(questionVersionId)}` : ""}`),
    enabled: artifactId !== undefined,
    staleTime: Infinity,
    gcTime: Infinity,
  });

/** The profiles of several tables, one query each, in the order given. */
export const useDatasetProfiles = (artifactIds: string[]) => useQueries({ queries: artifactIds.map((id) => profileQuery(id)) });

/** How a table's numeric columns differ from another's, such as a split's train rows from its
 * test rows (ADR-0065). Both tables never change, so neither does the answer. */
export const useTableShift = (artifactId: string | undefined, against: string | undefined) =>
  useQuery({
    queryKey: ["table-shift", artifactId, against],
    queryFn: () => getOne("TableShift", `/artifacts/${artifactId}/shift?against=${against}`),
    enabled: artifactId !== undefined && against !== undefined,
    staleTime: Infinity,
    gcTime: Infinity,
  });

/** Data registered by reference, newest first (ADR-0067). */
export const useDatasetVersions = () =>
  useQuery({ queryKey: ["dataset_versions"], queryFn: () => getList("DatasetVersion", "/dataset_versions?limit=50") });

/** Registers data where it lives, by its path or URI. The server lists it and keeps a
 * fingerprint; nothing is copied. Registering the same data again returns the same version. */
export function useAddDataSource() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (location: string) => postOne("DatasetVersion", "/dataset_versions", { location } satisfies CreateDatasetVersion),
    onSuccess: (added: DatasetVersion) => {
      client.setQueryData<DatasetVersion[]>(["dataset_versions"], (all) => [added, ...(all ?? []).filter((v) => v.id !== added.id)]);
      void client.invalidateQueries({ queryKey: ["dataset_versions"] });
    },
  });
}

/** A registered source's profile, read in place on its first rows. A version never changes,
 * so neither does its profile. */
export const useDatasetVersionProfile = (id: string) =>
  useQuery({
    queryKey: ["dataset-version-profile", id],
    queryFn: () => getOne("DatasetProfile", `/dataset_versions/${id}/profile`),
    staleTime: Infinity,
    gcTime: Infinity,
  });
