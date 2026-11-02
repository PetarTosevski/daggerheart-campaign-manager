"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { equippedWeapons } from "../../actions/attack";
import { seenTargets, useActor, useCombatTargets, type WeaponSlot } from "../../actions/targets";
import type { CombatPageState } from "../../slots";
import { hudButtonClass } from "../ui";
import { usePick } from "./session";
import type { PickOutcome, PickSessionSpec } from "./types";

/**
 * A plain weapon attack as a pick session (plan combat-hud H3.0): the reference picker for the pick-session API and the
 * HUD's interim way to attack until the action ring's Attack (H3.4) opens H3.2's full attack picker (weapon tiles,
 * roll options, riders). One enemy within the weapon's range (CB p.96, user answer 2026-10-22: "each attack roll can
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
  /** What the attack did, for the line beside the launcher ("Hit", "Miss", "Defeated", "Waiting"). */
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

/**
 * The interim Attack button (player, a token on the live map): opens the plain attack session with the enemy picked
 * on the map, if any. H3.4's action ring replaces it (bead filed; see the task doc).
 */
export function PickLauncher({ state }: { state: CombatPageState }) {
  const actor = useActor(state);
  if (state.role !== "player" || !actor || state.map === null) return null;
  return <Launcher state={state} characterId={actor.characterId} enemies={actor.enemies} mapId={state.map._id} />;
}

function Launcher({ state, characterId, enemies, mapId }: { state: CombatPageState; characterId: Id<"characters">; enemies: readonly { _id: Id<"combatTokens"> }[]; mapId: Id<"combatMaps"> }) {
  const pick = usePick();
  const { targetTokenIds } = useCombatTargets();
  const character = useQuery(api.characters.get, { characterId });
  const attack = useMutation(api.combatActions.attack);
  const [result, setResult] = useState<string | null>(null);
  const weapon = character ? equippedWeapons(character.sheet)[0] : undefined;
  if (!weapon) return null;
  const open = pick.session?.spec.source.kind === "attack";

  return (
    <div className="hud-pk-launch">
      {result ? (
        <span className="hud-pk-launch-res" role="status" data-testid="hud-pick-result">
          {result}
        </span>
      ) : null}
      <button
        type="button"
        className={hudButtonClass(open ? "primary" : "secondary")}
        aria-pressed={open}
        data-testid="hud-pick-attack"
        onClick={() => {
          if (open) {
            pick.cancel();
            return;
          }
          setResult(null);
          pick.open(
            plainAttackSession({
              campaignId: state.campaignId,
              mapId,
              characterId,
              slot: weapon.slot,
              weaponName: weapon.weapon.name,
              picked: seenTargets(targetTokenIds, enemies),
              attack: ({ targetTokenIds: ids, slot }) =>
                attack({
                  campaignId: state.campaignId,
                  characterId,
                  mapId,
                  targetTokenIds: ids,
                  slot,
                  modifier: 0,
                  experienceIds: [],
                  advantage: 0,
                  disadvantage: 0,
                  help: 0,
                  options: [],
                  idempotencyKey: crypto.randomUUID(),
                }),
              onResult: setResult,
            }),
          );
        }}
      >
        Attack
      </button>
    </div>
  );
}
