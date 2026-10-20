import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export const DETAIL_LEVELS = ["compact", "detail"] as const;
export type DetailLevel = (typeof DETAIL_LEVELS)[number];

/** Node size on the canvas for each level of detail. */
export const NODE_SIZE: Record<DetailLevel, { width: number; height: number }> = {
  compact: { width: 200, height: 44 },
  detail: { width: 248, height: 176 },
};

/** Stored preferences are untrusted; anything else (e.g. the removed "summary") opens as Detail. */
export const readLevel = (value: unknown): DetailLevel => (value === "compact" ? "compact" : "detail");

type CanvasDetail = { level: DetailLevel; setLevel: (level: DetailLevel) => void };

/** How much each canvas node shows. A viewing preference, never provenance (rule 9). */
export const useCanvasDetail = create<CanvasDetail>()(
  persist((set) => ({ level: "detail", setLevel: (level) => set({ level }) }), {
    name: "sprisk.canvas-detail",
    storage: createJSONStorage(() => localStorage),
    merge: (stored, current) => ({
      ...current,
      level: readLevel(typeof stored === "object" && stored !== null && "level" in stored ? stored.level : undefined),
    }),
  }),
);

export type ResultLayout = "inline" | "grid";
type ResultLayoutState = { layout: ResultLayout; setLayout: (layout: ResultLayout) => void };

/** How a step's shown results are arranged. Presentation only; nothing re-runs. */
export const useResultLayout = create<ResultLayoutState>()(
  persist((set) => ({ layout: "inline", setLayout: (layout) => set({ layout }) }), {
    name: "sprisk.result-layout",
    storage: createJSONStorage(() => localStorage),
  }),
);
