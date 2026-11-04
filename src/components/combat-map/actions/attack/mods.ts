import type { CardUse, Mod, Step } from "@/lib/domain/card-effects/types";
import { owned } from "@/lib/domain/feature-effects/owned";
import { rangeFromWeapon } from "@/lib/domain/combat-actions";
import { cardEffect } from "@/lib/srd/card-effects/index";
import { featureEffect } from "@/lib/srd/feature-effects/index";
import type { Weapon } from "@/lib/srd/types";

import type { CharacterView } from "../../../../../convex/characters";
import type { WeaponSlot } from "../targets/state";

/**
 * Plan lanes-2 wave 9, E1.3b (dcm-jkhp, dcm-xbtw): what the Attack bar reads from the sheet's live mods to offer the right
 * controls. The server decides (convex/lib/rolls.ts `liveMods`, convex/lib/combatActions.ts `weaponTraitFor` /
 * `extraTargetsOf` / `spiritWeaponOn`); this is only the client's view of the same entries, so a missing control never
 * lets the player send what the server refuses.
 */

type Sheet = CharacterView["sheet"];

export const SPIRIT_WEAPON_FEATURE = "subclass:divine-wielder:spirit-weapon";
const MAX_EXTRA_TARGETS = 4;

/** The features the sheet holds (a view without a subclass rank holds the foundation, as a new sheet does). */
function held(sheet: Sheet) {
  return owned({ ...sheet, subclassRank: sheet.subclassRank ?? "foundation", effects: sheet.effects ?? [], classState: sheet.classState ?? {} });
}

function nested(steps: readonly Step[]): Step[] {
  return steps.flatMap((s) => [
    s,
    ...(s.kind === "optional" || s.kind === "followUp" ? nested(s.steps) : []),
    ...(s.kind === "choose" ? s.options.flatMap((o) => nested(o.steps)) : []),
    ...(s.kind === "save" ? [...nested(s.onFail), ...nested(s.onSuccess)] : []),
    ...(s.kind === "check" ? [...nested(s.then), ...nested(s.otherwise)] : []),
  ]);
}

/**
 * The uses of the card a sheet effect came from (`card:<id>:n`, as the server's `cardIdOfEffect` reads it). A feature's
 * effect id is a hash the client doesn't resolve: no SRD feature effect carries a `weaponTrait` / `extraTargets` mod today.
 */
function entryOf(effectId: string): readonly CardUse[] {
  const m = /^card:([a-z0-9-]+):\d+$/.exec(effectId);
  return m === null ? [] : (cardEffect(m[1]!)?.uses ?? []);
}

/** Passive mods of the loadout cards and held features, then the mods of the sheet's card / feature effects. */
export function sheetMods(sheet: Sheet): Mod[] {
  const out: Mod[] = [];
  const passives = (uses: readonly CardUse[]) => {
    for (const u of uses) if (u.activation.kind === "passive" && u.mods) out.push(...u.mods);
  };
  for (const id of sheet.domainCards.loadout) passives(cardEffect(id)?.uses ?? []);
  for (const f of held(sheet)) passives(featureEffect(f.featureId)?.uses ?? []);
  for (const e of sheet.effects ?? []) {
    const label = e.text.split("; ")[0];
    for (const u of entryOf(e.id)) for (const s of nested(u.steps)) if (s.kind === "effect" && s.label === label) out.push(...s.mods);
  }
  return out;
}

/** dcm-jkhp (Versatile Fighter, CB p.330): whether the player picks the trait for this slot's weapon. */
export function picksTrait(mods: readonly Mod[], slot: WeaponSlot): boolean {
  return mods.some((m) => m.kind === "weaponTrait" && (m.weapon === "either" || m.weapon === slot) && m.choice !== undefined);
}

/** dcm-jkhp (Parallela, CB p.332): the extra targets a weapon attack may take. */
export function extraTargets(mods: readonly Mod[]): number {
  let n = 0;
  for (const m of mods) if (m.kind === "extraTargets" && (m.on === "attack" || m.on === "weaponAttack" || m.on === "any")) n += m.count.kind === "fixed" ? m.count.value : 1;
  return Math.max(0, Math.min(n, MAX_EXTRA_TARGETS));
}

/** dcm-xbtw (Spirit Weapon, CB p.44): the "Use as Spirit Weapon" box shows for a Melee / Very Close weapon while the feature is held. */
export function offersSpiritWeapon(sheet: Sheet, weapon: Pick<Weapon, "range">): boolean {
  const range = rangeFromWeapon(weapon.range);
  return (range === "melee" || range === "veryClose") && held(sheet).some((f) => f.featureId === SPIRIT_WEAPON_FEATURE);
}
