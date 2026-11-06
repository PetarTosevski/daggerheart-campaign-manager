/** A countdown row as the list needs it: its id and, for a chase row, its partner and side (countdowns-advanced D9). */
export type ListedCountdown = {
  _id: string;
  chase: { partnerId: string; side: "party" | "rivals" } | null;
};

/** One card of the countdown list: a single countdown, or a chase pair (either side may be missing). */
export type CountdownItem<C> = { kind: "single"; countdown: C } | { kind: "chase"; party?: C; rivals?: C };

/**
 * The list's cards in order: a chase pair becomes ONE item where its first row stands; a row whose partner isn't in
 * the list (a player can't see it) still shows as a chase on its own. Shared by the website and the phone app.
 */
export function listItems<C extends ListedCountdown>(countdowns: readonly C[]): CountdownItem<C>[] {
  const byId = new Map(countdowns.map((c) => [c._id, c]));
  const placed = new Set<string>();
  const items: CountdownItem<C>[] = [];
  for (const c of countdowns) {
    if (placed.has(c._id)) continue;
    if (c.chase === null) {
      items.push({ kind: "single", countdown: c });
      continue;
    }
    const partner = byId.get(c.chase.partnerId);
    placed.add(c._id);
    if (partner !== undefined) placed.add(partner._id);
    items.push(c.chase.side === "party" ? { kind: "chase", party: c, rivals: partner } : { kind: "chase", party: partner, rivals: c });
  }
  return items;
}
