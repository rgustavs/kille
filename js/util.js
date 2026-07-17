/**
 * Kille — shared utilities with no DOM or storage dependencies.
 */

/** Generate a short, reasonably unique ID. */
export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
