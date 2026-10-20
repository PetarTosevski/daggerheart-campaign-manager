// The Combat Map's '+ Session encounter' title (D10 S1, board rule B11). Pure module.
//
// B11: "uses the live session, else the newest planned one; disabled with the title 'No planned session with an
// encounter'; enabled title 'Session N: 2× Bruiser, 1× Leader'". Combat board l.767:
//   sessTitle: sess ? 'Session ' + sess.n + ': ' + (roles.map(([k, n]) => n + '× ' + ROLE_LABEL[k]).join(', ')
//     || 'no adversaries planned') : 'No planned session with an encounter'
// The order is the board's role order (Sessions board ROLES: Minion group, Social, Support, Horde, Ranged, Skulk,
// Standard, Leader, Bruiser, Solo; the Battle Points cost order of CB p.197). A D8 Minion group is one instance
// ("Spend 1 point for each group of Minions equal to the size of the party", CB p.197), so it counts as one entry.
// Which session and which instances (e.g. unplaced, undefeated) is the caller's choice (S8).
//
// ```ts
// sessionEncounterTitle({ n: 3, instances: [{ type: "Bruiser" }, { type: "Leader" }, { type: "Bruiser" }] });
// // "Session 3: 1× Leader, 2× Bruiser" (B11's example "2× Bruiser, 1× Leader" is the board's insertion order)
// sessionEncounterTitle(null); // "No planned session with an encounter"
// ```

import type { AdversaryType } from "../../srd/types";

export const NO_SESSION_ENCOUNTER = "No planned session with an encounter";

/** The board's role order with its labels (Sessions board ROLES; Minions as groups). */
export const ENCOUNTER_ROLE_ORDER: readonly { type: AdversaryType; label: string }[] = [
  { type: "Minion", label: "Minion group" },
  { type: "Social", label: "Social" },
  { type: "Support", label: "Support" },
  { type: "Horde", label: "Horde" },
  { type: "Ranged", label: "Ranged" },
  { type: "Skulk", label: "Skulk" },
  { type: "Standard", label: "Standard" },
  { type: "Leader", label: "Leader" },
  { type: "Bruiser", label: "Bruiser" },
  { type: "Solo", label: "Solo" },
];

/** One encounter instance (`encounterAdversaries` row, its type resolved from its source). null = unknown type. */
export type EncounterTitleEntry = { type: AdversaryType | null };

/** '2× Bruiser, 1× Leader' in the board's order; unknown types last as 'Adversary'; '' for no instances. */
export function encounterRoleList(instances: readonly EncounterTitleEntry[]): string {
  const counts = new Map<AdversaryType | null, number>();
  for (const i of instances) counts.set(i.type, (counts.get(i.type) ?? 0) + 1);
  const parts = ENCOUNTER_ROLE_ORDER.filter((r) => counts.has(r.type)).map((r) => `${counts.get(r.type)}× ${r.label}`);
  if (counts.has(null)) parts.push(`${counts.get(null)}× Adversary`);
  return parts.join(", ");
}

/**
 * The button's title: 'Session N: <role list>' ('Session N: no adversaries planned' when the encounter has none, the
 * board's copy), or 'No planned session with an encounter' for null (no session, or no linked encounter).
 */
export function sessionEncounterTitle(input: { n: number; instances: readonly EncounterTitleEntry[] } | null): string {
  if (!input) return NO_SESSION_ENCOUNTER;
  return `Session ${input.n}: ${encounterRoleList(input.instances) || "no adversaries planned"}`;
}
