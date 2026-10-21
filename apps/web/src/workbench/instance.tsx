import { createContext, type ReactNode, useContext } from "react";

import type { InspectorTab } from "./inspectorTabs.ts";
import { useSelection } from "./selection.ts";

/** A panel either follows the shared selection or is pinned to one step and the run it shows (arch §2A); a stage notebook pins each cell to its step, with no run before the flow ran (ADR-0055). */
export type Pin = { runId: string | undefined; nodeId: string | undefined };

/** `tab` is set only on a panel that shows one Inspector tab. */
type Instance = { pin: Pin | undefined; setPin: ((pin: Pin | undefined) => void) | undefined; tab?: InspectorTab | undefined };

const InstanceContext = createContext<Instance>({ pin: undefined, setPin: undefined });

export function ViewInstance({ pin, setPin, tab, children }: Instance & { children: ReactNode }) {
  return <InstanceContext.Provider value={{ pin, setPin, tab }}>{children}</InstanceContext.Provider>;
}

export const useViewInstance = () => useContext(InstanceContext);

/** The selection this panel shows: its pin when pinned, the shared selection otherwise. */
export function useViewSelection() {
  const selection = useSelection();
  const { pin } = useViewInstance();
  return pin ? { ...selection, runId: pin.runId, nodeId: pin.nodeId } : selection;
}

/** Saved layouts are untrusted preference data; accept only a well-formed pin. */
export function readPin(params: unknown): Pin | undefined {
  if (typeof params !== "object" || params === null || !("pin" in params)) return undefined;
  const pin: unknown = params.pin;
  if (typeof pin !== "object" || pin === null || !("runId" in pin) || typeof pin.runId !== "string") return undefined;
  const nodeId = "nodeId" in pin && typeof pin.nodeId === "string" ? pin.nodeId : undefined;
  return { runId: pin.runId, nodeId };
}
