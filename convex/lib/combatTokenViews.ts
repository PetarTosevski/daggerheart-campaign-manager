/**
 * Token views and the lookups `combatTokens.ts` and `combatTokensReads.ts` share (D9 C6, R4). Split out of
 * `convex/combatTokens.ts` by dcm-uh6r so the HUD's token reads load without the movement and area engines.
 */
import { srdAdversary } from "../../src/lib/srd/adversary-lookup";
import { CLASSES } from "../../src/lib/srd/classes";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { readSheet } from "./characterSheet";
import { adversaryArtSrc, MAX_INSTANCES } from "./encounters";
import { pcPortrait } from "./pcPortrait";
import { atLeast, permissionFor, type Permission } from "./permissions";
import type { TokenView } from "./validators/combatTokens";

const CLASS_NAMES = new Map<string, string>(CLASSES.map((c) => [c.id, c.name]));

/** A campaign's map by id, or null (other campaigns' and malformed ids read as missing). */
export async function findMap(ctx: QueryCtx, campaignId: Id<"campaigns">, mapId: string): Promise<Doc<"combatMaps"> | null> {
  const id = ctx.db.normalizeId("combatMaps", mapId);
  const map = id === null ? null : await ctx.db.get("combatMaps", id);
  return map !== null && map.campaignId === campaignId ? map : null;
}

/** The campaign's running encounter (at most one), or null. */
export function runningEncounter(ctx: QueryCtx, campaignId: Id<"campaigns">) {
  return ctx.db
    .query("encounters")
    .withIndex("by_campaign_status_updated", (q) => q.eq("campaignId", campaignId).eq("status", "running"))
    .first();
}

/** An instance's adversary type (SRD entry or the campaign's custom block), or null. */
export async function adversaryType(ctx: QueryCtx, campaignId: Id<"campaigns">, instance: Doc<"encounterAdversaries">): Promise<string | null> {
  if (instance.source.kind === "srd") return srdAdversary(instance.source.adversaryId)?.type ?? null;
  const block = await ctx.db.get("customAdversaries", instance.source.customId);
  return block !== null && block.campaignId === campaignId ? block.type : null;
}

/** An adversary token's portrait: its rulebook art as an image URL, or null (initials). */
export async function adversaryPortrait(ctx: QueryCtx, campaignId: Id<"campaigns">, instance: Doc<"encounterAdversaries">): Promise<TokenView["portrait"]> {
  const src = await adversaryArtSrc(ctx, campaignId, instance);
  return src === null ? null : { kind: "url", url: src };
}

/** The encounter's instances in order (at most MAX_INSTANCES). */
export function instancesOf(ctx: QueryCtx, encounterId: Id<"encounters">) {
  return ctx.db
    .query("encounterAdversaries")
    .withIndex("by_encounter_order", (q) => q.eq("encounterId", encounterId))
    .take(MAX_INSTANCES);
}

/** The ids of the adversary instances already on a map. */
export function placedInstances(tokens: Doc<"combatTokens">[]): Set<Id<"encounterAdversaries">> {
  return new Set(tokens.flatMap((t) => (t.ref.kind === "adversary" ? [t.ref.adversaryId] : [])));
}

/**
 * Builds the views of `tokens` for the caller. `gm`: every token may move and `revealedTo` is included; otherwise a
 * PC token may move when the caller can edit its character (permissionFor, R4). Reads each source row once.
 */
export type CampaignCtx<C> = C & { user: Doc<"users">; campaign: Doc<"campaigns">; permission: Permission };

export async function viewsOf(ctx: CampaignCtx<QueryCtx>, tokens: Doc<"combatTokens">[], gm: boolean): Promise<TokenView[]> {
  const encounters = new Map<Id<"encounters">, Doc<"encounters"> | null>();
  const views: TokenView[] = [];
  for (const token of tokens) {
    const base = {
      _id: token._id,
      side: token.side,
      x: token.x,
      y: token.y,
      size: token.size,
      face: token.face,
      light: token.light,
      ...(gm ? { revealedTo: token.revealedTo } : {}),
    };
    const { ref } = token;
    // A companion token (token refs widened by sheet-drawer SD0, Q4): its view is SD-C's; nothing places one before it.
    if (ref.kind === "companion") continue;
    if (ref.kind === "custom") {
      views.push({
        ...base,
        kind: "custom",
        name: ref.name,
        sub: "",
        portrait: null,
        canMove: gm,
        mine: false,
        stats: { hp: ref.hp, hpMax: ref.hpMax, stress: ref.stress, stressMax: ref.stressMax, conditions: ref.conditions, down: ref.hpMax > 0 && ref.hp >= ref.hpMax },
      });
    } else if (ref.kind === "pc") {
      const character = await ctx.db.get("characters", ref.characterId);
      if (character === null || character.campaignId !== ctx.campaign._id) {
        views.push({ ...base, kind: "pc", characterId: ref.characterId, name: "Missing character", sub: "", portrait: null, canMove: gm, mine: false, stats: null });
        continue;
      }
      const mine = !gm && character.ownerId === ctx.user._id;
      const canMove = gm || atLeast(await permissionFor(ctx, ctx.user, { type: "character", campaign: ctx.campaign, character }, "edit"), "edit");
      let sheet: ReturnType<typeof readSheet>;
      try {
        sheet = readSheet(character.sheet);
      } catch {
        views.push({ ...base, kind: "pc", characterId: character._id, name: "Unreadable character", sub: "", portrait: null, canMove, mine, stats: null });
        continue;
      }
      views.push({
        ...base,
        kind: "pc",
        characterId: character._id,
        name: sheet.name,
        sub: `${CLASS_NAMES.get(sheet.classId) ?? sheet.classId} · level ${sheet.level}`,
        portrait: await pcPortrait(ctx, character._id, sheet),
        canMove,
        mine,
        stats: {
          hp: sheet.hp,
          hpMax: sheet.hpMax,
          stress: sheet.stress,
          stressMax: sheet.stressMax,
          conditions: sheet.conditions,
          down: character.status === "dead" || (sheet.hpMax > 0 && sheet.hp >= sheet.hpMax),
        },
      });
    } else {
      const instance = await ctx.db.get("encounterAdversaries", ref.adversaryId);
      if (instance === null || instance.campaignId !== ctx.campaign._id) {
        views.push({ ...base, kind: "adversary", instanceId: ref.adversaryId, name: "Removed adversary", sub: "", portrait: null, canMove: gm, mine: false, stats: null, tracked: false });
        continue;
      }
      if (!encounters.has(instance.encounterId)) encounters.set(instance.encounterId, await ctx.db.get("encounters", instance.encounterId));
      const encounter = encounters.get(instance.encounterId) ?? null;
      const type = await adversaryType(ctx, ctx.campaign._id, instance);
      views.push({
        ...base,
        kind: "adversary",
        instanceId: instance._id,
        name: instance.label,
        sub: [type, encounter?.name].filter(Boolean).join(" · "),
        // The rulebook art when the adversary has it (user 2026-10-21), else the side's colour and initials.
        portrait: await adversaryPortrait(ctx, ctx.campaign._id, instance),
        canMove: gm,
        mine: false,
        stats: {
          hp: instance.hp,
          hpMax: instance.stats.hpMax,
          stress: instance.stress,
          stressMax: instance.stats.stressMax,
          conditions: instance.conditions,
          difficulty: instance.stats.difficulty,
          down: instance.defeated,
        },
        tracked: encounter?.status === "running",
      });
    }
  }
  return views;
}
