// The Defense the Motherboard's installed augments add (Guard, Deny, Block; Core Book pp.301-303). Split out of
// ./motherboard (which re-exports it, dcm-uh6r) so the character derivations every sheet read uses load without zod.

const DEFENSE: Readonly<Record<string, { armorScore: number; evasion: number }>> = {
  guard: { armorScore: 1, evasion: 0 },
  deny: { armorScore: 2, evasion: 0 },
  block: { armorScore: 3, evasion: -1 },
};

export function augmentDefense(installed: readonly string[]): { armorScore: number; evasion: number } {
  return installed.reduce(
    (sum, id) => ({ armorScore: sum.armorScore + (DEFENSE[id]?.armorScore ?? 0), evasion: sum.evasion + (DEFENSE[id]?.evasion ?? 0) }),
    { armorScore: 0, evasion: 0 },
  );
}
