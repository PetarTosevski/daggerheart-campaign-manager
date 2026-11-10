import { v, type Infer } from "convex/values";

import type { RollRecord } from "../../../src/lib/domain/duality";
import { spotlightHolderValidator, spotlightReasonValidator } from "../../tables/combatSpotlight";
import { encounterConditionValidator, instanceEffectValidator, instanceFeatureUseValidator } from "./encounters";

/**
 * Validators of the action log (D5 T0, CD19). The roll mirrors `RollRecord`
 * in src/lib/domain/duality.ts; the type checks at the bottom fail if they drift.
 */

export const actionKindValidator = v.union(
  v.literal("roll"),
  v.literal("gmRoll"),
  v.literal("feature"),
  v.literal("levelUp"),
  v.literal("rest"),
  v.literal("death"),
  v.literal("wither"),
  v.literal("session"),
  v.literal("import"),
  /** A countdown trigger notice (countdowns-advanced D7): GM-only, not undoable, no groupId. */
  v.literal("countdown"),
  /** A PC's weapon attack or domain card used on the Combat Map (plan combat-actions, CA3 / CA4). */
  v.literal("combat"),
  /** An adversary's attack or feature against PCs (plan combat-actions, AA2). */
  v.literal("adversary"),
  /**
   * A Manual rule's note to the GM (plan rule-switches RS0, widened): GM-only, carries `ruleId`, written only by
   * `postRuleNote` (convex/lib/ruleModes.ts). Undone with its action when it shares the action's `groupId`.
   */
  v.literal("rule"),
);

/** `public`: every member reads it; `gm`: only the GM (GM free rolls until revealed, decision 2). */
export const visibilityValidator = v.union(v.literal("public"), v.literal("gm"));

export const rolledDieValidator = v.object({
  sides: v.number(),
  value: v.number(),
  role: v.union(
    v.literal("hope"),
    v.literal("fear"),
    v.literal("advantage"),
    v.literal("disadvantage"),
    v.literal("help"),
    v.literal("extra"),
    v.literal("damage"),
  ),
  dropped: v.optional(v.boolean()),
});

export const rollValidator = v.object({
  kind: v.union(v.literal("action"), v.literal("reaction"), v.literal("damage"), v.literal("free")),
  dice: v.array(rolledDieValidator),
  modifier: v.number(),
  total: v.number(),
  difficulty: v.optional(v.number()),
  outcome: v.union(
    v.literal("critical"),
    v.literal("successHope"),
    v.literal("successFear"),
    v.literal("failHope"),
    v.literal("failFear"),
    v.literal("none"),
  ),
  manual: v.boolean(),
});

/**
 * One adversary instance as it was before a combat action changed it (plan combat-actions CA0, U4): undo writes these
 * fields back to the `encounterAdversaries` row. `conditions` and `tags` are set when the action changed them.
 */
export const adversaryBeforeValidator = v.object({
  instanceId: v.id("encounterAdversaries"),
  hp: v.number(),
  stress: v.number(),
  defeated: v.boolean(),
  minionCount: v.optional(v.number()),
  conditions: v.optional(v.array(encounterConditionValidator)),
  tags: v.optional(v.array(v.string())),
  /** The instance's card / feature modifiers, set when the action changed them (CA4b, widened; Glyph of Nightfall...). */
  effects: v.optional(v.array(instanceEffectValidator)),
  /** The instance's limited feature uses, set when the action recorded one (AA2c, widened): undo gives the use back. */
  featureUses: v.optional(v.array(instanceFeatureUseValidator)),
  /**
   * The instance's spotlight count and its GM turn, set when the action marked it spotlit (`spotlight.takeWithFear`,
   * dcm-iukg; widened, older rows have none and their undo leaves the count as it is). Undo writes both back.
   */
  spotlights: v.optional(v.number()),
  spotlightTurn: v.optional(v.number()),
});

/**
 * One creature a public adversary action named (followups-7 H3, widened): its token on the live map, whether it is a PC
 * or an adversary token, and how the action touched it. Ids and a tone only, never a number (Q14): the map flashes the
 * token by id. Players receive only the `pc` entries (`feed.list`); adversary tokens flash for the GM only.
 */
export const actionTargetValidator = v.object({
  tokenId: v.id("combatTokens"),
  side: v.union(v.literal("pc"), v.literal("adversary")),
  /** The attack hit it, missed it, or a feature without a roll touched it. */
  tone: v.union(v.literal("hit"), v.literal("miss"), v.literal("effect")),
});

/** The campaign's day (the `campaignTime` row's fields): week, Witherwild cycle ("DAY" elsewhere) and day of the week. */
export const campaignTimeSnapshotValidator = v.object({
  week: v.number(),
  cycle: v.union(v.literal("DAY"), v.literal("NIGHT")),
  cycleDay: v.number(),
});

/**
 * The calendar move of an End day or a Witherwild day-icon jump forward (plan lanes-2 CT2, dcm-jq4b; widened, older rows
 * have none), on the group's campaign row. Undo moves the calendar back to `before` only while it still stands at `after`
 * (the latest day's end, user answer 2026-11-01); `timeOfDayBefore` is set when End day reset the time of day to Day.
 */
export const timeChangeValidator = v.object({
  before: campaignTimeSnapshotValidator,
  after: campaignTimeSnapshotValidator,
  timeOfDayBefore: v.optional(v.union(v.literal("day"), v.literal("dim"), v.literal("night"))),
});

/**
 * The spotlight before a PC's action roll moved it to the GM (S1, plan rule-switches CU2, bead dcm-bxp.99.32.10): the
 * campaign's `combatSpotlight` row as it stood (`row` null: nobody in particular, the whole party) and the moved row's
 * `since` (`movedAt`). Undo of the roll puts `row` back while the GM's hold is still the one the roll started.
 */
export const spotlightBeforeValidator = v.object({
  row: v.union(
    v.null(),
    v.object({
      holder: spotlightHolderValidator,
      since: v.number(),
      reason: spotlightReasonValidator,
      rollBy: v.optional(v.id("characters")),
      adversaryTokenId: v.optional(v.id("combatTokens")),
    }),
  ),
  movedAt: v.number(),
});

/** A row's counted Hope spent / HP marked and the live session they went to (dcm-z9rz.22). */
export const sessionTallyValidator = v.object({ sessionId: v.id("sessions"), hopeSpent: v.number(), hpMarked: v.number() });

/**
 * What a PC's card use or weapon attack did to one adversary it hit (dcm-uemx, widened; older rows have none): the damage
 * severity against its thresholds (CB p.90: Minor 1 HP, Major 2, Severe 3; "defeat" for a Minion or a block without
 * thresholds, "none" when nothing got through), the HP the use marked on it (after resistance, riders and the track's
 * cap), the resistance that applied and whether it was Massive (CB p.91). Stored only on the use's `visibility: "gm"`
 * row and read only by the GM (`combatHud.resultDamage`): adversary thresholds never reach a player (U1).
 */
export const targetDamageValidator = v.object({
  tokenId: v.id("combatTokens"),
  severity: v.union(v.literal("none"), v.literal("minor"), v.literal("major"), v.literal("severe"), v.literal("defeat")),
  hpMarked: v.number(),
  resisted: v.optional(v.union(v.literal("resistant"), v.literal("immune"))),
  massive: v.optional(v.literal(true)),
});

/**
 * What a PC's card use, weapon attack or feature use showed its player in the result panel (dcm-uemx, user 2026-11-09
 * "the GM sees every player's result"; widened, older rows have none): stored on the use's public row so the GM's HUD can
 * show the same panel (`combatHud.playerResults`). Only what the acting player already received (their own dice and
 * damage, Hit / Miss / Defeated per target, the table steps): no adversary number (U1). The GM's severity and HP marked
 * stay on the GM row (`targetDamage`). `feed.list` never sends it.
 */
export const resultPanelValidator = v.object({
  kind: v.union(v.literal("card"), v.literal("attack"), v.literal("feature")),
  /** The card's, weapon's or feature's name. */
  title: v.string(),
  /** The acting PC's name when it was used. */
  actorName: v.string(),
  /** A card use: the card and its use (its art, its roll word, its damage type). */
  cardId: v.optional(v.string()),
  useId: v.optional(v.string()),
  /** A weapon attack: the weapon's damage type. */
  damageType: v.optional(v.union(v.literal("physical"), v.literal("magic"))),
  roll: v.union(v.null(), rollValidator),
  damage: v.array(rollValidator),
  success: v.boolean(),
  targets: v.array(v.object({ tokenId: v.id("combatTokens"), name: v.string(), hit: v.boolean(), defeated: v.boolean() })),
  prompts: v.array(v.object({ kind: v.union(v.literal("manual"), v.literal("move"), v.literal("pcSave"), v.literal("pcDamage"), v.literal("fold")), text: v.string() })),
  /** A feature's own notes (Favor, Help dice, areas). */
  notes: v.array(v.string()),
  /** An attack's riders that applied, and the ones whose moment didn't come. */
  riders: v.optional(v.array(v.string())),
  skipped: v.optional(v.array(v.string())),
  /** The player was offered extra Minions to defeat (CB p.201), or the GM picks this many (D6 variant). */
  minionOffer: v.optional(v.literal(true)),
  minionsForGm: v.optional(v.number()),
});

/** The stored fields of one `actionLog` row (see convex/tables/actionLog.ts). */
export const actionLogFields = {
  campaignId: v.id("campaigns"),
  /** Unset for campaign-wide rows (a GM free roll, the campaign row of a rest or session). */
  characterId: v.optional(v.id("characters")),
  /** Who did it: the roller, the feature's user, the GM who finished a rest. */
  actorId: v.id("users"),
  kind: actionKindValidator,
  visibility: visibilityValidator,
  /** One line for the feed, at most 300 characters (`logAction` trims it). */
  summary: v.string(),
  roll: v.optional(rollValidator),
  /** Rows written by one action (a rest, a tag team, a cross-character feature) share it and undo together. */
  groupId: v.optional(v.string()),
  /** The character's stored sheet before the change, as JSON; undo restores it through `readSheet`. */
  before: v.optional(v.string()),
  /** Adversary instances before a combat action (CA0, widened; rows written before it have none). Undo restores them. */
  adversaryBefore: v.optional(v.array(adversaryBeforeValidator)),
  /** GM Fear this row gained (positive) or removed (negative); undo reverts it through `revertFear`. */
  fearDelta: v.optional(v.number()),
  /** An action roll with Hope: whether it gave the Hope (false at Hope max after its costs). `rolls.storeSlayerDie` takes it back (K2, dcm-bxp.65). */
  hopeGained: v.optional(v.boolean()),
  /** The public row of an adversary action (H3, widened; older rows have none): the token ids it named on the live map. */
  targets: v.optional(v.array(actionTargetValidator)),
  /** The calendar move of an End day / day jump (CT2, widened): undo of the latest one moves the calendar back. */
  timeChange: v.optional(timeChangeValidator),
  /**
   * What this row's action added to its character's `sessionCharacterStats` row (Journal JD3b counters: Hope spent, HP
   * marked) while a session was live (dcm-z9rz.22, user 2026-11-04 "undo removes it"; widened, older rows have none and
   * their undo leaves the tally as it is). Undo takes it back off that session's row, never below 0.
   */
  sessionTally: v.optional(sessionTallyValidator),
  /** S1 moved the spotlight to the GM with this row's action (CU2, widened; older rows have none): undo puts it back. */
  spotlightBefore: v.optional(spotlightBeforeValidator),
  /** dcm-uemx: on the GM row of a PC's card use or attack only, severity and HP marked per adversary hit (U1: GM only). */
  targetDamage: v.optional(v.array(targetDamageValidator)),
  /** dcm-uemx: on the public row of a PC's card use, attack or feature use, what its result panel showed (the GM's HUD). */
  resultPanel: v.optional(resultPanelValidator),
  undoable: v.boolean(),
  undoneAt: v.optional(v.number()),
  undoneBy: v.optional(v.id("users")),
  /** Set when the GM deletes the row from the feed (`feed.remove`). Display only: undo and "latest roll" checks still see it. */
  removedAt: v.optional(v.number()),
  /**
   * When the GM revealed this hidden GM free roll (`rolls.reveal`; user 2026-11-04, widened). The feed tags such a row
   * "Revealed". Rows revealed before the field have none: unknown, no tag. Never set on a row that was never hidden.
   */
  revealedAt: v.optional(v.number()),
  /**
   * A `rule` row's rule (a registry id of `src/lib/rules/registry.ts`; plan rule-switches RS0, widened). A string, not a
   * union of the ids, so a registry change never needs a migration of the log.
   */
  ruleId: v.optional(v.string()),
  /**
   * A social roll (Journal JF2, dcm-z9rz.28, user 2026-11-06; widened, older rows have none = not social): a PC's duality
   * roll made while the live session's playing scene is a Social scene, or with 'Social roll' ticked in the dice box.
   * Set only by the roll paths (convex/lib/rolls.ts `duality`, `rolls.tagTeam`); the Journal log shows a mouth icon.
   */
  social: v.optional(v.boolean()),
  at: v.number(),
};

export const actionLogRowValidator = v.object({ _id: v.id("actionLog"), _creationTime: v.number(), ...actionLogFields });

export type ActionKind = Infer<typeof actionKindValidator>;
export type Visibility = Infer<typeof visibilityValidator>;
export type StoredRoll = Infer<typeof rollValidator>;
export type AdversaryBefore = Infer<typeof adversaryBeforeValidator>;
export type ActionTarget = Infer<typeof actionTargetValidator>;
export type CampaignTimeSnapshot = Infer<typeof campaignTimeSnapshotValidator>;
export type TimeChange = Infer<typeof timeChangeValidator>;
export type SpotlightBefore = Infer<typeof spotlightBeforeValidator>;
export type TargetDamage = Infer<typeof targetDamageValidator>;
export type ResultPanel = Infer<typeof resultPanelValidator>;

// Drift checks: each type must be assignable to the other.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const rollMatchesDomain: Same<StoredRoll, RollRecord> = true;
void rollMatchesDomain;
