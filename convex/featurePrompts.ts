import { v, type Infer } from "convex/values";

import { moveToken } from "../src/components/combat-map/tokens/geometry";
import { pickUse, type RunPlan } from "../src/lib/domain/card-effects/run";
import { bandOf, rangeCheck, tokenDistance } from "../src/lib/domain/combat-actions/distance";
import { actorExtras, asCardEffect } from "../src/lib/domain/feature-effects/run";
import { featureEffect } from "../src/lib/srd/feature-effects/index";
import { checkMove } from "../src/lib/domain/combat-map/movement";
import { appError } from "../src/lib/errors/app-error";
import type { CharacterSheet } from "../src/lib/validation/characters";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { cardRollValidator, keepDice, keptDice, parseChoices, type CardRoll } from "./lib/cardChoices";
import { needsChoiceValidator } from "./lib/cardRows";
import { buildRun, Creatures, extraSpecs, replaying, runCard } from "./lib/cardRunner";
import { assertCanAct, loadCharacter, readSheet } from "./lib/characterSheet";
import { attackScene, type AttackScene } from "./lib/combatActions";
import { answerCloakDifficulty, movementGrid, uncloakAfterAttack, uncloakAfterMove } from "./lib/combatMovement";
import type { MovementGrid } from "../src/lib/domain/combat-map/movement";
import { closeRequest, encounterRunning, loadOpenRequest, openDifficulty, openServerMove } from "./lib/combatRequests";
import { allyRollLive, isAllyRollRow, liveAllyRolls, liveTargetCount, optionalHope, rollAndStoreCount, rolledFirstUse, rollerUse, type AllyRollRow } from "./lib/featurePrompts";
import {
  featureRefusal,
  featureSlot,
  ownedHere,
  partyFor,
  pickFeature,
  resolveFeatureUse,
  resolvedFeatureValidator,
  type FeaturePick,
  type FeatureUseRequest,
} from "./lib/featureRunner";
import { rollDie } from "./lib/dice";
import { campaignFearState } from "./lib/fear";
import { campaignQuery, keyedCampaignMutation, keyedGmMutation } from "./lib/functions";
import { atLeast } from "./lib/permissions";

/**
 * Feature uses the server decides in part (plan drawer-answers, tracer DA12; docs/tasks/TASK-DA-DA12.md). Players act for
 * a character they edit (their own; the GM any): campaign wrappers with `need: "view"`, then `loadCharacter(..., "edit")`,
 * so another player's character is FORBIDDEN and an outsider NOT_FOUND (CF2), as `combatFeatures`.
 *
 * - `rollCount` / `targetCount`: a target count rolled before the pick (CB p.31 Warden's Protection: "Once per long rest,
 *   spend 2 Hope to clear 2 Hit Points on 1d4 allies within Close range."; user 2026-10-29, dcm-d95): the server rolls the
 *   1d4 and stores it; the player then picks at most that many allies and uses the feature through
 *   `combatFeatures.useFeature`, which takes the stored roll (convex/lib/featureRunner.ts `resolveFeatureUse`). The client
 *   never sends the count.
 * - `charge`: CB p.59 Firbolg, Charge: "When you succeed on an Agility Roll to move from Far or Very Far range into Melee
 *   range with one or more targets, you can mark a Stress to deal 1d12 physical damage to all targets within Melee range."
 *   User 2026-10-29 / 2026-10-30 (dcm-bxp.99.19.16): roll first; before the roll the player picks the Melee square next to
 *   the target; on a success the server moves the token there, on a failure there is no move. A player's Charge waits for
 *   the GM's Difficulty (dcm-bxp.99.19.61): `answerDifficulty` (plan lanes B2) runs it, as it runs a Cloaked rogue's
 *   Finesse roll that waits for one (dcm-bxp.99.19.62 (1)).
 *
 * - `allyRolls` / `allyRoll` / `cancelAllyRoll` (DA13): a use another PC rolls. CB p.33 Cannonball: "the ally makes an
 *   attack roll using Agility or Strength (their choice) against a target within Close range." User 2026-10-30
 *   (dcm-bxp.99.19.21): the druid's use (`combatFeatures.useFeature`) pays the Stress and opens the prompt; the throwing
 *   ally rolls from their own drawer with their Proficiency, Hope and critical; the GM can cancel.
 *
 * What a player receives never holds an enemy's HP, Stress, thresholds or Difficulty (U1).
 */

async function editableHere(ctx: QueryCtx & { user: Doc<"users">; campaign: Doc<"campaigns"> }, characterId: Id<"characters">) {
  const { campaign, character } = await loadCharacter(ctx, ctx.user, characterId, "edit", "owner");
  if (campaign._id !== ctx.campaign._id) throw appError("NOT_FOUND");
  return { campaign, character, sheet: readSheet(character.sheet) };
}

/** The limit keys of a feature are `feat:<featureId>[:<useId>][:<target>]` (convex/lib/featureRunner.ts). */
function limitUsed(sheet: CharacterSheet, featureId: string): boolean {
  const key = `feat:${featureId}`;
  return sheet.featureUses.some((u) => u.key === key || u.key.startsWith(`${key}:`));
}

// ---------------------------------------------------------------- a target count rolled first (Warden's Protection)

const countView = v.object({ requestId: v.id("combatRequests"), count: v.number() });

/**
 * Rolls the target count of a `rolledFirst` use (Warden's Protection's 1d4) and stores it for the use until it is used
 * or the scene ends (dcm-bxp.99.19.55 (1)). Refusals: FEATURE_NOT_OWNED, FEATURE_NOT_COMBAT, FEATURE_EXHAUSTED (the limit
 * is used), INVALID (no count to roll, or a roll of this use still open in this scene), CHARACTER_UNAVAILABLE.
 */
export const rollCount = keyedCampaignMutation({
  need: "view",
  rateLimit: "roll",
  args: {
    characterId: v.id("characters"),
    featureId: v.string(),
    useId: v.optional(v.string()),
    /** Plan lanes-2 E8 (dcm-q3t1): the numbers the count reads (Otherworldly Ire's Favor), by choice id; the use repeats them. */
    choices: v.optional(v.record(v.string(), v.number())),
  },
  returns: countView,
  handler: async (ctx, args) =>
    ctx.once("feature_roll_count", args, async () => {
      const { campaign, character, sheet } = await editableHere(ctx, args.characterId);
      assertCanAct(character, sheet);
      // Ownership and a usable (non-passive) use, as `useFeature` checks them.
      const pick = pickFeature({ sheet, campaign, featureId: args.featureId, useId: args.useId, times: 1, rollUsedExperience: false, party: [] });
      const use = rolledFirstUse(args.featureId, pick.use.id);
      if (limitUsed(sheet, args.featureId)) throw appError("FEATURE_EXHAUSTED");
      const choices = args.choices ?? {};
      if (Object.keys(choices).length > 10 || Object.values(choices).some((n) => !Number.isInteger(n) || n < 0 || n > 99)) throw appError("INVALID", "Each chosen number is a whole number from 0 to 99.");
      return rollAndStoreCount(ctx, { campaignId: campaign._id, character, sheet, featureId: args.featureId, use, userId: ctx.user._id, choices });
    }),
});

const allyChoice = v.object({
  tokenId: v.id("combatTokens"),
  name: v.string(),
  /** Within the use's range of the character's token (Close for Warden's Protection). */
  inRange: v.boolean(),
});

/**
 * The drawer's view of a `rolledFirst` use: the open roll of this scene (or null; after a reload too) and, with `mapId`,
 * the allies on the live map with whether each is within the use's range (PC names only). No allies without a live map
 * or a token of the character.
 */
export const targetCount = campaignQuery({
  need: "view",
  args: { characterId: v.id("characters"), featureId: v.string(), useId: v.optional(v.string()), mapId: v.optional(v.id("combatMaps")) },
  returns: v.object({ roll: v.union(v.null(), countView), allies: v.array(allyChoice) }),
  handler: async (ctx, args) => {
    const { campaign, character, sheet } = await editableHere(ctx, args.characterId);
    const use = rolledFirstUse(args.featureId, args.useId);
    const row = await liveTargetCount(ctx, campaign._id, args.characterId, args.featureId, use.id, sheet);
    const allies: Infer<typeof allyChoice>[] = [];
    const spec = use.targets !== undefined && use.targets.side !== "trigger" ? use.targets : undefined;
    const range = spec === undefined || spec.range === "weapon" ? "melee" : spec.range;
    if (args.mapId !== undefined) {
      try {
        const scene = await attackScene(ctx, campaign, character, args.mapId);
        for (const t of scene.scene.tokens) {
          if (t._id === scene.attacker._id || t.side !== "pc" || t.ref.kind !== "pc") continue;
          allies.push({ tokenId: t._id, name: await tokenName(ctx, campaign._id, t), inRange: range === "unlimited" || rangeCheck(scene.attacker, t, range).inRange });
        }
      } catch {
        // no live map or no token of this character: no allies to list
      }
    }
    return { roll: row === null ? null : { requestId: row._id, count: row.payload.count }, allies };
  },
});

// ---------------------------------------------------------------- Charge (Firbolg, CB p.59)

const CHARGE = "ancestry:firbolg:charge";

const squareValidator = v.object({ x: v.number(), y: v.number() });

/** Whether two square footprints overlap. */
function overlaps(a: { x: number; y: number; size: number }, b: { x: number; y: number; size: number }): boolean {
  return a.x < b.x + b.size && a.x + a.size > b.x && a.y < b.y + b.size && a.y + a.size > b.y;
}

type ChargeArgs = { targetTokenId: Id<"combatTokens">; square: { x: number; y: number } };

const sizeOf = (t: { size: number }) => Math.max(1, Math.min(3, Math.trunc(t.size) || 1));

/** Whether the target can be charged from where the token stands: an enemy at Far or Very Far range (CB p.59). */
function chargeable(attacker: Doc<"combatTokens">, target: Doc<"combatTokens">): boolean {
  if (target.side !== "enemy") return false;
  const band = bandOf(tokenDistance(attacker, target));
  return band === "far" || band === "veryFar";
}

/**
 * What is wrong with charging to the square, or null: on the map, free of other tokens, in Melee range of the target, and
 * the straight way there not blocked by a wall or a closed door for a player (the GM may pass; creatures and difficult
 * terrain don't stop it, as built in DA12 and confirmed 2026-10-30, dcm-bxp.99.19.55).
 */
function squareProblem(
  grid: MovementGrid,
  map: Doc<"combatMaps">,
  attacker: Doc<"combatTokens">,
  tokens: readonly Doc<"combatTokens">[],
  target: Doc<"combatTokens">,
  square: { x: number; y: number },
  gm: boolean,
): { code: "INVALID" | "MOVE_BLOCKED"; message?: string } | { next: { x: number; y: number; face: number } } {
  const { x, y } = square;
  const next = moveToken(attacker, x, y, map);
  if (!Number.isInteger(x) || !Number.isInteger(y) || next.x !== x || next.y !== y) return { code: "INVALID", message: "That square isn't on the map." };
  const at = { x, y, size: sizeOf(attacker) };
  if (tokens.some((t) => t._id !== attacker._id && overlaps(at, { x: t.x, y: t.y, size: sizeOf(t) }))) return { code: "MOVE_BLOCKED" };
  if (tokenDistance(at, target) !== 1) return { code: "INVALID", message: "Pick a square in Melee range of the target." };
  if (checkMove(grid, attacker, next, at.size).blocked && !gm) return { code: "MOVE_BLOCKED" };
  return { next };
}

/**
 * Checks the square before anything is rolled: the target is an enemy token at Far or Very Far range of the Firbolg's
 * token and the square passes `squareProblem`. Returns the token's next placement.
 */
async function chargeSquare(ctx: QueryCtx & { campaign: Doc<"campaigns"> }, attacker: Doc<"combatTokens">, tokens: readonly Doc<"combatTokens">[], map: Doc<"combatMaps">, args: ChargeArgs, gm: boolean) {
  const target = tokens.find((t) => t._id === args.targetTokenId);
  if (target === undefined || target.side !== "enemy") throw appError("COMBAT_TARGET_INVALID");
  if (!chargeable(attacker, target)) throw appError("INVALID", "Charge starts from Far or Very Far range of the target.");
  const out = squareProblem(await movementGrid(ctx, ctx.campaign._id, map), map, attacker, tokens, target, args.square, gm);
  if ("code" in out) throw appError(out.code, out.message);
  return { target, next: out.next };
}

/**
 * The scene with every enemy token in plain view: no walls, no cover, no vision cone. User 2026-10-30
 * (dcm-bxp.99.19.55 (2)): Charge's Stress deals its 1d12 to every enemy within Melee range of the landing square
 * "regardless of facing or sight", so the run's "all targets" are built from this view (`buildRun` keeps its usual
 * checks for every other use).
 */
function sightless(s: AttackScene): AttackScene {
  const prepared = { ...s.scene.prepared, blocked: new Uint8Array(s.scene.prepared.blocked.length) };
  const visionTokens = s.scene.visionTokens.map((t) => (t.side === "enemy" ? { ...t, side: "pc" as const } : t));
  return { ...s, scene: { ...s.scene, prepared, visionObjects: [], visionTokens } };
}

const COMPASS = ["east", "south-east", "south", "south-west", "west", "north-west", "north", "north-east"] as const;

/** "north-west of" the target, from the centres (y grows southwards on the map). */
function sideOf(at: { x: number; y: number; size: number }, target: { x: number; y: number; size: number }): string {
  const dx = at.x + at.size / 2 - (target.x + target.size / 2);
  const dy = at.y + at.size / 2 - (target.y + target.size / 2);
  const octant = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
  return COMPASS[(octant + 8) % 8]!;
}

const chargeTarget = v.object({
  tokenId: v.id("combatTokens"),
  name: v.string(),
  band: v.union(v.literal("far"), v.literal("veryFar")),
  /** The free squares in Melee range of the target the token may charge to (blocked ways left out for a player). */
  squares: v.array(v.object({ x: v.number(), y: v.number(), label: v.string() })),
});

/**
 * The drawer's Charge pick (dcm-bxp.99.19.56): the enemies the Firbolg sees at Far or Very Far range of its token, each
 * with the squares in Melee range of it that `charge` would take (names and squares only, U1). Empty without a live map
 * or a token of the character.
 */
export const chargeOptions = campaignQuery({
  need: "view",
  args: { characterId: v.id("characters"), mapId: v.id("combatMaps") },
  returns: v.array(chargeTarget),
  handler: async (ctx, args) => {
    const { campaign, character, sheet } = await editableHere(ctx, args.characterId);
    let scene: AttackScene;
    try {
      scene = await attackScene(ctx, campaign, character, args.mapId);
    } catch {
      return [];
    }
    const { attacker, map } = scene;
    const tokens = scene.scene.tokens;
    const grid = await movementGrid(ctx, campaign._id, map);
    const gm = atLeast(ctx.permission, "owner");
    const size = sizeOf(attacker);
    const out: Infer<typeof chargeTarget>[] = [];
    for (const enemy of await new Creatures(ctx, campaign._id, scene, sheet).visibleEnemies()) {
      const target = enemy.token;
      if (!chargeable(attacker, target)) continue;
      const ts = sizeOf(target);
      const squares = [];
      for (let y = target.y - size; y <= target.y + ts; y++) {
        for (let x = target.x - size; x <= target.x + ts; x++) {
          const ok = squareProblem(grid, map, attacker, tokens, target, { x, y }, gm);
          if ("next" in ok) squares.push({ x, y, label: sideOf({ x, y, size }, { x: target.x, y: target.y, size: ts }) });
        }
      }
      const band = bandOf(tokenDistance(attacker, target));
      out.push({ tokenId: target._id, name: enemy.instance.label, band: band === "veryFar" ? "veryFar" : "far", squares });
    }
    return out;
  },
});

const chargedValidator = v.object({ status: v.literal("charged"), moved: v.boolean(), use: resolvedFeatureValidator });

type ChargeRun = { mapId: Id<"combatMaps">; targetTokenId: Id<"combatTokens">; square: { x: number; y: number }; stress: boolean; roll: CardRoll & { difficulty: number } };

/**
 * Runs a Charge with its Difficulty set (the GM's own, or the GM's answer to a player's request): the use runs as from the
 * square, the server rolls Agility and, on a success, moves the token there (see `charge`). `gm` lets the way pass walls
 * (the GM's own Charge only); `actorId` owns the rows (the player whose Charge it is).
 */
async function runCharge(
  ctx: MutationCtx & { user: Doc<"users">; campaign: Doc<"campaigns"> },
  loaded: { campaign: Doc<"campaigns">; character: Doc<"characters">; sheet: CharacterSheet },
  args: ChargeRun,
  gm: boolean,
  actorId: Id<"users">,
): Promise<{ status: "charged"; moved: boolean; use: Infer<typeof resolvedFeatureValidator> } | Infer<typeof needsChoiceValidator>> {
  const { campaign, character, sheet } = loaded;
  const before = await attackScene(ctx, campaign, character, args.mapId);
  const attacker = before.attacker;
  const { target, next } = await chargeSquare(ctx, attacker, before.scene.tokens, before.map, args, gm);
  const from = { x: attacker.x, y: attacker.y, face: attacker.face };
  const putBack = () => ctx.db.patch("combatTokens", attacker._id, from);

  // Run the use as from the square: the token stands there while the run is built (one transaction; a failure, a
  // refusal or a missing choice puts it back).
  await ctx.db.patch("combatTokens", attacker._id, next);
  const scene = await attackScene(ctx, campaign, character, args.mapId);
  const party = await partyFor(ctx, campaign._id, character._id, scene, (c) => readSheet(c.sheet));
  const pick = pickFeature({ sheet, campaign, featureId: CHARGE, useId: "main", times: 1, rollUsedExperience: (args.roll.experienceIds?.length ?? 0) > 0, party, serverMove: true });
  const choices = [{ id: "optional:stress", value: args.stress }];
  const req: FeatureUseRequest = { campaign, character, sheet, scene, pick, targetTokenIds: [], choices, roll: args.roll };
  const fear = await campaignFearState(ctx, campaign._id);
  // dcm-bxp.99.19.55 (2): every enemy in Melee range of the square, whatever the Firbolg's facing or sight.
  const built = await buildRun(ctx, { campaign, character, sheet, scene: sightless(scene), pick, targetTokenIds: [], choices: parseChoices(choices), roll: args.roll, gmFear: fear.fear, lastRollWithHope: false });
  // "into Melee range with one or more targets": the picked target is one of them.
  if (!built.targets.some((t) => t.tokenId === target._id) || built.outOfRange.length > 0) throw appError("COMBAT_TARGET_INVALID");
  const kept = await keptDice(ctx, featureSlot(req));
  const outcome = runCard(built, pick, kept ? replaying(kept, rollDie) : rollDie);
  if (outcome.kind === "needsChoice") {
    await keepDice(ctx, featureSlot(req), outcome.dice, ctx.user._id);
    await putBack();
    return { status: "needsChoice" as const, asks: outcome.asks };
  }
  const moved = outcome.plan.success;
  if (!moved) await putBack();
  const use = await resolveFeatureUse(ctx, { ...req, targetTokenIds: built.targets.map((t) => t.tokenId) }, built, outcome, actorId);
  if (moved) {
    const entry = await ctx.db.get("actionLog", use.entryId);
    const encounter = built.targets.find((t) => t.kind === "enemy");
    if (entry?.groupId !== undefined) {
      await openServerMove(ctx, {
        campaignId: campaign._id,
        ...(encounter?.kind === "enemy" ? { encounterId: encounter.encounter._id } : {}),
        mapId: before.map._id,
        createdBy: actorId,
        payload: { schemaVersion: 1, kind: "serverMove", characterId: character._id, groupId: entry.groupId, tokenId: attacker._id, from, to: next },
      });
    }
    const group = entry?.groupId === undefined ? {} : { groupId: entry.groupId };
    // dcm-bxp.99.19.65 (4) (user 2026-10-30): the Stress's 1d12 damage is an attack, so an ordinary Cloaked ends (CB p.42:
    // "After you make an attack … you are no longer Cloaked"; Vanishing Act's stays), in the Charge's group.
    if (outcome.plan.steps.some((s) => s.kind === "damageRoll")) await uncloakAfterAttack(ctx, campaign, character._id, actorId, "Charge", group);
    // CB p.42 (Rogue, Cloaked): the Charge ends a move, so a Cloaked Firbolg in sight loses Cloaked (or rolls in dim
    // light) in the Charge's group: one undo reverts both (dcm-bxp.99.19.59). The Firbolg's own move, whoever clicked.
    await uncloakAfterMove(ctx, campaign, before.map, { ...attacker, ...next }, actorId, group);
  }
  return { status: "charged" as const, moved, use };
}

/** The encounter of an adversary token (a request's encounter: its end declines the request), if any. */
async function encounterOf(ctx: QueryCtx, campaignId: Id<"campaigns">, token: Doc<"combatTokens">): Promise<Id<"encounters"> | undefined> {
  if (token.ref.kind !== "adversary") return undefined;
  const instance = await ctx.db.get("encounterAdversaries", token.ref.adversaryId);
  return instance !== null && instance.campaignId === campaignId ? instance.encounterId : undefined;
}

/**
 * Charge (CB p.59). The player picks the target and a free square in Melee range of it before the roll; the server runs
 * the use as from that square (its targets are every enemy in Melee range there, seen or not: user 2026-10-30,
 * dcm-bxp.99.19.55 (2)), rolls Agility against the GM's Difficulty and, on a success, moves the token to the square (the
 * optional Stress, `stress: true`, then deals 1d12 physical damage to each of those targets); on a failure the token stays.
 * One actionLog group: undo restores the sheets, the adversaries and the square (`serverMove`). The Stress's damage is an
 * attack (dcm-bxp.99.19.65 (4)): it ends an ordinary Cloaked (`uncloakAfterAttack`); else a Cloaked Firbolg that lands in an
 * enemy's sight loses Cloaked (or rolls Finesse in dim light) in that group (`uncloakAfterMove`).
 *
 * The Difficulty is the GM's (CB p.104: "The GM sets this Difficulty"). The GM sends it in `roll.difficulty` and the Charge
 * runs at once. A player sends none (user 2026-10-30, dcm-bxp.99.19.61): the square is checked now, nothing is rolled or
 * paid, and the GM gets a `difficulty` request (`requested`); the GM's answer (`answerDifficulty`) runs it. Refusals:
 * FEATURE_NOT_OWNED, FEATURE_EXHAUSTED / FEATURE_COST_UNPAID, COMBAT_TARGET_INVALID (not an enemy), INVALID (not at Far /
 * Very Far, a square off the map or out of Melee, a GM's Charge without a Difficulty, a player's with one), MOVE_BLOCKED
 * (an occupied square, a blocked way for a player), COMBAT_MAP_NOT_FOUND / COMBAT_TOKEN_NOT_FOUND, CHARACTER_UNAVAILABLE.
 */
export const charge = keyedCampaignMutation({
  need: "view",
  rateLimit: "roll",
  args: {
    characterId: v.id("characters"),
    mapId: v.id("combatMaps"),
    targetTokenId: v.id("combatTokens"),
    square: squareValidator,
    /** Mark a Stress for the 1d12 physical damage (the optional step, taken on a success). */
    stress: v.boolean(),
    roll: cardRollValidator,
  },
  returns: v.union(chargedValidator, needsChoiceValidator, v.object({ status: v.literal("requested"), requestId: v.id("combatRequests") })),
  handler: async (ctx, args) =>
    ctx.once("feature_charge", args, async () => {
      const { campaign, character, sheet } = await editableHere(ctx, args.characterId);
      assertCanAct(character, sheet);
      const gm = atLeast(ctx.permission, "owner");
      const difficulty = args.roll.difficulty;
      if (gm) {
        if (difficulty === undefined) throw appError("INVALID", "Charge needs your Difficulty for the Agility Roll.");
        return runCharge(ctx, { campaign, character, sheet }, { ...args, roll: { ...args.roll, difficulty } }, true, ctx.user._id);
      }
      if (difficulty !== undefined) throw appError("INVALID", "The GM sets the Difficulty of the Agility Roll.");
      // The player's Charge waits for the GM: check what can be checked now (the feature, the target, the square).
      pickFeature({ sheet, campaign, featureId: CHARGE, useId: "main", times: 1, rollUsedExperience: false, party: [], serverMove: true });
      if (limitUsed(sheet, CHARGE)) throw appError("FEATURE_EXHAUSTED");
      const before = await attackScene(ctx, campaign, character, args.mapId);
      const { target } = await chargeSquare(ctx, before.attacker, before.scene.tokens, before.map, args, false);
      const encounterId = await encounterOf(ctx, campaign._id, target);
      const requestId = await openDifficulty(ctx, {
        campaignId: campaign._id,
        ...(encounterId === undefined ? {} : { encounterId }),
        mapId: before.map._id,
        createdBy: ctx.user._id,
        payload: { schemaVersion: 1, kind: "difficulty", characterId: character._id, ask: { kind: "charge", targetTokenId: args.targetTokenId, square: args.square, stress: args.stress, roll: args.roll } },
      });
      return { status: "requested" as const, requestId };
    }),
});

/**
 * The GM answers a `difficulty` request (plan lanes B2; CB p.104 "The GM sets this Difficulty"): `difficulty` (a whole
 * number, 1 or more) rolls now, `null` declines.
 * - `charge` (dcm-bxp.99.19.61): the player's Charge runs as `charge` would with that Difficulty (the server rolls Agility
 *   and moves the token on a success), its rows the player's; the way is checked as for the player (walls stop it).
 *   Refusals as `charge`'s (the request stays open so the GM can decline it).
 * - `cloak` (dcm-bxp.99.19.62 (1)): the rogue's Finesse roll against it (`answerCloakDifficulty`); `stale` when the move no
 *   longer stands (the token moved on, Cloaked ended, the map is no longer live, the move was undone).
 * A request whose encounter ended is declined. REQUEST_NOT_OPEN once answered; NOT_FOUND for another campaign's or
 * another kind of request; INVALID for a Difficulty that is not a whole number of 1 or more.
 */
export const answerDifficulty = keyedGmMutation({
  rateLimit: "roll",
  args: { requestId: v.id("combatRequests"), difficulty: v.union(v.number(), v.null()) },
  returns: v.union(
    chargedValidator,
    v.object({ status: v.literal("rolled"), cloaked: v.boolean() }),
    v.object({ status: v.literal("declined") }),
    v.object({ status: v.literal("stale") }),
  ),
  handler: async (ctx, { requestId, difficulty }) =>
    ctx.once("feature_answer_difficulty", { requestId, difficulty }, async () => {
      const row = await loadOpenRequest(ctx, ctx.campaign._id, requestId);
      const p = row.payload;
      if (p.kind !== "difficulty") throw appError("NOT_FOUND");
      if (difficulty !== null && (!Number.isInteger(difficulty) || difficulty < 1)) throw appError("INVALID", "The Difficulty is a whole number of 1 or more.");
      if (difficulty === null || !(await encounterRunning(ctx, row))) {
        await closeRequest(ctx, row._id, "declined", ctx.user._id);
        return { status: "declined" as const };
      }
      if (p.ask.kind === "cloak") return answerCloakDifficulty(ctx, ctx.campaign, row, difficulty, ctx.user._id);
      const character = await ctx.db.get("characters", p.characterId);
      if (character === null || character.campaignId !== ctx.campaign._id || row.mapId === undefined) throw appError("COMBAT_TARGET_INVALID");
      const sheet = readSheet(character.sheet);
      assertCanAct(character, sheet);
      const ask = p.ask;
      const roll: ChargeRun["roll"] = {
        ...(ask.roll.trait === undefined ? {} : { trait: ask.roll.trait }),
        ...(ask.roll.modifier === undefined ? {} : { modifier: ask.roll.modifier }),
        ...(ask.roll.experienceIds === undefined ? {} : { experienceIds: ask.roll.experienceIds }),
        ...(ask.roll.advantage === undefined ? {} : { advantage: ask.roll.advantage }),
        ...(ask.roll.disadvantage === undefined ? {} : { disadvantage: ask.roll.disadvantage }),
        ...(ask.roll.help === undefined ? {} : { help: ask.roll.help }),
        difficulty,
      };
      const out = await runCharge(ctx, { campaign: ctx.campaign, character, sheet }, { mapId: row.mapId, targetTokenId: ask.targetTokenId, square: ask.square, stress: ask.stress, roll }, false, row.createdBy);
      if (out.status === "needsChoice") throw appError("INVALID", "This Charge needs another choice: decline it and play it for the player.");
      await closeRequest(ctx, row._id, "resolved", ctx.user._id);
      return out;
    }),
});

// ---------------------------------------------------------------- a use rolled by an ally (Cannonball, CB p.33)

/** The name a player may see for a token: a PC's name, an adversary instance's label (no numbers, U1). */
async function tokenName(ctx: QueryCtx, campaignId: Id<"campaigns">, token: Doc<"combatTokens">): Promise<string> {
  if (token.ref.kind === "custom") return token.ref.name;
  if (token.ref.kind === "companion") return "Companion";
  if (token.ref.kind === "pc") {
    const c = await ctx.db.get("characters", token.ref.characterId);
    return c === null || c.campaignId !== campaignId ? "Unknown" : readSheet(c.sheet).name;
  }
  const instance = await ctx.db.get("encounterAdversaries", token.ref.adversaryId);
  return instance !== null && instance.campaignId === campaignId ? instance.label : "Unknown";
}

async function characterName(ctx: QueryCtx, campaignId: Id<"campaigns">, id: Id<"characters">): Promise<string> {
  const c = await ctx.db.get("characters", id);
  return c === null || c.campaignId !== campaignId ? "Unknown" : readSheet(c.sheet).name;
}

function featureName(featureId: string): string {
  return featureEffect(featureId)?.uses[0]?.name ?? featureId;
}

const enemyChoice = v.object({
  tokenId: v.id("combatTokens"),
  name: v.string(),
  /** Within the throw's range of the ally (Close for Cannonball). */
  inRange: v.boolean(),
  /** The other enemies the second target may be (Very Close of this one, for Cannonball's Hope). */
  near: v.array(v.id("combatTokens")),
});

const askView = v.object({
  requestId: v.id("combatRequests"),
  /** Who is thrown (the druid) and the feature. */
  characterName: v.string(),
  featureName: v.string(),
  /** The druid's Hope now: the second target spends one of it. */
  hope: v.number(),
  /** The optional step that adds the second target, or null. */
  secondLabel: v.union(v.null(), v.string()),
  enemies: v.array(enemyChoice),
});

const allyRollsView = v.object({
  /** Rolls this character is asked to make (their drawer's prompt). */
  asks: v.array(askView),
  /** This character's own throws waiting for an ally. */
  waiting: v.array(v.object({ requestId: v.id("combatRequests"), rollerName: v.string(), featureName: v.string() })),
  /** The PCs on the map this character can ask (for the druid's throw); empty without a map or a token. */
  allies: v.array(v.object({ tokenId: v.id("combatTokens"), name: v.string() })),
  /** GM: every open ally roll of the campaign (the pending list, with Cancel). Empty for a player. */
  pending: v.array(v.object({ requestId: v.id("combatRequests"), characterName: v.string(), rollerName: v.string(), featureName: v.string(), createdAt: v.number() })),
});

/** The enemies the roller sees on the map, with the throw's range and which may be the second target (U1: names only). */
async function enemyChoices(ctx: QueryCtx, campaign: Doc<"campaigns">, roller: Doc<"characters">, row: AllyRollRow): Promise<Infer<typeof enemyChoice>[]> {
  if (row.mapId === undefined) return [];
  const use = pickUse(asCardEffect(featureEffect(row.payload.featureId)!), row.payload.useId);
  if (use?.rolledBy === undefined) return [];
  let scene;
  try {
    scene = await attackScene(ctx, campaign, roller, row.mapId);
  } catch {
    return [];
  }
  const enemies = await new Creatures(ctx, campaign._id, scene, readSheet(roller.sheet)).visibleEnemies();
  const second = extraSpecs(rollerUse(use)).picked;
  const nearRange = second?.areaRange ?? second?.range ?? "veryClose";
  return enemies.map((e) => ({
    tokenId: e.tokenId,
    name: e.instance.label,
    inRange: rangeCheck(scene.attacker, e.token, use.rolledBy!.targets.range === "weapon" ? "melee" : use.rolledBy!.targets.range).inRange,
    near: enemies.filter((o) => o.tokenId !== e.tokenId && rangeCheck(e.token, o.token, nearRange === "weapon" ? "melee" : nearRange).inRange).map((o) => o.tokenId),
  }));
}

/**
 * DA13: the ally rolls of a character the caller edits (their own; the GM any): the rolls they are asked to make, their
 * own throws waiting for an ally, the PCs on `mapId` they can ask, and for the GM every open one. Names and bands only
 * (U1): no adversary numbers.
 */
export const allyRolls = campaignQuery({
  need: "view",
  args: { characterId: v.id("characters"), mapId: v.optional(v.id("combatMaps")) },
  returns: allyRollsView,
  handler: async (ctx, args) => {
    const { campaign, character } = await editableHere(ctx, args.characterId);
    const rows = await liveAllyRolls(ctx, campaign._id);
    const asks = [];
    const waiting = [];
    for (const row of rows) {
      const p = row.payload;
      if (p.rollerCharacterId === character._id) {
        const druid = await ctx.db.get("characters", p.characterId);
        if (druid === null || druid.campaignId !== campaign._id) continue;
        const use = pickUse(asCardEffect(featureEffect(p.featureId)!), p.useId);
        const second = use?.steps.find((s) => s.kind === "optional");
        const druidSheet = readSheet(druid.sheet);
        asks.push({
          requestId: row._id,
          characterName: druidSheet.name,
          featureName: featureName(p.featureId),
          hope: druidSheet.hope,
          secondLabel: second?.kind === "optional" ? second.label : null,
          enemies: await enemyChoices(ctx, campaign, character, row),
        });
      }
      if (p.characterId === character._id) waiting.push({ requestId: row._id, rollerName: await characterName(ctx, campaign._id, p.rollerCharacterId), featureName: featureName(p.featureId) });
    }
    const allies = [];
    if (args.mapId !== undefined) {
      try {
        const scene = await attackScene(ctx, campaign, character, args.mapId);
        for (const t of scene.scene.tokens) {
          if (t._id === scene.attacker._id || t.side !== "pc" || t.ref.kind !== "pc") continue;
          allies.push({ tokenId: t._id, name: await tokenName(ctx, campaign._id, t) });
        }
      } catch {
        // no live map or no token of this character: nobody to ask
      }
    }
    const pending = [];
    if (atLeast(ctx.permission, "owner")) {
      for (const row of rows) {
        pending.push({
          requestId: row._id,
          characterName: await characterName(ctx, campaign._id, row.payload.characterId),
          rollerName: await characterName(ctx, campaign._id, row.payload.rollerCharacterId),
          featureName: featureName(row.payload.featureId),
          createdAt: row.createdAt,
        });
      }
    }
    return { asks, waiting, allies, pending };
  },
});

/** The open ally roll with this id, or NOT_FOUND (another kind, another campaign); REQUEST_NOT_OPEN once answered. */
async function loadAllyRoll(ctx: QueryCtx & { campaign: Doc<"campaigns"> }, requestId: Id<"combatRequests">): Promise<AllyRollRow> {
  const row = await loadOpenRequest(ctx, ctx.campaign._id, requestId);
  if (!isAllyRollRow(row)) throw appError("NOT_FOUND");
  return row;
}

/**
 * The ally's roll of a use rolled by an ally (CB p.33 Cannonball: "the ally makes an attack roll using Agility or Strength
 * (their choice) against a target within Close range. On a success, the adversary takes d12+2 physical damage using the
 * thrower's Proficiency. You can spend a Hope to target an additional adversary within Very Close range of the first. The
 * second target takes half the damage dealt to the first target."). User 2026-10-30 (dcm-bxp.99.19.21): the throwing ally
 * rolls from their own drawer; the damage uses their Proficiency; the roll's Hope / Fear and a critical are theirs.
 *
 * The caller edits the ally (their player, or the GM playing for them). The use runs as the ally's own (their traits,
 * Experiences, Hope, critical; range and sight from their token, `rollerUse`). `secondTokenId` takes the optional step and
 * spends the druid's Hope for it ("You can spend a Hope"; QUESTIONS 1 of TASK-DA-DA13.md). One actionLog group: the
 * ally's row (their Hope), the druid's row (their Hope) and the GM's row (the adversaries before); undo reverts it.
 * Returns `closed` (and closes the row) when the druid's use was undone or the roll expired.
 *
 * Refusals: NOT_FOUND, REQUEST_NOT_OPEN, FORBIDDEN (another player's ally), CHARACTER_UNAVAILABLE, COMBAT_MAP_NOT_FOUND /
 * COMBAT_TOKEN_NOT_FOUND, COMBAT_TARGET_INVALID (no enemy, the second the same as the first, out of range),
 * COMBAT_NO_LINE_OF_SIGHT, FEATURE_COST_UNPAID (the druid has no Hope for the second target).
 */
export const allyRoll = keyedCampaignMutation({
  need: "view",
  rateLimit: "roll",
  args: {
    requestId: v.id("combatRequests"),
    trait: v.union(v.literal("agility"), v.literal("strength")),
    targetTokenId: v.id("combatTokens"),
    secondTokenId: v.optional(v.id("combatTokens")),
    /** The roller's Experiences, advantage and modifiers (as `useFeature`); `trait` is the argument above. */
    roll: v.optional(cardRollValidator),
  },
  returns: v.union(resolvedFeatureValidator, v.object({ status: v.literal("closed") })),
  handler: async (ctx, args) =>
    ctx.once("feature_ally_roll", args, async () => {
      const row = await loadAllyRoll(ctx, args.requestId);
      const p = row.payload;
      const { campaign, character: ally, sheet: allySheet } = await editableHere(ctx, p.rollerCharacterId);
      if (!(await allyRollLive(ctx, row))) {
        await closeRequest(ctx, row._id, "declined", ctx.user._id);
        return { status: "closed" as const };
      }
      assertCanAct(ally, allySheet);
      if (args.secondTokenId !== undefined && args.secondTokenId === args.targetTokenId) throw appError("COMBAT_TARGET_INVALID", "The second target is another adversary.");
      const druid = await ctx.db.get("characters", p.characterId);
      if (druid === null || druid.campaignId !== campaign._id || row.mapId === undefined) throw appError("COMBAT_TARGET_INVALID");
      const druidSheet = readSheet(druid.sheet);
      const entry = featureEffect(p.featureId);
      const base = entry === undefined ? undefined : pickUse(asCardEffect(entry), p.useId);
      if (entry === undefined || base?.rolledBy === undefined) throw appError("INVALID", "That use is not rolled by an ally.");
      const use = rollerUse(base);
      const second = use.steps.find((s) => s.kind === "optional");
      const secondId = second?.kind === "optional" ? second.id : null;
      if (args.secondTokenId !== undefined && secondId === null) throw appError("INVALID", "That use has no second target.");
      const hopeCost = args.secondTokenId !== undefined && secondId !== null ? optionalHope(base, secondId) : 0;
      if (druidSheet.hope < hopeCost) throw appError("FEATURE_COST_UNPAID", `Short of: ${hopeCost} Hope (${druidSheet.name}).`);

      const name = featureName(p.featureId);
      const feature = ownedHere(druidSheet, campaign).find((f) => f.featureId === p.featureId) ?? { featureId: p.featureId, source: entry.source, owner: entry.owner, name, text: "", usage: "combat" as const };
      const effect = { ...asCardEffect(entry), uses: [use] };
      const druidProficiency = base.rolledBy.proficiency === "actor" ? { proficiency: druidSheet.proficiency } : {};
      const pick: FeaturePick = {
        effect,
        use,
        name,
        limitKey: `feat:${p.featureId}`,
        featureId: p.featureId,
        feature,
        party: [],
        times: 1,
        refusal: featureRefusal,
        actor: (a) => ({ ...a, ...actorExtras(allySheet), ...druidProficiency }),
      };
      const roll = { ...(args.roll ?? {}), trait: args.trait };
      const choices = [
        ...(args.secondTokenId !== undefined && secondId !== null ? [{ id: `optional:${secondId}`, value: true }, { id: "picked", value: [args.secondTokenId] }] : []),
      ];
      const scene = await attackScene(ctx, campaign, ally, row.mapId);
      const fear = await campaignFearState(ctx, campaign._id);
      const built = await buildRun(ctx, { campaign, character: ally, sheet: allySheet, scene, pick, targetTokenIds: [args.targetTokenId], choices: parseChoices(choices), roll, gmFear: fear.fear, lastRollWithHope: false });
      if (built.targets.some((t) => t.kind !== "enemy")) throw appError("COMBAT_TARGET_INVALID");
      if (built.outOfRange.length > 0) throw appError("COMBAT_TARGET_INVALID", "Out of range: the target is within Close range of you, the second within Very Close range of the first.");
      const req: FeatureUseRequest = { campaign, character: ally, sheet: allySheet, scene, pick, targetTokenIds: [args.targetTokenId], choices, roll };
      const outcome = runCard(built, pick, rollDie);
      if (outcome.kind === "needsChoice") throw appError("INVALID", "The throw needs no other choice.");
      const druidAfter = { ...druidSheet, hope: druidSheet.hope - hopeCost };
      const use_ = await resolveFeatureUse(ctx, req, built, { plan: oneDamageRoll(outcome.plan) }, ctx.user._id, {
        title: `${allySheet.name} throws ${druidSheet.name} (${name})`,
        sheets: [{ character: druid, before: druidSheet, after: druidAfter }],
      });
      await closeRequest(ctx, row._id, "resolved", ctx.user._id);
      return use_;
    }),
});

/** The second target's half damage reuses the first target's roll (the runner's cached roll): list that roll once. */
function oneDamageRoll(plan: RunPlan): RunPlan {
  const seen = new Set<unknown>();
  return { ...plan, steps: plan.steps.filter((s) => s.kind !== "damageRoll" || (seen.has(s.record) ? false : (seen.add(s.record), true))) };
}

/** The GM cancels an open ally roll (the druid's Stress stays paid; undoing the druid's use gives it back). */
export const cancelAllyRoll = keyedGmMutation({
  args: { requestId: v.id("combatRequests") },
  returns: v.null(),
  handler: async (ctx, { requestId }) =>
    ctx.once("feature_ally_roll_cancel", { requestId }, async () => {
      const row = await loadAllyRoll(ctx, requestId);
      await closeRequest(ctx, row._id, "declined", ctx.user._id);
      return null;
    }),
});
