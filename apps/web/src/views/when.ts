/** A moment for people, as lists show it: "Oct 24 · 14:02", in the viewer's locale. */
export function when(timestamp: string): string {
  const d = new Date(timestamp);
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} · ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
}
