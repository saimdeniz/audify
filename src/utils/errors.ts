/**
 * Central, non-throwing error logger for fire-and-forget async work.
 *
 * Replaces silent `.catch(() => {})` so failures at least leave a trace in the console
 * (visible via DevTools) instead of vanishing. Use `onError("what failed")` as a catch handler.
 */
export function onError(context: string): (err: unknown) => void {
  return (err: unknown) => {
    console.warn(`[Audify] ${context} failed:`, err);
  };
}
