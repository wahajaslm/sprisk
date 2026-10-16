import type { NodeKind } from "../flow/stages.ts";

/** Kind glyphs from the Studio concept, 16px, stroked in currentColor. */
export function KindIcon({ kind, size = 16 }: { kind: NodeKind; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.3, "aria-hidden": true } as const;
  switch (kind) {
    case "source":
      return (
        <svg {...common}>
          <ellipse cx="8" cy="4" rx="5" ry="2" />
          <path d="M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4" />
          <path d="M3 8c0 1.1 2.2 2 5 2s5-.9 5-2" />
        </svg>
      );
    case "recipe":
      return (
        <svg {...common} strokeLinejoin="round">
          <path d="M8 1.5l5.5 3v7L8 14.5l-5.5-3v-7z" />
          <path d="M2.5 4.5L8 7.5l5.5-3M8 7.5v7" />
        </svg>
      );
    case "decision":
      return (
        <svg {...common} strokeLinejoin="round">
          <path d="M8 1.8L14.2 8 8 14.2 1.8 8z" />
          <path d="M6 8h4" />
        </svg>
      );
    case "model":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6" />
          <circle cx="8" cy="8" r="3.2" />
          <circle cx="8" cy="8" r="0.9" fill="currentColor" />
        </svg>
      );
    case "view":
      return (
        <svg {...common} strokeLinecap="round">
          <path d="M2.5 13.5h11" />
          <path d="M4.5 11V8M8 11V4M11.5 11V6.5" />
        </svg>
      );
  }
}

/** Small kind marker used in the step library and legend: a square, rotated for decisions. */
export function KindMark({ kind }: { kind: NodeKind }) {
  return <span className={`kind-mark kind-${kind}`} aria-hidden="true" />;
}

export function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="9" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="11" cy="11" r="4.5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="11" cy="11" r="1.4" fill="currentColor" />
    </svg>
  );
}

export function Chevron() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <path d="M2 3.5l3 3 3-3" />
    </svg>
  );
}

export function PlayIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M3 1.8v8.4L10 6z" fill="currentColor" />
    </svg>
  );
}

export function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <circle cx="7" cy="7" r="5" />
      <path d="M11 11l3.5 3.5" />
    </svg>
  );
}

export function SparkIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
      <path d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3M3.4 3.4l2.1 2.1M10.5 10.5l2.1 2.1M3.4 12.6l2.1-2.1M10.5 5.5l2.1-2.1" />
    </svg>
  );
}

export function SendIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 13V3M3.5 7.5L8 3l4.5 4.5" />
    </svg>
  );
}
