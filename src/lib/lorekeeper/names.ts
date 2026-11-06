/** The roster (`members.roster`) as names by user id, to name the askers of shared conversations (L3 note). */
export function askerNames(
  roster: { gm: { userId: string; name: string }; players: readonly { userId: string; name: string }[] } | undefined,
): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  if (roster === undefined) return names;
  names.set(roster.gm.userId, roster.gm.name);
  for (const player of roster.players) names.set(player.userId, player.name);
  return names;
}
