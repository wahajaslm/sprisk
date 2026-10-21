import type { ReactNode } from "react";

/** Clean minimalist vector artwork for stage cards, inspired by BQN platform's aesthetic:
 * - Explore: horizontal data stream scanlines fading out (accelerating/ingesting)
 * - Split: vertical partition capsules and boundary markings
 * - Clean: signal denoising wave passing through a threshold filter gate
 * - Model: estimator network architecture & decision boundary vectors
 * - Evaluate: wireframe performance line chart with peaks, troughs, and baseline grid
 */
export function StageArtwork({ stage }: { stage: string }): ReactNode {
  const norm = stage.toLowerCase();
  if (norm.includes("load") || norm.includes("explore")) return <ExploreArt />;
  if (norm.includes("split")) return <SplitArt />;
  if (norm.includes("clean")) return <CleanArt />;
  if (norm.includes("model")) return <ModelArt />;
  if (norm.includes("eval")) return <EvaluateArt />;
  return <GenericArt />;
}

export function stageDescription(stage: string): string {
  const norm = stage.toLowerCase();
  if (norm.includes("load")) return "Read the data and check it on all rows: types, missing values, profiles.";
  if (norm.includes("explore")) return "Look at the training rows only: how each column relates to the target.";
  if (norm.includes("split")) return "Stratified partition of observations into train and validation sets without leakage.";
  if (norm.includes("clean")) return "Signal noise suppression, outlier clipping, and adaptive spectral gating.";
  if (norm.includes("model")) return "Train estimators, optimize clustering parameters, and fit architecture.";
  if (norm.includes("eval")) return "Audit methodology checks, compute performance metrics, and validation scores.";
  return "Execute stage transformation steps and intermediate pipeline routines.";
}

export function stagePhaseTag(stage: string): string {
  const norm = stage.toLowerCase();
  if (norm.includes("load")) return "DATA INGESTION";
  if (norm.includes("explore")) return "EXPLORATION";
  if (norm.includes("split")) return "VALIDATION SPLIT";
  if (norm.includes("clean")) return "SIGNAL CLEANING";
  if (norm.includes("model")) return "MODEL ESTIMATION";
  if (norm.includes("eval")) return "METRIC EVALUATION";
  return "PIPELINE STAGE";
}

export function stageIndex(stage: string): string {
  const norm = stage.toLowerCase();
  if (norm.includes("load")) return "01";
  if (norm.includes("split")) return "02";
  if (norm.includes("explore")) return "03";
  if (norm.includes("clean")) return "04";
  if (norm.includes("model")) return "05";
  if (norm.includes("eval")) return "06";
  return "07";
}

function ExploreArt() {
  return (
    <svg viewBox="0 0 240 44" fill="none" className="stage-artwork" aria-hidden="true">
      <defs>
        <linearGradient id="exp-g1" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.85" />
          <stop offset="80%" stopColor="#ffffff" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="exp-g2" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.5" />
          <stop offset="70%" stopColor="#ffffff" stopOpacity="0.1" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <line x1="2" y1="6" x2="236" y2="6" stroke="url(#exp-g1)" strokeWidth="1.2" />
      <circle cx="5" cy="6" r="2" fill="#ffffff" fillOpacity="0.9" />
      <line x1="2" y1="14" x2="188" y2="14" stroke="url(#exp-g1)" strokeWidth="1" strokeOpacity="0.75" />
      <line x1="2" y1="22" x2="218" y2="22" stroke="url(#exp-g2)" strokeWidth="1" strokeOpacity="0.55" />
      <circle cx="5" cy="22" r="1.5" fill="#ffffff" fillOpacity="0.6" />
      <line x1="2" y1="30" x2="145" y2="30" stroke="url(#exp-g2)" strokeWidth="1" strokeOpacity="0.4" />
      <line x1="2" y1="38" x2="202" y2="38" stroke="url(#exp-g2)" strokeWidth="1" strokeOpacity="0.25" />
    </svg>
  );
}

function SplitArt() {
  return (
    <svg viewBox="0 0 240 44" fill="none" className="stage-artwork" aria-hidden="true">
      <rect x="8" y="4" width="28" height="34" rx="4" stroke="#ffffff" strokeWidth="1" strokeOpacity="0.8" fill="rgba(255,255,255,0.03)" />
      <rect x="44" y="4" width="28" height="34" rx="4" stroke="#ffffff" strokeWidth="1" strokeOpacity="0.65" fill="rgba(255,255,255,0.02)" />
      <rect x="80" y="4" width="28" height="34" rx="4" stroke="#ffffff" strokeWidth="1" strokeOpacity="0.5" fill="rgba(255,255,255,0.01)" />
      <rect x="116" y="4" width="28" height="34" rx="4" stroke="#ffffff" strokeWidth="1" strokeOpacity="0.35" />
      <rect x="152" y="4" width="28" height="34" rx="4" stroke="#ffffff" strokeWidth="1" strokeOpacity="0.22" />
      <rect x="188" y="4" width="28" height="34" rx="4" stroke="#ffffff" strokeWidth="1" strokeOpacity="0.12" />
      <line x1="8" y1="41" x2="108" y2="41" stroke="#ffffff" strokeWidth="1.5" strokeOpacity="0.75" />
      <line x1="116" y1="41" x2="216" y2="41" stroke="#ffffff" strokeWidth="1.5" strokeOpacity="0.25" strokeDasharray="3 3" />
    </svg>
  );
}

function CleanArt() {
  return (
    <svg viewBox="0 0 240 44" fill="none" className="stage-artwork" aria-hidden="true">
      <line x1="4" y1="22" x2="236" y2="22" stroke="rgba(255,255,255,0.1)" strokeWidth="0.8" strokeDasharray="2 3" />
      <path d="M4 22 L14 12 L22 30 L32 8 L42 34 L52 14 L62 28 L72 16 L82 26 L92 18 L102 22" stroke="rgba(255,255,255,0.38)" strokeWidth="1" />
      <line x1="108" y1="4" x2="108" y2="40" stroke="#ffffff" strokeWidth="1.2" strokeOpacity="0.75" />
      <circle cx="108" cy="22" r="3" fill="#ffffff" fillOpacity="0.9" />
      <path d="M114 22 Q128 8 142 22 T170 22 T198 22 T226 22" stroke="#ffffff" strokeWidth="1.3" strokeOpacity="0.85" />
    </svg>
  );
}

function ModelArt() {
  return (
    <svg viewBox="0 0 240 44" fill="none" className="stage-artwork" aria-hidden="true">
      <circle cx="28" cy="14" r="3" stroke="#ffffff" strokeWidth="1" strokeOpacity="0.7" />
      <circle cx="28" cy="30" r="3" stroke="#ffffff" strokeWidth="1" strokeOpacity="0.7" />
      <circle cx="96" cy="10" r="3" stroke="#ffffff" strokeWidth="1" strokeOpacity="0.85" />
      <circle cx="96" cy="22" r="3.5" fill="#ffffff" fillOpacity="0.95" />
      <circle cx="96" cy="34" r="3" stroke="#ffffff" strokeWidth="1" strokeOpacity="0.85" />
      <circle cx="174" cy="16" r="3" stroke="#ffffff" strokeWidth="1" strokeOpacity="0.7" />
      <circle cx="174" cy="28" r="3" stroke="#ffffff" strokeWidth="1" strokeOpacity="0.7" />
      <line x1="31" y1="14" x2="93" y2="10" stroke="rgba(255,255,255,0.2)" strokeWidth="0.8" />
      <line x1="31" y1="14" x2="93" y2="22" stroke="rgba(255,255,255,0.3)" strokeWidth="0.8" />
      <line x1="31" y1="30" x2="93" y2="22" stroke="rgba(255,255,255,0.3)" strokeWidth="0.8" />
      <line x1="31" y1="30" x2="93" y2="34" stroke="rgba(255,255,255,0.2)" strokeWidth="0.8" />
      <line x1="99.5" y1="22" x2="171" y2="16" stroke="rgba(255,255,255,0.4)" strokeWidth="1" />
      <line x1="99.5" y1="22" x2="171" y2="28" stroke="rgba(255,255,255,0.4)" strokeWidth="1" />
      <path d="M192 8 L228 36" stroke="#ffffff" strokeWidth="1.2" strokeOpacity="0.6" strokeDasharray="3 2" />
    </svg>
  );
}

function EvaluateArt() {
  return (
    <svg viewBox="0 0 240 44" fill="none" className="stage-artwork" aria-hidden="true">
      <line x1="8" y1="12" x2="232" y2="12" stroke="rgba(255,255,255,0.08)" strokeWidth="0.8" />
      <line x1="8" y1="24" x2="232" y2="24" stroke="rgba(255,255,255,0.08)" strokeWidth="0.8" />
      <line x1="8" y1="36" x2="232" y2="36" stroke="rgba(255,255,255,0.12)" strokeWidth="0.8" />
      <polyline points="10,32 50,26 95,30 145,20 185,22 228,14" fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="1" strokeDasharray="2 2" />
      <polyline points="10,28 58,10 108,32 158,18 198,8 228,6" fill="none" stroke="#ffffff" strokeWidth="1.4" strokeOpacity="0.9" />
      <circle cx="58" cy="10" r="2.5" fill="#ffffff" />
      <circle cx="108" cy="32" r="2" fill="#ffffff" fillOpacity="0.8" />
      <circle cx="158" cy="18" r="2.5" fill="#ffffff" />
      <circle cx="198" cy="8" r="2.5" fill="#ffffff" />
    </svg>
  );
}

function GenericArt() {
  return (
    <svg viewBox="0 0 240 44" fill="none" className="stage-artwork" aria-hidden="true">
      <line x1="10" y1="12" x2="230" y2="12" stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
      <line x1="10" y1="22" x2="230" y2="22" stroke="rgba(255,255,255,0.18)" strokeWidth="1" />
      <line x1="10" y1="32" x2="230" y2="32" stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
      <circle cx="30" cy="22" r="3" fill="#ffffff" fillOpacity="0.7" />
      <circle cx="120" cy="22" r="3" fill="#ffffff" fillOpacity="0.7" />
      <circle cx="210" cy="22" r="3" fill="#ffffff" fillOpacity="0.7" />
    </svg>
  );
}
