import { useEffect } from "react";

/** Calls `onEscape` when Escape is pressed, while `active`: closes menus and dialogs. */
export function useEscape(onEscape: () => void, active = true) {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onEscape();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onEscape, active]);
}
