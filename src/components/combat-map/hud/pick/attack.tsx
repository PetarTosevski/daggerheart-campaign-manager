"use client";

import type { Id } from "../../../../../convex/_generated/dataModel";
import type { WeaponSlot } from "../../actions/targets";
import type { PickOutcome, PickSessionSpec } from "./types";

/**
 * A plain weapon attack as a pick session (plan combat-hud H3.0): the reference picker for the pick-session API (the
 * action ring's Attack opens H3.2's full attack picker, built on it). One enemy within the weapon's range (CB p.96, user answer 2026-10-22: "each attack roll can
 * only target one adversary"); out of range goes to the GM (`combatActions.attack` answers `pending`).
 */

export type PlainAttack = {
  campaignId: Id<"campaigns">;
  mapId: Id<"combatMaps">;
  characterId: Id<"characters">;
  slot: WeaponSlot;
  weaponName: string;
  /** Enemies already picked on the map (the latest becomes the pick). */
  picked: readonly Id<"combatTokens">[];
  /** Sends the attack; resolves to what the server answered. */
  attack: (args: { targetTokenIds: Id<"combatTokens">[]; slot: WeaponSlot }) => Promise<{ status: "resolved"; targets: readonly { hit: boolean; defeated: boolean }[] } | { status: "pending"; requestId: Id<"combatRequests"> } | { status: "awaiting" }>;
  /** What the attack did, for the caller to show ("Hit", "Miss", "Defeated", "Waiting"). */
  onResult: (text: string) => void;
};

/** The session spec of a plain weapon attack (exported for the unit tests and as H3.2's starting point). */
export function plainAttackSession(a: PlainAttack): PickSessionSpec {
  return {
    id: `attack:${a.characterId}:${a.slot}`,
    source: { kind: "attack", name: a.weaponName },
    rule: { side: "enemy", max: 1, range: "weapon", slot: a.slot },
    picked: a.picked.slice(-1),
    primary: {
      label: (s) => (s.targets[0] ? `Attack ${s.targets[0].name}` : `Attack with ${a.weaponName}`),
      send: async (s): Promise<PickOutcome> => {
        const out = await a.attack({ targetTokenIds: [...s.targetIds], slot: a.slot });
        if (out.status === "pending") return { kind: "pending", requestId: out.requestId };
        if (out.status === "awaiting") {
          a.onResult("Your roll waits: answer it in Map tools");
          return { kind: "done" };
        }
        // Players see Hit / Miss / Defeated only (HANDOFF hard rule 2).
        const t = out.targets[0];
        a.onResult(t ? (t.defeated ? "Defeated" : t.hit ? "Hit" : "Miss") : "Done");
        return { kind: "done" };
      },
    },
  };
}
