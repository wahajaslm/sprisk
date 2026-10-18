import type { NodeKind } from "../flow/stages.ts";

/** Kind glyphs from the Studio concept, 16px, stroked in their kind's colour. */
export function KindIcon({ kind, size = 16 }: { kind: NodeKind; size?: number }) {
  // Coloured by kind (cockpit.css --kind-*), so steps of one kind are easy to spot.
  const common = { className: `kind-icon kind-${kind}`, width: size, height: size, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.3, "aria-hidden": true } as const;
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

export function StepsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 1.5l5.5 3v7L8 14.5l-5.5-3v-7z" />
      <path d="M2.5 4.5L8 7.5l5.5-3M8 7.5v7" />
    </svg>
  );
}

export function RunsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" aria-hidden="true">
      <path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9" />
      <path d="M2.2 2.2v2.3h2.3" />
      <path d="M8 5v3.2l2 1.3" />
    </svg>
  );
}

export function ViewsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
      <rect x="1.75" y="2.25" width="12.5" height="11.5" rx="1.5" />
      <path d="M6 2.25v11.5M6 8h8.25" />
    </svg>
  );
}

export function PinIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 1.8h4l-.6 4.2 2.6 2.5H4l2.6-2.5z" />
      <path d="M8 8.5v5.7" />
    </svg>
  );
}

export function PopOutIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 2.5h4.5V7" />
      <path d="M13.5 2.5 7.5 8.5" />
      <path d="M11.5 9.5v4h-9v-9h4" />
    </svg>
  );
}

export function TrashIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
      <path d="M2 3h8M4.5 3V1.8h3V3M3 3l.6 7.2h4.8L9 3" />
    </svg>
  );
}

export function RenameIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 10l.5-2.5L8 2l2 2-5.5 5.5zM7 3l2 2" />
    </svg>
  );
}

export function CodeIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
      <path d="M4 3L1.5 6 4 9M8 3l2.5 3L8 9" />
    </svg>
  );
}

export function AddIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

export function RunAllIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.5 3v10L8 8zM8 3v10l5.5-5z" fill="currentColor" />
    </svg>
  );
}

export function ExportIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
      <path d="M8 2.5v8M4.5 7L8 10.5 11.5 7M3 13.5h10" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M3 8.5l3 3 7-7" />
    </svg>
  );
}

export function CrossIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}
