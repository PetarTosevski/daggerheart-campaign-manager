"use client";

import { useMutation, useQuery } from "convex/react";

import { derivedTraits } from "@/lib/domain/characters/derived";
import { withEffects } from "@/lib/domain/characters/effects";
import { TRAIT_IDS, type TraitId } from "@/lib/srd/types";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { equippedWeapons } from "../../actions/attack";
import { extraTargets, offersSpiritWeapon, picksTrait, sheetMods } from "../../actions/attack/mods";
import { seenTargets, useActor, useCombatTargets, useTargetHints, type WeaponSlot } from "../../actions/targets";
import type { CombatPageState } from "../../slots";
import { usePick } from "../pick";
import { hudResults, showAttackOutcome } from "../result";
import { attackSession, attackSessionId, bandsFrom, forcedRows, initialData, weaponOf, type AttackInput, type ForcedAttack } from "./model";
import { attackReports } from "./report";
import { AttackRows } from "./rows";

/**
 * The entry point of the HUD's weapon attack picker (plan combat-hud H3.2), for H3.4's action ring and this tracer's
 * own interim button and forced-attack card:
 *
 *   const attack = useAttackPicker(state);
 *   <button disabled={!attack.ready} onClick={() => attack.open()}>Attack</button>
 *   attack.open({ slot: "secondary" });            // start on the off-hand weapon
 *   attack.open({ forcedRequestId });              // answer a forced attack (targets locked)
 *
 * Call it inside the HUD shell (it uses `usePick()`), for the player's own character on the live map. `open` must run
 * from a click handler (it opens a pick session). `ready` is false while the sheet, riders, hints or forced attacks
 * load, for the GM, and without a token or a weapon (`reason` says which).
 */

export type AttackPickerOptions = {
  /** The weapon the panel starts on (default: the primary). */
  slot?: WeaponSlot;
  /** Answer this forced attack (`combatRequests.forcedAttacks`): its targets are picked and locked. */
  forcedRequestId?: Id<"combatRequests">;
};

export type AttackPicker = {
  ready: boolean;
  /** Why it can't open: "Loading your weapons…", "No weapon equipped"; null when ready (or not a player's map). */
  reason: string | null;
  open: (options?: AttackPickerOptions) => void;
  /** The weapon attack session (not a forced one) is open. */
  isOpen: boolean;
  /** Forced attacks waiting on the character, oldest first. */
  forced: readonly ForcedAttack[];
  characterId: Id<"characters"> | null;
};

const isTrait = (t: string): t is TraitId => (TRAIT_IDS as readonly string[]).includes(t);

export function useAttackPicker(state: CombatPageState): AttackPicker {
  const pick = usePick();
  const actor = useActor(state);
  const { campaignId } = state;
  const characterId = state.role === "player" ? (actor?.characterId ?? null) : null;
  const mapId = state.map?._id ?? null;
  const on = characterId !== null && mapId !== null;
  const character = useQuery(api.characters.get, on ? { characterId } : "skip");
  const weapons = character ? equippedWeapons(character.sheet) : [];
  const hasSecondary = weapons.some((w) => w.slot === "secondary");
  const ridersPrimary = useQuery(api.combatActions.riders, on ? { campaignId, characterId, slot: "primary" } : "skip");
  const ridersSecondary = useQuery(api.combatActions.riders, on && hasSecondary ? { campaignId, characterId, slot: "secondary" } : "skip");
  const hints = useTargetHints(campaignId, on ? characterId : null, mapId ?? ("" as Id<"combatMaps">), "primary");
  const forcedAll = useQuery(api.combatRequests.forcedAttacks, on ? { campaignId } : "skip");
  const attack = useMutation(api.combatActions.attack);
  const { targetTokenIds } = useCombatTargets();

  const forced = (forcedAll ?? []).filter((r) => r.characterId === characterId);
  const loading = on && (character === undefined || ridersPrimary === undefined || (hasSecondary && ridersSecondary === undefined) || hints === undefined || forcedAll === undefined);
  const reason = !on ? null : loading ? "Loading your weapons…" : character === null || weapons.length === 0 ? "No weapon equipped" : null;
  const ready = on && reason === null;

  function open(options: AttackPickerOptions = {}) {
    if (!ready || !character || !actor || characterId === null || mapId === null) return;
    const sheet = character.sheet;
    const names = new Map<string, string>([...actor.view.pcs, ...actor.view.others].map((t) => [t._id, t.name]));
    const mods = sheetMods(sheet);
    const traitPick: AttackInput["traitPick"] = {};
    const traitDefault: AttackInput["traitDefault"] = {};
    const spirit: AttackInput["spirit"] = {};
    for (const { slot, weapon } of weapons) {
      traitPick[slot] = weapon.trait === "choice" || picksTrait(mods, slot);
      traitDefault[slot] = isTrait(weapon.trait) ? weapon.trait : "strength";
      spirit[slot] = offersSpiritWeapon(sheet, weapon);
    }
    const f = options.forcedRequestId ? (forced.find((r) => r.requestId === options.forcedRequestId) ?? null) : null;
    const input: AttackInput = {
      characterId,
      weapons,
      proficiency: sheet.proficiency,
      roller: { experiences: sheet.experiences, hope: sheet.hope },
      riders: { primary: ridersPrimary ?? [], ...(hasSecondary ? { secondary: ridersSecondary ?? [] } : {}) },
      traitPick,
      traitDefault,
      traitValues: derivedTraits(withEffects(sheet)),
      spirit,
      extraTargets: extraTargets(mods),
      hints: hints ?? [],
      forced: f,
      forcedRows: f ? forcedRows(f, bandsFrom(actor.view)) : null,
      picked: seenTargets(targetTokenIds, actor.enemies),
      attack: async (args) => {
        const out = await attack({ campaignId, characterId, mapId, ...args, modifier: 0, options: [], idempotencyKey: crypto.randomUUID() });
        // H4.1: the result panel shows a resolved attack; a held one is named for "Your roll waits".
        showAttackOutcome({ characterId, actorName: sheet.name, weapon: weaponOf({ weapons }, args.slot)?.weapon ?? null, names, out });
        return out;
      },
      onReport: attackReports.set,
      render: (ctx, input) => <AttackRows ctx={ctx} input={input} state={state} />,
    };
    attackReports.set(null);
    hudResults.clear();
    pick.open(attackSession(input, initialData(input, options.slot)));
  }

  return {
    ready,
    reason,
    open,
    isOpen: characterId !== null && pick.session?.spec.id === attackSessionId(characterId, null),
    forced,
    characterId,
  };
}
