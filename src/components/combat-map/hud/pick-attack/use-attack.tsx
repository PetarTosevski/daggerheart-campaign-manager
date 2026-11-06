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
import { attackSession, attackSessionId, bandsFrom, conflictRows, forcedRows, initialData, weaponOf, type AttackInput, type ForcedAttack } from "./model";
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
 * Call it inside the HUD shell (it uses `usePick()`), for the player's own character on the live map, or for the GM
 * with the PC played for (`useAttackPicker(state, characterId)`, hud-pre-w9). `open` must run from a click handler (it
 * opens a pick session). `ready` is false while the sheet, riders, hints or forced attacks load, for the GM without a
 * PC (or off the live map), and without a token or a weapon (`reason` says which).
 */

export type AttackPickerOptions = {
  /** The weapon the panel starts on (default: the primary). */
  slot?: WeaponSlot;
  /** Answer this forced attack (`combatRequestsReads.forcedAttacks`): its targets are picked and locked. */
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
  /** The equipped weapons (slot and name), for a "per weapon" entry such as the GM's sheet buttons. */
  weapons: readonly { slot: WeaponSlot; name: string }[];
};

/** What the picker reads of the page: the HUD's state, or the sheet panel's props (campaign, role, map). */
export type AttackState = Pick<CombatPageState, "campaignId" | "role" | "mode" | "map" | "previewCharacterId">;

const isTrait = (t: string): t is TraitId => (TRAIT_IDS as readonly string[]).includes(t);

/**
 * `playFor` (hud-pre-w9, dcm-bxp.99.32.36): the GM's picker for the PC whose sheet is open, while "Play for this
 * character" is on (the caller checks the switch). The session names that PC's token as its `actor`; the creatures,
 * names and bands come from the map's tokens (`combatTokensReads.list`, the GM's read), and `combatActions.attack` is sent
 * with that `characterId` (the server lets the GM act for any PC: `loadCharacter(..., "edit")`). Ignored for a player.
 */
export function useAttackPicker(state: AttackState, playFor: Id<"characters"> | null = null): AttackPicker {
  const pick = usePick();
  const actor = useActor(state);
  const { campaignId } = state;
  const gm = state.role === "gm";
  const characterId = gm ? playFor : state.role === "player" ? (actor?.characterId ?? null) : null;
  // The attack needs the live map (`attackScene`); the GM may be looking at another one.
  const mapId = state.map !== null && (!gm || state.map.live) ? state.map._id : null;
  const on = characterId !== null && mapId !== null;
  const gmTokens = useQuery(api.combatTokensReads.list, gm && on ? { campaignId, mapId } : "skip");
  const self = gm ? (gmTokens?.find((t) => t.characterId === characterId) ?? null) : null;
  const character = useQuery(api.charactersReads.get, on ? { characterId } : "skip");
  const weapons = character ? equippedWeapons(character.sheet) : [];
  const hasSecondary = weapons.some((w) => w.slot === "secondary");
  const ridersPrimary = useQuery(api.combatActionsReads.riders, on ? { campaignId, characterId, slot: "primary" } : "skip");
  const ridersSecondary = useQuery(api.combatActionsReads.riders, on && hasSecondary ? { campaignId, characterId, slot: "secondary" } : "skip");
  const hints = useTargetHints(campaignId, on ? characterId : null, mapId ?? ("" as Id<"combatMaps">), "primary");
  const forcedAll = useQuery(api.combatRequestsReads.forcedAttacks, on ? { campaignId } : "skip");
  // Plan rule-switches OP: "Conflict between PCs" (CB p.168) lets the attack take another PC; off until loaded.
  const ruleModes = useQuery(api.ruleSettings.get, on ? { campaignId } : "skip")?.modes;
  const attack = useMutation(api.combatActions.attack);
  const { targetTokenIds } = useCombatTargets();

  const forced = (forcedAll ?? []).filter((r) => r.characterId === characterId);
  const loading =
    on && (character === undefined || ridersPrimary === undefined || (hasSecondary && ridersSecondary === undefined) || hints === undefined || forcedAll === undefined || (gm && gmTokens === undefined));
  const offLive = gm && characterId !== null && state.map !== null && !state.map.live;
  const reason = !on ? (offLive ? "Not on the live map" : null) : loading ? "Loading your weapons…" : character === null || weapons.length === 0 ? "No weapon equipped" : gm && self === null ? "Not on the map" : null;
  const ready = on && reason === null;

  /** Who acts and what they see: the player's own view, or (GM) the map's tokens around the PC's token. */
  function scene() {
    if (gm) {
      if (!gmTokens || !self) return null;
      const pcs = gmTokens.filter((t) => t.side === "pc");
      const others = gmTokens.filter((t) => t.side !== "pc");
      return {
        view: { tokenId: self._id, pcs, others },
        enemies: others.filter((t) => t.side === "enemy"),
        allies: pcs.filter((t) => t._id !== self._id),
        actor: { tokenId: self._id, characterId: characterId! },
      };
    }
    if (!actor) return null;
    return { view: actor.view, enemies: actor.enemies, allies: actor.view.others.filter((t) => t.side === "pc"), actor: null };
  }

  function open(options: AttackPickerOptions = {}) {
    const seen = scene();
    if (!ready || !character || !seen || characterId === null || mapId === null) return;
    const sheet = character.sheet;
    const names = new Map<string, string>([...seen.view.pcs, ...seen.view.others].map((t) => [t._id, t.name]));
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
      forcedRows: f ? forcedRows(f, bandsFrom(seen.view)) : null,
      conflictRows: !f && ruleModes?.pcConflict === true ? conflictRows(bandsFrom(seen.view), hints ?? [], ruleModes.lineOfSight) : null,
      picked: seenTargets(targetTokenIds, seen.enemies),
      ...(seen.actor ? { actor: seen.actor, others: { enemies: seen.enemies, allies: seen.allies } } : {}),
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
    weapons: weapons.map((w) => ({ slot: w.slot, name: w.weapon.name })),
  };
}
