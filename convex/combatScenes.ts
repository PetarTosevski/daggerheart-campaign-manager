/**
 * Scene end for the Combat Map (plan sheet-drawer SD8, Q7; docs/tasks/TASK-SD-SD8.md). CB p.107, End of the Scene:
 * "At the GM's discretion, a scene continues until the current narrative situation has played out. … A battle scene
 * usually ends when one side has fled, surrendered, or been entirely defeated."
 *
 * A scene ends when the GM ends the running encounter (`encounters.end` calls `endScene`), when the GM presses End scene
 * on the Combat Map or the Encounter tab (`combatScenes.end`), or when the session ends (`expire(sheet, "session")`
 * ends the scene's sheet state too). Ending it:
 * - for every active PC `expire(sheet, "scene")`: effects and feature uses that last until the scene, the Unstoppable
 *   Die, the active stance and Walk Between Worlds' tokens (src/lib/domain/characters/expiry.ts);
 * - ends the campaign's live map areas that last until the scene (`combatAreas.expires` `scene`);
 * - forgets which adversaries the party has seen this scene (`combatSeen`, user 2026-11-03, convex/lib/spotlightSeen.ts);
 * - DA10: ends what ends with the stance (Grappling's Restrain on its instance, convex/lib/stanceDrop.ts); the campaign
 *   row carries the instances' `adversaryBefore`, so undo restores them.
 * The dashboard's End scene (`scenes.end`, RF1) runs the same `endScene`; the session end (`sessions.end`) closes the
 * `scene` and `session` areas through `endSceneAreas` (plan drawer-answers DA4).
 *
 * One mutation writes one undoable `actionLog` group (kind `session`, a row per changed PC and a campaign row "Scene
 * ended"); undoing the campaign row restores every sheet. Areas keep their own history (like trackers): undo does not
 * bring one back, the feature is used again.
 */
import { v, type Infer } from "convex/values";

import { expire } from "../src/lib/domain/characters/expiry";
import { BREATH_MIN, BREATH_START, darknessBadge } from "../src/lib/domain/combat-map/light";
import { MAX_COUNTDOWN_START } from "../src/lib/domain/countdowns/index";
import { appError } from "../src/lib/errors/app-error";
import type { CharacterSheet } from "../src/lib/validation/characters";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { logAction, newGroupId } from "./lib/actionLog";
import { campaignLight } from "./lib/campaignLight";
import { MAX_CHARACTERS_PER_CAMPAIGN, readSheet, saveSheet } from "./lib/characterSheet";
import { liveCombatMap, loadCombatMap, loadCombatToken, MAX_COMBAT_TOKENS } from "./lib/combatMaps";
import { campaignQuery, keyedGmMutation } from "./lib/functions";
import { atLeast } from "./lib/permissions";
import { liveUnderwater } from "./lib/rollAftermath";
import { ruleMode, ruleModesOf } from "./lib/ruleModes";
import { forgetSeen } from "./lib/spotlightSeen";
import { endStanceConditions, withoutStance } from "./lib/stanceDrop";
import type { AreaExpires } from "./lib/validators/combatMaps";
import { recordHistory } from "./tables/history";

/** Sheets one scene end may change: an undo group holds at most 50 rows (convex/lib/actionLog.ts), one is the campaign's. */
const PARTY_MAX = 49;

/** Areas a scene end closes in one transaction (a campaign draws few at a time; ended ones are swept by the cron). */
const AREAS_MAX = 200;

export type SceneEnded = {
  /** Scene effects, feature limits and states (Unstoppable Die, stance) ended across the party. */
  ended: number;
  /** Live map areas closed. */
  areas: number;
  /** The campaign row of the group (undo it to undo the whole End), or null when nothing changed. */
  entryId: Id<"actionLog"> | null;
};

/** How many scene things `expire(…, "scene")` took off a sheet. */
function sceneThings(before: CharacterSheet, after: CharacterSheet): number {
  return (
    before.effects.length -
    after.effects.length +
    ((before.featureUses?.length ?? 0) - (after.featureUses?.length ?? 0)) +
    (before.classState.unstoppable !== undefined && after.classState.unstoppable === undefined ? 1 : 0) +
    (before.classState.martial?.active !== undefined && after.classState.martial?.active === undefined ? 1 : 0) +
    ((before.cardTokens?.length ?? 0) - (after.cardTokens?.length ?? 0))
  );
}

/**
 * Closes the campaign's live areas that last until the scene; returns how many. The session end passes
 * `["scene", "session"]`: it ends the scene too (Q7, CB p.107).
 */
export async function endSceneAreas(
  ctx: MutationCtx,
  campaignId: Id<"campaigns">,
  now: number,
  expires: readonly AreaExpires[] = ["scene"],
): Promise<number> {
  const rows = await ctx.db
    .query("combatAreas")
    .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
    .take(AREAS_MAX);
  const live = rows.filter((a) => a.status === "active" && expires.includes(a.expires));
  for (const area of live) await ctx.db.patch("combatAreas", area._id, { status: "ended", endedAt: now });
  return live.length;
}

/**
 * Ends the scene for the campaign (the caller is the GM: an encounter end or the End scene button). Nothing to end
 * on the sheets writes no log rows.
 */
export async function endScene(ctx: MutationCtx, campaign: Doc<"campaigns">, actorId: Id<"users">): Promise<SceneEnded> {
  const campaignId = campaign._id;
  const rows = await ctx.db
    .query("characters")
    .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
    .take(MAX_CHARACTERS_PER_CAMPAIGN);

  const changes = rows
    .filter((character) => character.status === "active")
    .flatMap((character) => {
      try {
        const sheet = readSheet(character.sheet);
        // DA10 (HF p.12): the stance drops at the scene's end, and what ends with it (Grappling's Restrain markers).
        const off = withoutStance(sheet);
        const next = expire(off.sheet, "scene");
        const ended = sceneThings(sheet, next);
        return ended > 0 ? [{ character, sheet, next, ended, markers: off.markers }] : [];
      } catch {
        return []; // a corrupt sheet is left alone
      }
    });
  if (changes.length > PARTY_MAX) throw appError("INVALID", `A scene can update at most ${PARTY_MAX} characters; remove some from the campaign.`);
  const areas = await endSceneAreas(ctx, campaignId, Date.now());
  // The next scene starts unseen: players learn a spotlighted adversary only once the party sees it again (user
  // 2026-11-03, convex/lib/spotlightSeen.ts). Outside the undo group, like the areas.
  await forgetSeen(ctx, campaignId);
  if (changes.length === 0) return { ended: 0, areas, entryId: null };

  const groupId = newGroupId();
  const released = await endStanceConditions(ctx, campaignId, changes.flatMap((c) => c.markers));
  for (const { character, sheet, next } of changes) {
    await saveSheet(ctx, character._id, next);
    await logAction(ctx, { campaignId, characterId: character._id, actorId, kind: "session", visibility: "public", summary: `${sheet.name}: scene end`, groupId, before: sheet, undoable: true });
  }
  const ended = changes.reduce((sum, c) => sum + c.ended, 0);
  const entryId = await logAction(ctx, {
    campaignId,
    actorId,
    kind: "session",
    visibility: "public",
    summary: [`Scene ended; ${ended} scene effect${ended === 1 ? "" : "s"} and limit${ended === 1 ? "" : "s"} ended`, ...released.lines].join("; "),
    groupId,
    ...(released.before.length > 0 ? { adversaryBefore: released.before } : {}),
    undoable: true,
  });
  return { ended, areas, entryId };
}

/** The GM's End scene button on the Combat Map and the Encounter tab. */
export const end = keyedGmMutation({
  args: {},
  returns: v.object({
    ended: v.number(),
    areas: v.number(),
    entryId: v.union(v.id("actionLog"), v.null()),
  }),
  handler: async (ctx) => ctx.once("combat_scene_end", {}, () => endScene(ctx, ctx.campaign, ctx.user._id)),
});

// ---------------------------------------------------------------- the environment (plan rule-switches OE)

/** A creature on the live map the GM can mark "fights underwater" (CB p.168: "like a Siren or Shark"). */
const environmentCreature = v.object({
  tokenId: v.id("combatTokens"),
  name: v.string(),
  side: v.string(),
  fightsUnderwater: v.boolean(),
  /** Plan OE2: whether the token is a PC's (only a PC can be marked as breathing underwater). */
  pc: v.boolean(),
  /** Plan OE2: a PC the GM marked as breathing underwater (no breath tick, no Stress); false for every other token. */
  breathesUnderwater: v.boolean(),
});

const environmentValidator = v.object({
  /** M3's badge for the campaign's light, naming the active mode (`darknessBadge`); null outside dim light or in Manual. */
  darkness: v.union(v.string(), v.null()),
  /** The Underwater optional rule is on in this campaign. */
  underwaterRule: v.boolean(),
  /** The live map, when there is one. */
  mapId: v.union(v.id("combatMaps"), v.null()),
  /** The live map is marked Underwater (rule on). */
  underwater: v.boolean(),
  /** Its breath countdown, while underwater. */
  breath: v.union(v.object({ countdownId: v.id("countdowns"), current: v.number(), start: v.number(), status: v.string() }), v.null()),
  /** GM and co-GMs: they mark the scene and the creatures. */
  canEdit: v.boolean(),
  /** GM only (players get []): the creatures on the live map while the rule is on. */
  creatures: v.array(environmentCreature),
});

/** A token's name for the GM's list: the PC's name, the instance's label, the custom name. */
async function creatureName(ctx: QueryCtx, campaignId: Id<"campaigns">, token: Doc<"combatTokens">): Promise<string> {
  if (token.ref.kind === "custom") return token.ref.name;
  if (token.ref.kind === "companion") return "Companion";
  if (token.ref.kind === "pc") {
    const c = await ctx.db.get("characters", token.ref.characterId);
    return c === null || c.campaignId !== campaignId ? "Unknown" : readSheet(c.sheet).name;
  }
  const instance = await ctx.db.get("encounterAdversaries", token.ref.adversaryId);
  return instance !== null && instance.campaignId === campaignId ? instance.label : "Unknown";
}

/**
 * The scene's environment for the HUD (every member): M3's dim-light badge naming the active mode, and the Underwater
 * state of the live map with its breath countdown. The GM also gets the creatures to mark "fights underwater".
 */
export const environment = campaignQuery({
  need: "view",
  enough: "owner",
  args: {},
  returns: environmentValidator,
  handler: async (ctx) => {
    const { campaign } = ctx;
    const modes = ruleModesOf(campaign);
    const { light } = await campaignLight(ctx, campaign);
    const canEdit = atLeast(ctx.permission, "owner");
    const map = await liveCombatMap(ctx, campaign._id);
    const scene = await liveUnderwater(ctx, campaign);
    const breath = scene?.breath ?? null;
    const creatures: Infer<typeof environmentCreature>[] = [];
    if (canEdit && modes.underwater && map !== null) {
      const tokens = await ctx.db
        .query("combatTokens")
        .withIndex("by_map", (q) => q.eq("mapId", map._id))
        .take(MAX_COMBAT_TOKENS);
      for (const t of tokens) {
        const pc = t.ref.kind === "pc";
        creatures.push({ tokenId: t._id, name: await creatureName(ctx, campaign._id, t), side: t.side, fightsUnderwater: t.fightsUnderwater === true, pc, breathesUnderwater: pc && t.breathesUnderwater === true });
      }
    }
    return {
      darkness: darknessBadge(light, modes.darkness, modes.darknessDifficulty),
      underwaterRule: modes.underwater,
      mapId: map?._id ?? null,
      underwater: scene !== null,
      breath: breath === null ? null : { countdownId: breath._id, current: breath.currentValue, start: breath.startingValue, status: breath.status },
      canEdit,
      creatures,
    };
  },
});

/** MECHANIC_DISABLED unless the Underwater optional rule is on. */
function assertUnderwaterOn(campaign: Doc<"campaigns">): void {
  if (!ruleMode(campaign, "underwater")) throw appError("MECHANIC_DISABLED", "The Underwater rule is off in this campaign.");
}

/** A breath start: a whole number from 3 (CB p.168: "3 or higher") to the countdown cap, else INVALID. */
function breathStart(value: number | undefined): number {
  const start = value ?? BREATH_START;
  if (!Number.isInteger(start) || start < BREATH_MIN || start > MAX_COUNTDOWN_START) {
    throw appError("INVALID", `The breath countdown starts between ${BREATH_MIN} and ${MAX_COUNTDOWN_START}.`);
  }
  return start;
}

/**
 * The GM marks a Combat Map scene Underwater, or not (optional rule, CB p.168; plan rule-switches OE). On: creates the
 * scene's breath countdown (a public, unarmed dashboard countdown "Breath", start `breath`, default 3), which every PC
 * action roll on the live map ticks (`rollAftermath`); again with another `breath` restarts it there. Off: cancels the
 * countdown. MECHANIC_DISABLED while the rule is off; COMBAT_MAP_NOT_FOUND for another campaign's map; INVALID for a
 * start outside 3..20. A public feed line says what changed (not undoable: the GM switches it back).
 */
export const setUnderwater = keyedGmMutation({
  args: { mapId: v.id("combatMaps"), underwater: v.boolean(), breath: v.optional(v.number()) },
  returns: v.object({ breathCountdownId: v.union(v.id("countdowns"), v.null()) }),
  handler: async (ctx, { mapId, underwater, breath }) =>
    ctx.once("combat_scene_underwater", { mapId, underwater, breath }, async () => {
      const campaign = ctx.campaign;
      assertUnderwaterOn(campaign);
      const map = await loadCombatMap(ctx, campaign._id, mapId);
      const start = breathStart(breath);
      const existing = map.breathCountdownId === undefined ? null : await ctx.db.get("countdowns", map.breathCountdownId);
      const countdown = existing !== null && existing.campaignId === campaign._id && existing.status !== "cancelled" ? existing : null;
      const log = (summary: string) => logAction(ctx, { campaignId: campaign._id, actorId: ctx.user._id, kind: "combat", visibility: "public", summary, undoable: false });

      if (!underwater) {
        if (countdown !== null) {
          await ctx.db.patch("countdowns", countdown._id, { status: "cancelled" });
          await recordHistory(ctx, ctx.user._id, {
            campaignId: campaign._id,
            kind: "countdown",
            action: "cancel",
            countdownId: countdown._id,
            before: { currentValue: countdown.currentValue, status: countdown.status },
            after: { currentValue: countdown.currentValue, status: "cancelled" },
          });
        }
        if (map.underwater === true || map.breathCountdownId !== undefined) {
          await ctx.db.patch("combatMaps", map._id, { underwater: undefined, breathCountdownId: undefined });
          await log(`${map.name} is no longer underwater`);
        }
        return { breathCountdownId: null };
      }

      if (map.underwater === true && countdown !== null) {
        // Already underwater: a new start restarts the breath countdown.
        if (breath !== undefined && (countdown.startingValue !== start || countdown.currentValue !== start || countdown.status !== "active")) {
          await ctx.db.patch("countdowns", countdown._id, { startingValue: start, currentValue: start, status: "active", completedAt: undefined });
          await recordHistory(ctx, ctx.user._id, {
            campaignId: campaign._id,
            kind: "countdown",
            action: "set",
            countdownId: countdown._id,
            before: { currentValue: countdown.currentValue, status: countdown.status, startingValue: countdown.startingValue },
            after: { currentValue: start, status: "active", startingValue: start },
          });
          await log(`${map.name}: the breath countdown starts again at ${start}`);
        }
        return { breathCountdownId: countdown._id };
      }

      const breathCountdownId = await ctx.db.insert("countdowns", {
        campaignId: campaign._id,
        name: "Breath",
        description: `Underwater: ${map.name}`.slice(0, 200),
        category: "consequence",
        startingValue: start,
        currentValue: start,
        status: "active",
        consequence: "Each PC action underwater marks a Stress.",
        createdAt: Date.now(),
        kind: "breath",
      });
      await recordHistory(ctx, ctx.user._id, { campaignId: campaign._id, kind: "countdown", action: "create", countdownId: breathCountdownId, before: null, after: { currentValue: start, status: "active" } });
      await ctx.db.patch("combatMaps", map._id, { underwater: true, breathCountdownId });
      await log(`${map.name} is underwater: attack rolls have disadvantage; breath ${start}`);
      return { breathCountdownId };
    }),
});

/**
 * The GM marks a creature's token as fighting easily underwater (CB p.168: "like a Siren or Shark making an attack on a
 * PC"): its attack rolls get no Underwater disadvantage. MECHANIC_DISABLED while the rule is off; COMBAT_TOKEN_NOT_FOUND
 * for another campaign's token.
 */
export const setFightsUnderwater = keyedGmMutation({
  args: { tokenId: v.id("combatTokens"), fightsUnderwater: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { tokenId, fightsUnderwater }) =>
    ctx.once("combat_token_fights_underwater", { tokenId, fightsUnderwater }, async () => {
      assertUnderwaterOn(ctx.campaign);
      const token = await loadCombatToken(ctx, ctx.campaign._id, tokenId);
      if ((token.fightsUnderwater === true) !== fightsUnderwater) {
        await ctx.db.patch("combatTokens", token._id, { fightsUnderwater: fightsUnderwater ? true : undefined });
      }
      return null;
    }),
});

/**
 * Plan rule-switches OE2 (user 2026-11-06 on dcm-bxp.134; CB p.168: "For any creatures that can't breathe underwater,
 * you can use a countdown"): the GM marks a PC's token as breathing underwater. Its action rolls then don't tick the
 * breath countdown and never mark the out-of-breath Stress (`rollAftermath`). MECHANIC_DISABLED while the rule is off;
 * COMBAT_TOKEN_NOT_FOUND for another campaign's token; INVALID for a token that is not a PC's.
 */
export const setBreathesUnderwater = keyedGmMutation({
  args: { tokenId: v.id("combatTokens"), breathesUnderwater: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { tokenId, breathesUnderwater }) =>
    ctx.once("combat_token_breathes_underwater", { tokenId, breathesUnderwater }, async () => {
      assertUnderwaterOn(ctx.campaign);
      const token = await loadCombatToken(ctx, ctx.campaign._id, tokenId);
      if (token.ref.kind !== "pc") throw appError("INVALID", "Only a PC can be marked as breathing underwater.");
      if ((token.breathesUnderwater === true) !== breathesUnderwater) {
        await ctx.db.patch("combatTokens", token._id, { breathesUnderwater: breathesUnderwater ? true : undefined });
      }
      return null;
    }),
});
