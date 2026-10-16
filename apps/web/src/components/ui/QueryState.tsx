import type { ReactNode } from "react";

import { Loading } from "./Loading.tsx";

type Query<T> = { isPending: boolean; isError: boolean; error: Error | null; data: T | undefined };

/** The loading, error and empty states every panel needs, the same way everywhere (ADR-0027). */
export function QueryState<T>({
  query,
  empty,
  children,
}: {
  query: Query<T>;
  empty?: string;
  children: (data: T) => ReactNode;
}) {
  if (query.isError) return <p role="alert" className="error">{query.error?.message}</p>;
  if (query.data === undefined) return query.isPending ? <Loading /> : null;
  if (empty !== undefined && Array.isArray(query.data) && query.data.length === 0) return <p className="muted">{empty}</p>;
  return children(query.data);
}
