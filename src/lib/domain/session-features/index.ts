// Session-bound heritage and subclass features (plan session-features, F0). Pure: bundled into Convex and shared
// with the sheet and the dice box, so F1 (sessions), F2 (dice) and F3 (sheet) never copy a rule.
//
// State: `sheet.sessionFeatures` (optional; absent = nothing held), read with `featuresOf` and written with
// `withFeatures` (drops empty members). Refusals are `RuleError`s with existing codes (CLASS_FEATURE_RULE,
// DICE_RULE, NOT_ENOUGH_HOPE), which the Convex wrappers turn into ConvexError.
//
// | feature (book)                   | holder (holders.ts)  | state         | rules                                                      |
// |----------------------------------|----------------------|---------------|------------------------------------------------------------|
// | Luckbringer (Halfling, CB 64)    | holdsLuckbringer     | none          | partyHope, applyLuckbringer                                |
// | Slayer (Call of the Slayer, CB 48)| holdsSlayer         | slayerDice, slayerClaim | canStore, rollGaveHope, storeSlayerDie, spendSlayerDice, clearSlayerAtEnd |
// | Weapon Specialist (Slayer spec., CB 48)| holdsWeaponSpecialist | featureUses weaponSpecialistReroll | rerollSlayerOnes, weaponSpecialistUsed |
// | Know the Tide (Seaborne, CB 77)  | holdsTide            | tideTokens    | placeTideToken, spendTideTokens, clearTideAtEnd            |
// | Lunar Phases (Moon mastery, HF 17)| holdsLunarPhases(scope) | moonDie    | phaseOf, lunarBonuses, rollMoonDie, bumpMoonDie, canNegateMinor, negateMinor, endMoon |
//
// ```ts
// // F1 sessions.start, after onSessionStart, on the ACTIVE PCs:
// const { sheets, notes } = sessionStartFeatures(activeSheets, rollDie, scope);
// // F1 sessions.end, for EVERY PC, after onSessionEnd(expire(sheet, "session")):
// const { sheet: next, notes } = sessionEndFeatures(sheet);
// // F2 rolls: spend before rolling, place a token after the outcome is known
// paid = spendSlayerDice(paid, args.slayerDice ?? 0);            // then roll that many d6 ("Slayer d6")
// const tide = spendTideTokens(paid, args.tideTokens ?? 0);       // tide.modifier: "Know the Tide +n"
// next = placeTideToken(next, roll.outcome, roll.kind).sheet;
// // F2 storeSlayerDie: hopeGained from the roll row (rollGaveHope on the sheet before the gain)
// next = storeSlayerDie(sheet, { hopeGained, entryId });
// // F3 sheet and damage
// lunarBonuses(sheet, scope); phaseOf(die); bumpMoonDie(sheet, scope); negateMinor(sheet, severity, scope);
// ```
// The dice-box hooks (Waxing Moon damage option, the slayerStore prompt) are added by class-features/hooks.ts, and
// derived Evasion and thresholds by characters/derived.ts, both through `lunarBonuses` / `canStore`.
export { featuresOf, withFeatures } from "./state";
export { CALL_OF_THE_SLAYER, EVERYTHING, HALFLING, holdsLuckbringer, holdsLunarPhases, holdsSlayer, holdsTide, holdsWeaponSpecialist, LUCKBRINGER, MOON, SEABORNE } from "./holders";
export { applyLuckbringer, partyHope } from "./luckbringer";
export {
  canStore,
  clearSlayerAtEnd,
  rerollSlayerOnes,
  rollGaveHope,
  SLAYER_DIE_SIDES,
  slayerCapacity,
  slayerDice,
  spendSlayerDice,
  storeSlayerDie,
  WEAPON_SPECIALIST_KEY,
  weaponSpecialistUsed,
  WITH_HOPE,
} from "./slayer";
export { clearTideAtEnd, placeTideToken, spendTideTokens, tideCapacity, tideTokens, WITH_FEAR } from "./tide";
export {
  bumpMoonDie,
  bumpUsed,
  canNegateMinor,
  currentPhase,
  endMoon,
  LUNAR_BUMP_KEY,
  lunarBonuses,
  MOON_PHASES,
  moonDie,
  moonDieLabel,
  negateMinor,
  phaseOf,
  rollMoonDie,
  type LunarBonuses,
  type MoonPhase,
  type MoonPhaseKey,
} from "./lunar";
export { sessionEndFeatures, sessionStartFeatures } from "./session";
export { SLAYER_STORE_PROMPT, slayerStorePrompt, WAXING_MOON_OPTION, waxingMoonOption } from "./dice-hooks";
