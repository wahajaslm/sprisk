import type { ReactNode } from "react";

import { useFirstFigure } from "../api/figures.ts";
import { useOutputs } from "../api/hooks.ts";
import { FigureView } from "./inspector/FiguresTab.tsx";

/** A step's first figure, small, in its canvas card, under the card's fact. A step that drew
 * no figure keeps what its card showed before (`fallback`). Only that figure is fetched. */
export function CardFigure({ attemptId, port, fact, fallback }: { attemptId: string; port: string; fact: ReactNode; fallback: ReactNode }) {
  const outputs = useOutputs(attemptId);
  const artifactId = outputs.data?.find((o) => o.port === port)?.artifact.id;
  const first = useFirstFigure(artifactId);
  if (outputs.isError) return <Problem message={outputs.error.message} />;
  if (outputs.isPending) return <Skeleton />;
  if (!artifactId) return fallback;
  if (first.isError) return <Problem message={first.error.message} />;
  if (first.isPending) return <Skeleton />;
  const figure = first.data.items[0];
  if (!figure) return fallback;
  return (
    <span className="card-preview">
      {fact}
      <span className="card-figure">
        <FigureView figure={figure} index={0} small />
      </span>
    </span>
  );
}

function Problem({ message }: { message: string }) {
  return (
    <p role="alert" className="nv-note error" title={message}>
      {message}
    </p>
  );
}

function Skeleton() {
  return <span className="nv nv-skeleton" aria-hidden="true" />;
}
