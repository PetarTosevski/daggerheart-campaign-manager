// Slayer Dice (Call of the Slayer foundation, CB 48). Pure: bundled into Convex.
//
// "You gain a pool of dice called Slayer Dice. On a roll with Hope, you can place a d6 on this card instead of
// gaining a Hope, adding the die to the pool. You can store a number of Slayer Dice equal to your Proficiency.
// When you make an attack roll or damage roll, you can spend any number of these Slayer Dice, rolling them and
// adding their result to the roll. At the end of each session, clear any unspent Slayer Dice on this card and gain
// a Hope per die cleared."
//
// K5: a critical counts as a roll with Hope (CB 90), so it offers the choice too; storing replaces only the Hope,
// the critical's cleared Stress stays. Reaction rolls generate no Hope (CB 99), so they never offer it.
//
// Weapon Specialist (Call of the Slayer specialization, CB 48): "once per long rest when you roll your Slayer Dice,
// reroll any 1s" (dcm-bxp.62, user 2026-10-22: automated in the dice roller). `rerollSlayerOnes` rerolls each 1 once
// (a rerolled 1 stands) and marks the featureUses entry `weaponSpecialistReroll` until "longRest". A roll without a
// 1 rerolls nothing and keeps the use.
import { RuleError } from "../../errors/app-error";
import { applyResourceDelta, hopeMax } from "../characters/index";
import type { RollKind, RollOutcome } from "../duality";
import type { CharacterSheet } from "../../validation/characters";
import type { Rng } from "../class-features/types";
import { holdsSlayerFeature, holdsWeaponSpecialist } from "./holders";
import { featuresOf, withFeatures } from "./state";

/** Slayer Dice are d6s. */
export const SLAYER_DIE_SIDES = 6;

/** The outcomes that are "a roll with Hope" (CB 18, 90): a critical counts. */
export const WITH_HOPE: readonly RollOutcome[] = ["critical", "successHope", "failHope"];

type SlayerSheet = Pick<CharacterSheet, "subclassId" | "multiclass" | "proficiency" | "sessionFeatures">;

/** How many Slayer Dice the sheet may store: its Proficiency (K2). */
export function slayerCapacity(sheet: Pick<CharacterSheet, "proficiency">): number {
  return sheet.proficiency;
}

/** The Slayer Dice held now (0 for an old sheet). A lowered Proficiency trims nothing already held. */
export function slayerDice(sheet: Pick<CharacterSheet, "sessionFeatures">): number {
  return featuresOf(sheet).slayerDice ?? 0;
}

/**
 * Whether a finished roll offers the Slayer choice: the sheet holds Slayer, the roll is an ACTION roll with Hope
 * (critical included) and the pool is below Proficiency. It does not check `slayerClaim` (a new roll is unclaimed).
 */
export function canStore(sheet: SlayerSheet, outcome: RollOutcome, kind: RollKind): boolean {
  return holdsSlayerFeature(sheet) && kind === "action" && WITH_HOPE.includes(outcome) && slayerDice(sheet) < slayerCapacity(sheet);
}

/**
 * Whether an action roll's outcome actually gave a Hope: a roll with Hope gains one only below the Hope maximum
 * (CB 18, "to a maximum of 6"). `sheetBeforeGain` is the sheet after the roll's costs (Experience Hope paid) and
 * before its gains; a roll made at Hope max gave none, so storing takes none back.
 */
export function rollGaveHope(sheetBeforeGain: Pick<CharacterSheet, "hope" | "scars" | "hopeSlotBonus">, outcome: RollOutcome, kind: RollKind): boolean {
  return kind === "action" && WITH_HOPE.includes(outcome) && sheetBeforeGain.hope < hopeMax(sheetBeforeGain.scars, sheetBeforeGain.hopeSlotBonus);
}

/**
 * Answers a roll's Slayer choice with "store" (U2): adds one d6 to the pool, takes back the Hope the roll gave
 * (only when `hopeGained`; a critical's cleared Stress stays) and records `entryId` in `slayerClaim`.
 * Refuses with CLASS_FEATURE_RULE for a sheet without Slayer, a full pool, or a roll already answered.
 */
export function storeSlayerDie<T extends CharacterSheet>(sheet: T, { hopeGained, entryId }: { hopeGained: boolean; entryId: string }): T {
  if (!holdsSlayerFeature(sheet)) throw new RuleError("CLASS_FEATURE_RULE", "Only a Call of the Slayer character stores Slayer Dice.");
  if (featuresOf(sheet).slayerClaim === entryId) throw new RuleError("CLASS_FEATURE_RULE", "You already chose for this roll.");
  const held = slayerDice(sheet);
  if (held >= slayerCapacity(sheet)) throw new RuleError("CLASS_FEATURE_RULE", `Your Slayer Dice pool is full (${held}/${slayerCapacity(sheet)}).`);
  const paid = hopeGained ? applyResourceDelta(sheet, "hope", -1) : sheet;
  return withFeatures(paid, { slayerDice: held + 1, slayerClaim: entryId });
}

/**
 * Spends `n` Slayer Dice from the pool for an attack or damage roll (U3); the caller rolls `n` d6 with its own rng
 * and adds them to the roll. 0 returns the sheet unchanged. Refuses with DICE_RULE for a count that is not a whole
 * number from 0 to the pool.
 */
export function spendSlayerDice<T extends CharacterSheet>(sheet: T, n: number): T {
  const held = slayerDice(sheet);
  if (!Number.isInteger(n) || n < 0 || n > held) throw new RuleError("DICE_RULE", `You hold ${held} Slayer ${held === 1 ? "Die" : "Dice"}.`);
  if (n === 0) return sheet;
  return withFeatures(sheet, { slayerDice: held - n });
}

/**
 * Martial Preparation (Call of the Slayer mastery, CB 48), the downtime move: "You and each ally who chooses this
 * downtime move gain a d6 Slayer Die." User 2026-10-22 (dcm-bxp.63): the die joins the same pool as the Slayer's own
 * dice, so the dice box spends it and session end clears it for a Hope; the Slayer's pool is capped at Proficiency and
 * an ally holds up to their own Proficiency. At the cap nothing is gained (`gained: false`).
 */
export function gainMartialPreparationDie<T extends CharacterSheet>(sheet: T): { sheet: T; gained: boolean; held: number; capacity: number } {
  const held = slayerDice(sheet);
  const capacity = slayerCapacity(sheet);
  if (held >= capacity) return { sheet, gained: false, held, capacity };
  return { sheet: withFeatures(sheet, { slayerDice: held + 1 }), gained: true, held: held + 1, capacity };
}

/** Session end (K2, U8): empties the pool and gains a Hope per die cleared, capped at the Hope maximum. */
export function clearSlayerAtEnd<T extends CharacterSheet>(sheet: T): { sheet: T; cleared: number; hopeGained: number } {
  const cleared = slayerDice(sheet);
  if (cleared === 0) return { sheet, cleared, hopeGained: 0 };
  const next = applyResourceDelta(withFeatures(sheet, { slayerDice: undefined }), "hope", cleared);
  return { sheet: next, cleared, hopeGained: next.hope - sheet.hope };
}

/** The featureUses key of Weapon Specialist's once-per-long-rest reroll (CB 48). */
export const WEAPON_SPECIALIST_KEY = "weaponSpecialistReroll";

/** Whether Weapon Specialist's reroll is spent until the next long rest. */
export function weaponSpecialistUsed(sheet: Pick<CharacterSheet, "featureUses">): boolean {
  return sheet.featureUses.some((u) => u.key === WEAPON_SPECIALIST_KEY);
}

type RolledD6 = { sides: number; value: number };

/**
 * Weapon Specialist (CB 48): for a holder whose reroll is unspent this long rest, rerolls every 1 among the Slayer
 * Dice just rolled (once each, with `rng`) and marks the use until "longRest". Otherwise, and when no die shows a 1,
 * returns the sheet and dice unchanged. `label` names the reroll for the feed, e.g. "Weapon Specialist: 1 -> 4, 1 -> 1".
 */
export function rerollSlayerOnes<T extends CharacterSheet>(sheet: T, dice: readonly RolledD6[], rng: Rng): { sheet: T; dice: RolledD6[]; label?: string } {
  if (!holdsWeaponSpecialist(sheet) || weaponSpecialistUsed(sheet) || !dice.some((d) => d.value === 1)) return { sheet, dice: [...dice] };
  const rerolled = dice.map((d) => (d.value === 1 ? { ...d, value: rng(d.sides) } : d));
  const changes = dice.flatMap((d, i) => (d.value === 1 ? [`1 -> ${rerolled[i]!.value}`] : []));
  const next = { ...sheet, featureUses: [...sheet.featureUses, { key: WEAPON_SPECIALIST_KEY, until: "longRest" as const }] };
  return { sheet: next, dice: rerolled, label: `Weapon Specialist: ${changes.join(", ")}` };
}
