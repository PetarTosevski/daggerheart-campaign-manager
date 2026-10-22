/**
 * Weapon attacks on the Combat Map (plan combat-actions, tracer CA3): the shared steps behind `combatActions.attack`,
 * `combatActions.targets`, `combatActions.pickMinions` and the GM's sanction (`combatRequests.sanction`). Callers are
 * campaign wrappers that already loaded the character with edit permission; these helpers only scope, check, roll and
 * write. The rules are CA1's pure engine (src/lib/domain/combat-actions) and the dice internals of ./rolls.
 *
 * Rules (printed pages; quotes in docs/tasks/TASK-CA-CA3.md):
 * - R1 (CB p.96): one attack roll against each target's Difficulty; a critical hits every target (CB p.90).
 * - R2 (CB p.98): on any hit one damage roll, the weapon's dice at Proficiency; a critical adds the dice's maximum.
 * - R9 (CB p.104): one roll for all targets, the damage total applied to each target hit.
 * - R3 / R10 (CB p.91, p.99, p.193): resistance halves, immunity takes none, then thresholds 1 / 2 / 3 HP; a Minion is
 *   defeated by any damage and every X damage defeats one more Minion the attacker picks (CB p.201, Q6).
 * - R11 (CB p.103-104): out of the weapon's range waits for the GM (Q1), no line of sight refuses (Q2), cover gives
 *   the roll one disadvantage (Q2).
 * - U1: what a player receives (returns, the public row) holds hit / miss / defeated and their own dice only; HP,
 *   Stress, thresholds and Difficulty are only on the GM's row.
 */
import { v, type Infer } from "convex/values";

import { lineOfSight, rangeCheck, rangeFromWeapon, resolveHits, applyDamageTo, type Combatant, type RangeCheck, type SightResult } from "../../src/lib/domain/combat-actions/index";
import { tokenVisibility } from "../../src/lib/domain/combat-map/index";
import { countsAsActionRoll } from "../../src/lib/domain/countdowns/advanced";
import { afterDualityRoll } from "../../src/lib/domain/class-features/hooks";
import { CLASS_FEATURES } from "../../src/lib/domain/class-features/index";
import { typedLabel } from "../../src/lib/domain/dice/index";
import type { RollRecord } from "../../src/lib/domain/duality";
import { SEVERITY_LABEL } from "../../src/lib/domain/encounters/damage";
import { minionValue } from "../../src/lib/domain/adversaries/index";
import { rollGaveHope, WITH_HOPE } from "../../src/lib/domain/session-features/index";
import { appError } from "../../src/lib/errors/app-error";
import { TRAIT_LABEL } from "../../src/lib/frames/extras/common";
import { ADVERSARIES } from "../../src/lib/srd/adversaries";
import { alwaysOnResistance } from "../../src/lib/srd/adversary-resistance";
import { getWeapon } from "../../src/lib/srd/index";
import type { AdversaryDef, TraitId, Weapon } from "../../src/lib/srd/types";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { tickArmedCountdowns } from "../countdownRolls";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { logAction, newGroupId } from "./actionLog";
import { saveSheet } from "./characterSheet";
import { loadCombatMap } from "./combatMaps";
import { loadScene, viewOf, type Scene, type Viewer } from "./combatVision";
import { gainFear } from "./fear";
import { openMinionOffer } from "./combatRequests";
import { changed, resolveDamage, resolveDuality, type DualityArgs, type Loaded } from "./rolls";
import type { AdversaryBefore } from "./validators/actionLog";
import { traitIdValidator } from "./validators/characters";
import { rangeBandValidator } from "./validators/combatRequests";
import { rollValidator } from "./validators/actionLog";
import { rollDie } from "./dice";

/** The most targets one attack names (the bound `combatRequests` documents, CD8). */
export const MAX_TARGETS = 20;

const SRD_BY_ID = new Map<string, AdversaryDef>(ADVERSARIES.map((a) => [a.id, a]));

// ---------------------------------------------------------------- validators

export const weaponSlotValidator = v.union(v.literal("primary"), v.literal("secondary"));
export type WeaponSlot = Infer<typeof weaponSlotValidator>;

/** The Duality options of an attack, as the sheet's dice box sends them (`dualityFields` without trait / kind / attack). */
export const attackRollFields = {
  /** Only for a weapon whose trait is the wielder's choice (Brawler's Strike); else the weapon's trait is used. */
  trait: v.optional(traitIdValidator),
  modifier: v.number(),
  experienceIds: v.array(v.string()),
  advantage: v.number(),
  disadvantage: v.number(),
  help: v.number(),
  /** Chosen `rollOptions` keys of the attack roll. */
  options: v.array(v.string()),
  /** Chosen `rollOptions` keys of the damage roll (Sneak Attack, Combat Training...). */
  damageOptions: v.optional(v.array(v.string())),
  slayerDice: v.optional(v.number()),
  tideTokens: v.optional(v.number()),
};

export type AttackRoll = {
  trait?: TraitId;
  modifier: number;
  experienceIds: string[];
  advantage: number;
  disadvantage: number;
  help: number;
  options: string[];
  damageOptions?: string[];
  slayerDice?: number;
  tideTokens?: number;
};

/** One target as the player learns it (U1): hit or miss, and whether it went down (Q6). */
export const targetOutcomeValidator = v.object({ tokenId: v.id("combatTokens"), hit: v.boolean(), defeated: v.boolean() });

/** The Minions a player may pick after the attack (Q6): which token, and how many of its Minions. No stats. */
export const minionOfferValidator = v.object({
  requestId: v.id("combatRequests"),
  extra: v.number(),
  candidates: v.array(v.object({ instanceId: v.id("encounterAdversaries"), tokenId: v.id("combatTokens"), name: v.string(), available: v.number() })),
});

const promptValidator = v.object({
  key: v.string(),
  featureKey: v.string(),
  text: v.string(),
  choices: v.array(v.object({ key: v.string(), label: v.string() })),
});

/** What `attack` (and the GM's approval) returns: the player's own dice and hit / miss per target, never a stat. */
export const resolvedAttackValidator = v.object({
  status: v.literal("resolved"),
  entryId: v.id("actionLog"),
  roll: rollValidator,
  /** The damage roll (null when every target was missed). */
  damage: v.union(v.null(), rollValidator),
  targets: v.array(targetOutcomeValidator),
  fearGained: v.number(),
  minionOffer: v.union(v.null(), minionOfferValidator),
  prompts: v.array(promptValidator),
});
export type ResolvedAttack = Infer<typeof resolvedAttackValidator>;

/** An attack that waits for the GM (Q1): which targets are out of range and in which band. */
export const pendingAttackValidator = v.object({
  status: v.literal("pending"),
  requestId: v.id("combatRequests"),
  outOfRange: v.array(v.object({ tokenId: v.id("combatTokens"), band: rangeBandValidator })),
});

/** `combatActions.targets`: per visible enemy token only the band and whether it can be attacked (U1, CF6). */
export const targetHintValidator = v.object({
  tokenId: v.id("combatTokens"),
  band: rangeBandValidator,
  inRange: v.boolean(),
  lineOfSight: v.boolean(),
  cover: v.boolean(),
});

// ---------------------------------------------------------------- the scene around the attacker

export type AttackScene = { map: Doc<"combatMaps">; scene: Scene; viewer: Viewer; attacker: Doc<"combatTokens"> };

/**
 * The live map and the character's view on it. COMBAT_MAP_NOT_FOUND for a map that is not this campaign's live map
 * (players act only on the live map, R2); COMBAT_TOKEN_NOT_FOUND when the character has no PC token there.
 */
export async function attackScene(ctx: QueryCtx, campaign: Doc<"campaigns">, character: Doc<"characters">, mapId: string): Promise<AttackScene> {
  const map = await loadCombatMap(ctx, campaign._id, mapId);
  if (!map.live) throw appError("COMBAT_MAP_NOT_FOUND");
  const scene = await loadScene(ctx, campaign, map);
  const viewer = viewOf(scene, character);
  if (viewer === null) throw appError("COMBAT_TOKEN_NOT_FOUND");
  return { map, scene, viewer, attacker: scene.tokens[viewer.index]! };
}

/** An enemy token's encounter instance, when it can be attacked: an enemy-side adversary token of a running encounter, not defeated. */
async function enemyInstance(ctx: QueryCtx, campaignId: Id<"campaigns">, token: Doc<"combatTokens">): Promise<{ instance: Doc<"encounterAdversaries">; encounter: Doc<"encounters"> } | null> {
  if (token.side !== "enemy" || token.ref.kind !== "adversary") return null;
  const instance = await ctx.db.get("encounterAdversaries", token.ref.adversaryId);
  if (instance === null || instance.campaignId !== campaignId || instance.defeated) return null;
  const encounter = await ctx.db.get("encounters", instance.encounterId);
  if (encounter === null || encounter.campaignId !== campaignId || encounter.status !== "running") return null;
  return { instance, encounter };
}

/** Whether the viewer sees the token at all (dark, hidden, behind walls: no line of sight, CB p.104 "if you can see the target"). */
function seenBy(s: AttackScene, index: number): boolean {
  return tokenVisibility(s.viewer.view, s.scene.visionTokens[index]!) !== "hidden";
}

function sightTo(s: AttackScene, token: Doc<"combatTokens">): SightResult {
  return lineOfSight(s.scene.prepared, s.attacker, token, s.scene.visionObjects);
}

export function weaponIn(sheet: CharacterSheet, slot: WeaponSlot): Weapon | undefined {
  const id = slot === "primary" ? sheet.primaryWeaponId : sheet.secondaryWeaponId;
  return id ? getWeapon(id) : undefined;
}

/** `combatActions.targets`: every enemy token the character sees that can be attacked, with its band and hints. */
export async function targetHints(ctx: QueryCtx, campaign: Doc<"campaigns">, s: AttackScene, weapon: Weapon | undefined): Promise<Infer<typeof targetHintValidator>[]> {
  const hints: Infer<typeof targetHintValidator>[] = [];
  for (const [i, token] of s.scene.tokens.entries()) {
    if (i === s.viewer.index || token.side !== "enemy" || !seenBy(s, i)) continue;
    if ((await enemyInstance(ctx, campaign._id, token)) === null) continue;
    const check = rangeCheck(s.attacker, token, weapon ? rangeFromWeapon(weapon.range) : "melee");
    const sight = sightTo(s, token);
    hints.push({ tokenId: token._id, band: check.band, inRange: weapon !== undefined && check.inRange, lineOfSight: sight.lineOfSight, cover: sight.cover });
  }
  return hints;
}

// ---------------------------------------------------------------- checking the targets

export type CheckedTarget = {
  token: Doc<"combatTokens">;
  instance: Doc<"encounterAdversaries">;
  encounter: Doc<"encounters">;
  check: RangeCheck;
  sight: SightResult;
};

/**
 * A plain weapon attack takes one target (CA4b user answer, bead dcm-bxp.99.18: "Plain weapon attacks take one
 * target"); more than one is COMBAT_TARGET_INVALID. Card effects keep their own bound (MAX_CARD_TARGETS).
 */
export const WEAPON_ATTACK_TARGETS = 1;

/**
 * Checks the named target: exactly one (`WEAPON_ATTACK_TARGETS`), on the map and seen with a clear line (else
 * COMBAT_NO_LINE_OF_SIGHT, Q2), an enemy token linked to an undefeated instance of a running encounter (else
 * COMBAT_TARGET_INVALID). Seen first, so a token the player can't see answers the same whatever it is. Kept as a list
 * (a stored sanction holds `targetTokenIds`); several targets would have to share one encounter.
 */
export async function checkTargets(ctx: QueryCtx, campaign: Doc<"campaigns">, s: AttackScene, weapon: Weapon, tokenIds: readonly Id<"combatTokens">[]): Promise<CheckedTarget[]> {
  if (tokenIds.length === 0 || tokenIds.length > Math.min(MAX_TARGETS, WEAPON_ATTACK_TARGETS) || new Set(tokenIds).size !== tokenIds.length) throw appError("COMBAT_TARGET_INVALID");
  const range = rangeFromWeapon(weapon.range);
  const checked: CheckedTarget[] = [];
  for (const id of tokenIds) {
    const index = s.scene.tokens.findIndex((t) => t._id === id);
    if (index < 0 || index === s.viewer.index) throw appError("COMBAT_TARGET_INVALID");
    const token = s.scene.tokens[index]!;
    if (!seenBy(s, index)) throw appError("COMBAT_NO_LINE_OF_SIGHT");
    const sight = sightTo(s, token);
    if (!sight.lineOfSight) throw appError("COMBAT_NO_LINE_OF_SIGHT");
    const linked = await enemyInstance(ctx, campaign._id, token);
    if (linked === null) throw appError("COMBAT_TARGET_INVALID");
    checked.push({ token, ...linked, check: rangeCheck(s.attacker, token, range), sight });
  }
  if (new Set(checked.map((c) => c.encounter._id)).size > 1) throw appError("COMBAT_TARGET_INVALID");
  return checked;
}

/** The weapon in the slot, or DICE_RULE (as `damageRoll`) when none is equipped. */
export function equippedWeapon(sheet: CharacterSheet, slot: WeaponSlot): Weapon {
  const weapon = weaponIn(sheet, slot);
  if (!weapon) throw appError("DICE_RULE", `No ${slot} weapon is equipped.`);
  return weapon;
}

/** The Duality arguments of a weapon attack (the weapon's trait unless it is the wielder's choice). */
export function attackDuality(weapon: Weapon, roll: AttackRoll, cover: boolean): DualityArgs {
  const trait = weapon.trait === "choice" ? roll.trait : weapon.trait;
  if (trait === undefined) throw appError("DICE_RULE", "Pick the trait this weapon attacks with.");
  return {
    kind: "action",
    trait,
    modifier: roll.modifier,
    experienceIds: roll.experienceIds,
    advantage: roll.advantage,
    // CB p.104: attack rolls against a target in cover are made with disadvantage (Q2); one roll for every target (R9).
    disadvantage: roll.disadvantage + (cover ? 1 : 0),
    help: roll.help,
    attack: true,
    options: roll.options,
    ...(roll.slayerDice !== undefined ? { slayerDice: roll.slayerDice } : {}),
    ...(roll.tideTokens !== undefined ? { tideTokens: roll.tideTokens } : {}),
  };
}

// ---------------------------------------------------------------- adversaries as the engine reads them

type Block = { minion: boolean; minionX: number | null; resistance: Combatant["resistance"] };

/** Minion type and X, and the resistance that applies now (the instance's own, a conditional one only while the GM has it on). */
async function blockOf(ctx: QueryCtx, instance: Doc<"encounterAdversaries">): Promise<Block> {
  const own = instance.resistance;
  const fromInstance = own === undefined ? undefined : own.conditional === undefined || instance.resistanceActive === true ? { physical: own.physical, magic: own.magic } : { physical: "none" as const, magic: "none" as const };
  if (instance.source.kind === "srd") {
    const def = SRD_BY_ID.get(instance.source.adversaryId);
    const minionX = def ? minionValue(def) : null;
    return { minion: def?.type === "Minion" || minionX !== null, minionX, resistance: fromInstance ?? alwaysOnResistance(instance.source.adversaryId) };
  }
  const block = await ctx.db.get("customAdversaries", instance.source.customId);
  let minionX: number | null = null;
  for (const f of block?.features ?? []) {
    const m = /^Minion \((\d+)\)$/.exec(f.name);
    if (m) minionX = Number(m[1]);
  }
  const custom = block?.resistance && block.resistance.conditional === undefined ? { physical: block.resistance.physical, magic: block.resistance.magic } : undefined;
  return { minion: block?.type === "Minion" || minionX !== null, minionX, resistance: fromInstance ?? custom };
}

/** The instance's Difficulty with card modifiers on it (Glyph of Nightfall, CA0 `effects`). Never sent to a player. */
function difficultyOf(instance: Doc<"encounterAdversaries">): number {
  return instance.stats.difficulty + (instance.effects ?? []).reduce((sum, e) => sum + (e.difficulty ?? 0), 0);
}

function combatantOf(instance: Doc<"encounterAdversaries">, block: Block): Combatant {
  return {
    id: instance._id,
    side: "adversary",
    difficulty: difficultyOf(instance),
    thresholds: { major: instance.stats.major, severe: instance.stats.severe },
    hp: instance.hp,
    hpMax: instance.stats.hpMax,
    stress: instance.stress,
    stressMax: instance.stats.stressMax,
    defeated: instance.defeated,
    resistance: block.resistance,
    conditions: instance.conditions,
    tags: instance.tags,
  };
}

/** One Minion of a group (one HP per Minion): any damage defeats it; X gives the extra defeats (CB p.201). */
function oneMinion(instance: Doc<"encounterAdversaries">, block: Block): Combatant {
  return { ...combatantOf(instance, block), hp: 0, hpMax: 1, thresholds: { major: null, severe: null }, minionX: block.minionX ?? 0 };
}

export function beforeOf(instance: Doc<"encounterAdversaries">): AdversaryBefore {
  return { instanceId: instance._id, hp: instance.hp, stress: instance.stress, defeated: instance.defeated, ...(instance.minionCount !== undefined ? { minionCount: instance.minionCount } : {}) };
}

function damageTypeOf(weapon: Weapon): "physical" | "magic" {
  // Shadowblade's "either" counts as physical, as the damage roll's `magicDamage` reads it.
  return weapon.damageType === "magic" ? "magic" : "physical";
}

const SHORT_TYPE = { physical: "phy", magic: "mag" } as const;

function rollWord(roll: RollRecord): string {
  if (roll.outcome === "critical") return "critical";
  return roll.outcome === "successHope" || roll.outcome === "failHope" ? "with Hope" : "with Fear";
}

function diceList(roll: RollRecord): string {
  return roll.dice.filter((d) => !d.dropped).map((d) => d.value).join(", ");
}

// ---------------------------------------------------------------- resolving

/**
 * Onslaught (Blade 10, CB p.330; Blade table's `floor` use, CA4b): "When you successfully make an attack with your weapon,
 * you never deal damage beneath a target's Major damage threshold (the target always marks a minimum of 2 Hit Points)."
 * While the card is in the loadout, a weapon hit that deals damage marks at least Major (2 HP); no damage stays none.
 */
function hasOnslaught(sheet: CharacterSheet): boolean {
  return sheet.domainCards.loadout.includes("onslaught");
}

export type AttackRequest = {
  loaded: Loaded;
  /** Who the rows belong to (the attacker's user; on a GM approval, the player who asked). */
  actorId: Id<"users">;
  scene: AttackScene;
  weapon: Weapon;
  slot: WeaponSlot;
  targets: CheckedTarget[];
  roll: AttackRoll;
};

/**
 * Resolves a weapon attack in one mutation (U4): the Duality roll (Hope, Stress, GM Fear, countdown ticks, as
 * `actionRoll`), hit or miss per target, one damage roll on any hit, damage marked on each instance hit, a Minion offer,
 * and one actionLog group: a public row (the roll, the damage dice and total, Hit / Miss / Defeated per target) and a
 * GM row (damage, severity, HP per target, `adversaryBefore` for undo).
 */
export async function resolveAttack(ctx: MutationCtx, req: AttackRequest): Promise<ResolvedAttack> {
  const { loaded, weapon, slot, targets, roll: options } = req;
  const { campaign, character, sheet } = loaded;
  const cover = targets.some((t) => t.sight.cover);
  const args = attackDuality(weapon, options, cover);
  const duality = await resolveDuality(ctx, loaded, args, rollDie, false);
  const { roll } = duality;
  const critical = roll.outcome === "critical";

  const blocks = new Map<string, Block>();
  for (const t of targets) blocks.set(t.instance._id, await blockOf(ctx, t.instance));
  const hits = resolveHits(
    roll.total,
    critical,
    targets.map((t) => ({ id: t.token._id, difficulty: difficultyOf(t.instance) })),
  );
  const anyHit = hits.some((h) => h.hit);

  // R2: one damage roll on the sheet after the attack's costs and gains; a critical adds the dice's maximum.
  const damage = anyHit
    ? await resolveDamage(ctx, { ...loaded, sheet: duality.next }, { source: { kind: "weapon", slot }, critical, modifier: 0, options: options.damageOptions ?? [] }, rollDie, false)
    : null;
  const finalSheet = damage?.paid ?? duality.next;

  const type = damageTypeOf(weapon);
  const onslaught = hasOnslaught(sheet);
  const now = Date.now();
  const before: AdversaryBefore[] = [];
  const outcomes: { tokenId: Id<"combatTokens">; hit: boolean; defeated: boolean }[] = [];
  const publicParts: string[] = [];
  const gmParts: string[] = [];
  let extra = 0;
  for (const [i, t] of targets.entries()) {
    const hit = hits[i]!.hit;
    const block = blocks.get(t.instance._id)!;
    const label = t.instance.label;
    if (!hit || damage === null) {
      outcomes.push({ tokenId: t.token._id, hit: false, defeated: false });
      publicParts.push(`${label}: Miss`);
      gmParts.push(`${label}: miss (${roll.total} vs Difficulty ${difficultyOf(t.instance)})`);
      continue;
    }
    before.push(beforeOf(t.instance));
    const total = damage.roll.total;
    let hp: number;
    let detail: string;
    if (block.minion) {
      const result = applyDamageTo(oneMinion(t.instance, block), total, type);
      const fell = result.taken > 0 ? 1 : 0;
      hp = Math.min(t.instance.stats.hpMax, t.instance.hp + fell);
      extra += fell > 0 ? result.minionExtra : 0;
      detail = `${result.incoming} ${SHORT_TYPE[type]}${result.resisted !== "none" ? ` (${result.resisted}: ${result.taken})` : ""} → ${fell > 0 ? `a Minion falls, +${result.minionExtra} to pick` : "no damage"} (${hp}/${t.instance.stats.hpMax} HP)`;
    } else {
      const result = applyDamageTo(combatantOf(t.instance, block), total, type, onslaught ? { minimumSeverity: "major" } : {});
      hp = result.after.hp;
      detail = `${result.incoming} ${SHORT_TYPE[type]}${result.resisted !== "none" ? ` (${result.resisted}: ${result.taken})` : ""} → ${SEVERITY_LABEL[result.severity]}${onslaught ? " (Onslaught)" : ""} → ${result.hpMarked} HP (${hp}/${t.instance.stats.hpMax})`;
    }
    const defeated = t.instance.defeated || hp >= t.instance.stats.hpMax;
    await ctx.db.patch("encounterAdversaries", t.instance._id, { hp, defeated, updatedAt: now });
    outcomes.push({ tokenId: t.token._id, hit: true, defeated });
    publicParts.push(`${label}: ${defeated ? "Defeated" : "Hit"}`);
    gmParts.push(`${label}: ${detail}${defeated ? ", defeated" : ""}`);
  }

  const { gained } = duality.effects.fear > 0 ? await gainFear(ctx, campaign._id, duality.effects.fear) : { gained: 0 };
  const sheetChanged = changed(sheet, finalSheet);
  if (sheetChanged) await saveSheet(ctx, character._id, finalSheet);

  const groupId = newGroupId();
  const using = duality.extras.length > 0 ? ` (${duality.extras.join(", ")})` : "";
  const head = `${sheet.name} attacks with ${weapon.name}: ${TRAIT_LABEL[args.trait]} ${roll.total}${typedLabel(args.modifier)} ${rollWord(roll)}${using}`;
  const damageText = damage === null ? "" : `; ${critical ? "critical " : ""}damage ${damage.roll.total} (${[damage.label, diceList(damage.roll)].filter((s) => s !== "").join(": ")})`;
  const entryId = await logAction(ctx, {
    campaignId: campaign._id,
    characterId: character._id,
    actorId: req.actorId,
    kind: "combat",
    visibility: "public",
    summary: `${head}${damageText} → ${publicParts.join(", ")}`,
    roll,
    groupId,
    ...(sheetChanged ? { before: sheet } : {}),
    ...(gained !== 0 ? { fearDelta: gained } : {}),
    // As `actionRoll`: whether the roll gave its Hope (after its costs), so `rolls.storeSlayerDie` can take it back (K2).
    ...(WITH_HOPE.includes(roll.outcome) ? { hopeGained: rollGaveHope(duality.paid, roll.outcome, "action") } : {}),
    undoable: true,
  });
  await logAction(ctx, {
    campaignId: campaign._id,
    actorId: req.actorId,
    kind: "combat",
    visibility: "gm",
    summary: `${sheet.name} → ${gmParts.join("; ")}`,
    ...(damage !== null ? { roll: damage.roll } : {}),
    groupId,
    ...(before.length > 0 ? { adversaryBefore: before } : {}),
    undoable: true,
  });

  // Armed countdowns tick right after the attack roll, as for `actionRoll` (countdowns-advanced K1, CB p.162).
  if (countsAsActionRoll(roll, { logKind: "roll", undone: false })) {
    await tickArmedCountdowns(ctx, { campaignId: campaign._id, entryId, outcome: roll.outcome, actorId: req.actorId });
  }

  const minionOffer = extra > 0 ? await offerMinions(ctx, req, { groupId, entryId, extra, total: roll.total, critical }) : null;
  const prompts = afterDualityRoll(finalSheet, { hope: duality.rolled.hope, fear: duality.rolled.fear, roll }, CLASS_FEATURES, duality.scope);
  return { status: "resolved", entryId, roll, damage: damage?.roll ?? null, targets: outcomes, fearGained: gained, minionOffer, prompts };
}

/**
 * Q6 (CB p.201): the Minions still standing that the attacker may pick: Minion instances of the same encounter on the
 * map, seen with a clear line, within the weapon's range, whose Difficulty the roll beat (or a critical). Read after the
 * hits were written, so a group hit by this attack offers only its remaining Minions.
 */
async function offerMinions(
  ctx: MutationCtx,
  req: AttackRequest,
  attack: { groupId: string; entryId: Id<"actionLog">; extra: number; total: number; critical: boolean },
): Promise<Infer<typeof minionOfferValidator> | null> {
  const s = req.scene;
  const encounterId = req.targets[0]!.encounter._id;
  const range = rangeFromWeapon(req.weapon.range);
  const candidates: Infer<typeof minionOfferValidator>["candidates"] = [];
  for (const [i, token] of s.scene.tokens.entries()) {
    if (i === s.viewer.index || token.side !== "enemy" || !seenBy(s, i)) continue;
    const linked = await enemyInstance(ctx, req.loaded.campaign._id, token);
    if (linked === null || linked.encounter._id !== encounterId) continue;
    const block = await blockOf(ctx, linked.instance);
    if (!block.minion) continue;
    if (!rangeCheck(s.attacker, token, range).inRange || !sightTo(s, token).lineOfSight) continue;
    if (!attack.critical && attack.total < difficultyOf(linked.instance)) continue;
    const available = Math.min(attack.extra, linked.instance.stats.hpMax - linked.instance.hp);
    if (available > 0) candidates.push({ instanceId: linked.instance._id, tokenId: token._id, name: linked.instance.label, available });
  }
  if (candidates.length === 0) return null;
  const requestId = await openMinionOffer(ctx, {
    campaignId: req.loaded.campaign._id,
    encounterId,
    mapId: s.map._id,
    createdBy: req.actorId,
    payload: {
      schemaVersion: 1,
      kind: "minionOffer",
      characterId: req.loaded.character._id,
      groupId: attack.groupId,
      entryId: attack.entryId,
      extra: attack.extra,
      candidates: candidates.map(({ instanceId, tokenId, available }) => ({ instanceId, tokenId, available })),
    },
  });
  return { requestId, extra: attack.extra, candidates };
}
