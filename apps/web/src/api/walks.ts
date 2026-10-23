import type { CreateWalk, Walk } from "@sprisk/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ulid } from "ulid";

import { getOne, postOne } from "./client.ts";

/** A walking walk is re-read this often; a stopped one never changes again. */
const LIVE_MS = 1000;

export type WalkRequest = Omit<CreateWalk, "idempotency_key">;

/** Starts the engine on a question and its sources (ADR-0060). Each submit is its own request, so its own key. */
export const useStartWalk = () =>
  useMutation({
    mutationFn: (request: WalkRequest): Promise<Walk> =>
      postOne("Walk", "/walks", { ...request, idempotency_key: `walk-${ulid()}` } satisfies CreateWalk),
  });

/** One walk with its steps, re-read while it walks. */
export const useWalk = (id: string | undefined) =>
  useQuery({
    queryKey: ["walk", id],
    queryFn: () => getOne("WalkDetail", `/walks/${id ?? ""}`),
    enabled: id !== undefined,
    refetchInterval: (query) => (query.state.data?.walk.status === "stopped" ? false : LIVE_MS),
    staleTime: (query) => (query.state.data?.walk.status === "stopped" ? Infinity : 0),
  });
