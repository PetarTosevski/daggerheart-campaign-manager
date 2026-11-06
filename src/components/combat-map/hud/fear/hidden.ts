/**
 * GM Fear a player may not see (config R1, user Q3 changed 2026-11-04): with "Players see the GM's Fear" off the server
 * sends `fear: null` to players, and every place that shows the pool shows "?" with the Fear art kept. One home for the
 * mark and its spoken label, so the banner, the phone strip, the dashboard and the dice box read the same.
 */
export const FEAR_HIDDEN_MARK = "?";
export const FEAR_HIDDEN_LABEL = "Fear hidden by the GM";

/** The pool as shown: the number, or "?" when the GM hides it. */
export function fearShown(fear: number | null): string {
  return fear === null ? FEAR_HIDDEN_MARK : String(fear);
}
