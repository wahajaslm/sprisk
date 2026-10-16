import type { UseQueryResult } from "@tanstack/react-query";
import type { ReactNode } from "react";

/** Every query state is shown: loading, error, empty, data (apps/web/CLAUDE.md). */
export function QueryState<T>({
  query,
  empty,
  children,
}: {
  query: UseQueryResult<T[]>;
  empty: string;
  children: (data: T[]) => ReactNode;
}) {
  if (query.isPending) return <p className="muted">Loading…</p>;
  if (query.isError) return <p role="alert" className="error">{query.error.message}</p>;
  if (query.data.length === 0) return <p className="muted">{empty}</p>;
  return <>{children(query.data)}</>;
}
