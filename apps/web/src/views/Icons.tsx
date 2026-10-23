import type { NodeKind } from "../flow/stages.ts";

/** Kind glyphs from the Studio concept, 16px, stroked in their kind's colour. */
export function KindIcon({ kind, size = 16 }: { kind: NodeKind; size?: number }) {
  // Coloured by kind (cockpit.css --kind-*), so steps of one kind are easy to spot.
  const common = {
    className: `kind-icon kind-${kind}`,
    width: size,
    height: size,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    shapeRendering: "geometricPrecision",
    style: { vectorEffect: "non-scaling-stroke" },
    "aria-hidden": true,
  } as const;
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

export function Logo() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <path d="M3 4.5h10M3 8h6.5M3 11.5h3.5" />
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

export function StopIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <rect x="2" y="2" width="6" height="6" fill="currentColor" rx="0.5" />
    </svg>
  );
}

export function RestartIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 8a5.5 5.5 0 0 1 9.3-3.9L14 6" />
      <path d="M14 2v4h-4" />
      <path d="M13.5 8a5.5 5.5 0 0 1-9.3 3.9L2 10" />
      <path d="M2 14v-4h4" />
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

export function NotebookIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
      <path d="M3.5 2.5h9v11h-9z" />
      <path d="M3.5 5.5h9M3.5 8.5h9M3.5 11.5h9" />
      <circle cx="1.5" cy="4.5" r="0.8" fill="currentColor" />
      <circle cx="1.5" cy="8" r="0.8" fill="currentColor" />
      <circle cx="1.5" cy="11.5" r="0.8" fill="currentColor" />
    </svg>
  );
}

export function UndoIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 3 2 6l3 3" />
      <path d="M2 6h7.5a4.5 4.5 0 0 1 0 9H6" />
    </svg>
  );
}

export function RedoIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m11 3 3 3-3 3" />
      <path d="M14 6H6.5a4.5 4.5 0 0 0 0 9H10" />
    </svg>
  );
}

export function ObjectiveIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
      <circle cx="8" cy="8" r="6.5" />
      <circle cx="8" cy="8" r="3.5" />
      <circle cx="8" cy="8" r="1" fill="currentColor" />
    </svg>
  );
}

export function FlowIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" aria-hidden="true">
      <rect x="1.5" y="6.5" width="4" height="4" rx="1" />
      <rect x="10.5" y="2.5" width="4" height="4" rx="1" />
      <rect x="10.5" y="10.5" width="4" height="4" rx="1" />
      <path d="M5.5 8.5h2.5v-4H10.5M8 8.5v4h2.5" />
    </svg>
  );
}

export function DatasetsIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
      <ellipse cx="8" cy="4" rx="5.5" ry="2.2" />
      <path d="M2.5 4v8c0 1.2 2.5 2.2 5.5 2.2s5.5-1 5.5-2.2V4" />
      <path d="M2.5 8c0 1.2 2.5 2.2 5.5 2.2s5.5-1 5.5-2.2" />
    </svg>
  );
}

export function NotebooksIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
      <path d="M3.5 2.5h9v11h-9z" />
      <path d="M3.5 6h9M3.5 9h9" />
      <circle cx="1.5" cy="4.5" r="0.8" fill="currentColor" />
      <circle cx="1.5" cy="8" r="0.8" fill="currentColor" />
      <circle cx="1.5" cy="11.5" r="0.8" fill="currentColor" />
    </svg>
  );
}

export function MethodologyIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 1.8L14.2 8 8 14.2 1.8 8z" />
      <circle cx="8" cy="8" r="2" />
    </svg>
  );
}

export function ExperimentsIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
      <path d="M6 2h4M7 2v4L3.5 12.5A1.5 1.5 0 0 0 4.8 14.5h6.4a1.5 1.5 0 0 0 1.3-2L9 6V2" />
      <path d="M4.8 11h6.4" />
    </svg>
  );
}

export function DeployIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4.5 13.5h7a3 3 0 0 0 .5-5.9 4 4 0 0 0-7.8-1 2.5 2.5 0 0 0 .3 6.9z" />
    </svg>
  );
}

export function ReportsIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2.5" y="2" width="11" height="12" rx="1.5" />
      <path d="M5.5 5.5h5M5.5 8.5h5M5.5 11.5h3" />
    </svg>
  );
}

export function SettingsIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8" cy="8" r="2.5" />
      <path d="M8 1.5v1.8M8 12.7v1.8M1.5 8h1.8M12.7 8h1.8M3.4 3.4l1.3 1.3M11.3 11.3l1.3 1.3M3.4 12.6l1.3-1.3M11.3 4.7l1.3-1.3" />
    </svg>
  );
}

export function PanelToggleIcon({
  size = 14,
  style,
  className,
}: {
  size?: number;
  style?: React.CSSProperties;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
      className={className}
    >
      <rect x="1.75" y="2.5" width="12.5" height="11" rx="1.5" />
      <path d="M10 2.5v11" />
      <path d="M5 6.5L6.5 8 5 9.5" />
    </svg>
  );
}

