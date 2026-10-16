import { useEffect, useState } from "react";

/** Loads faster than this show no text at all, so the screen does not flash (ADR-0027 §5). */
const SHOW_AFTER_MS = 200;

export function Loading({ text = "Loading…", pad = false }: { text?: string; pad?: boolean }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setShown(true), SHOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);
  if (!shown) return null;
  return <p className={pad ? "muted pad" : "muted"}>{text}</p>;
}
