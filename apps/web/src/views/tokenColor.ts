/** A Studio colour token's current value, for chart libraries that take plain colours. */
export function tokenColor(token: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(token).trim();
}
