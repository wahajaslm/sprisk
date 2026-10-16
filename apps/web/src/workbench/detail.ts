import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export const DETAIL_LEVELS = ["compact", "summary", "detail"] as const;
export type DetailLevel = (typeof DETAIL_LEVELS)[number];

/** Node size on the canvas for each level of detail. */
export const NODE_SIZE: Record<DetailLevel, { width: number; height: number }> = {
  compact: { width: 184, height: 52 },
  summary: { width: 232, height: 96 },
  detail: { width: 232, height: 176 },
};

type CanvasDetail = { level: DetailLevel; setLevel: (level: DetailLevel) => void };

/** How much each canvas node shows. A viewing preference, never provenance (rule 9). */
export const useCanvasDetail = create<CanvasDetail>()(
  persist((set) => ({ level: "summary", setLevel: (level) => set({ level }) }), {
    name: "sprisk.canvas-detail",
    storage: createJSONStorage(() => localStorage),
  }),
);

type InspectorDetail = { technical: boolean; setTechnical: (technical: boolean) => void };

/** Whether the Inspector shows technical details: media types, sizes, hashes, attempt ids. */
export const useInspectorDetail = create<InspectorDetail>()(
  persist((set) => ({ technical: false, setTechnical: (technical) => set({ technical }) }), {
    name: "sprisk.inspector-detail",
    storage: createJSONStorage(() => localStorage),
  }),
);
