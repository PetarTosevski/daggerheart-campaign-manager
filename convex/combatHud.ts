import { v, type Infer } from "convex/values";

import { derivedDefense, derivedThresholds } from "../src/lib/domain/characters/derived";
import { withEffects } from "../src/lib/domain/characters/effects";
import { expire, SCENE_TOKEN_KEYS } from "../src/lib/domain/characters/expiry";
import { hopeMax } from "../src/lib/domain/characters/index";
import { frameHasMechanic } from "../src/lib/frames/index";
import { stanceById } from "../src/lib/srd/stances";
import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { installedAugments } from "./characterExtras";
import { conditionMarkerOf } from "./lib/cardRunner";
import { loadCharacter, MAX_CHARACTERS_PER_CAMPAIGN, readSheet } from "./lib/characterSheet";
import {
  bareConditionUntil,
  className,
  conditionLabel,
  effectUntilLabel,
  hudPartyMemberValidator,
  partyMemberOf,
  sceneEndOf,
  sceneEndPreviewValidator,
  type HudPartyMember,
  type SceneEndPreview,
} from "./lib/combatHud";
import { liveCombatMap, tokensOnMap } from "./lib/combatMaps";
import { campaignLight, lightLevelValidator } from "./lib/combatVision";
import { drawerOf, drawerUseValidator, type Drawer } from "./lib/featureDrawer";
import { featureScope } from "./lib/featureScope";
import { campaignFearState } from "./lib/fear";
import { campaignQuery, gmQuery, userQuery } from "./lib/functions";
import { atLeast } from "./lib/permissions";
import { withoutStance } from "./lib/stanceDrop";

/**
 * Combat HUD reads (plan `.omc/plans/combat-hud.yaml`, tracer HD1; Main, CmpTokens, GMDesktop boards). Each is one
 * small query so a banner's HP tick or a Fear click re-sends only its own slice.
 *
 * - `party` (every member): one row per PC token on the map, what the banners and the tokens' Hope chips show (HP,
 *   Stress, Armor, Hope, conditions, class, level, portrait, death move due). Players read the live map only (any
 *   other map reads as empty, as `combatTokens.party`); the GM any map. Never an adversary, ally, neutral or custom
 *   token: their numbers stay the GM's (R4, HANDOFF hard rule 2).
 * - `scene` (every member): Fear, the campaign's light and time phase, the campaign day (every campaign, core
 *   included: user decision 2026-11-02, TASK-CORE-CALENDAR), and what the caller may change: the light (`canSetLight`,
 *   edit access without campaign time, as `campaigns.timeOfDay`), the time arc (`canOpenTimeArc`, the GM in a frame
 *   with campaign time) and End day (`canEndDay`, the GM in every campaign, as `campaignTime.endDay`).
 * - `sheet` (every member, tracer HD2, user answer 4a): one PC's sheet panel. Any party member reads any PC's numbers,
 *   features (a view-safe list), thresholds, Experiences, conditions and lasting effects; only the cards in hand follow
 *   hand sharing, so this query never returns a card (the hand stays `combatCards.hand`).
 * - `sceneEndPreview` (the GM, tracer H5.3): what End scene would end now, by name (GMDesktop 'End scene').
 */

/** The map a caller's banners follow: `mapId` when given (players: only the live one), else the live map. */
async function partyMap(ctx: QueryCtx, campaignId: Doc<"campaigns">["_id"], gm: boolean, mapId: string | undefined) {
  if (mapId === undefined) return liveCombatMap(ctx, campaignId);
  const id = ctx.db.normalizeId("combatMaps", mapId);
  const map = id === null ? null : await ctx.db.get("combatMaps", id);
  if (map === null || map.campaignId !== campaignId) return null;
  return gm || map.live ? map : null;
}

export const party = campaignQuery({
  need: "view",
  enough: "owner",
  args: { mapId: v.optional(v.string()) },
  returns: v.array(hudPartyMemberValidator),
  handler: async (ctx, { mapId }) => {
    const gm = atLeast(ctx.permission, "owner");
    const map = await partyMap(ctx, ctx.campaign._id, gm, mapId);
    if (map === null) return [];
    const rows: HudPartyMember[] = [];
    for (const token of await tokensOnMap(ctx, map._id)) {
      if (token.ref.kind !== "pc") continue;
      const row = await partyMemberOf(ctx, ctx.campaign, ctx.user, gm, token._id, token.ref.characterId);
      if (row !== null) rows.push(row);
    }
    return rows;
  },
});

const sceneValidator = v.object({
  /** GM Fear, 0-12. */
  fear: v.number(),
  /** The light every map follows (dcm-bxp.54). */
  light: lightLevelValidator,
  /** The campaign time phase ("Nightfall"), or null in a frame without campaign time. */
  phase: v.union(v.string(), v.null()),
  /**
   * The campaign day (week, day of the week, Day / Night cycle), as `campaignTime.calendar`: every campaign counts days
   * (core included, TASK-CORE-CALENDAR); outside the Witherwild the cycle is always "DAY".
   */
  day: v.object({ week: v.number(), day: v.number(), cycle: v.union(v.literal("DAY"), v.literal("NIGHT")) }),
  /** The caller may set Day / Dim / Night (edit access, no campaign time: `campaigns.setTimeOfDay`). */
  canSetLight: v.boolean(),
  /** The GM's disc opens the time arc / End day (the GM, in a frame with campaign time). */
  canOpenTimeArc: v.boolean(),
  /** The GM's disc ends the day (`campaignTime.endDay`, the GM in every campaign). */
  canEndDay: v.boolean(),
});

export const scene = campaignQuery({
  need: "view",
  enough: "owner",
  args: {},
  returns: sceneValidator,
  handler: async (ctx) => {
    const { campaign } = ctx;
    const timed = frameHasMechanic(campaign.frameId, "campaignTime");
    const { phase, light } = await campaignLight(ctx, campaign);
    const fear = (await campaignFearState(ctx, campaign._id)).fear;
    const row = await ctx.db
      .query("campaignTime")
      .withIndex("by_campaign", (q) => q.eq("campaignId", campaign._id))
      .unique();
    // A campaign whose first day has not ended is at the initial time (week 1, Day, day 1): the row is created lazily
    // by its first End day, so existing campaigns need no migration.
    const day = row === null ? { week: 1, day: 1, cycle: "DAY" as const } : { week: row.week, day: row.cycleDay, cycle: row.cycle };
    return {
      fear,
      light,
      phase,
      day,
      canSetLight: atLeast(ctx.permission, "edit") && !timed,
      canOpenTimeArc: atLeast(ctx.permission, "owner") && timed,
      canEndDay: atLeast(ctx.permission, "owner"),
    };
  },
});

// ---------------------------------------------------------------- the sheet panel (tracer HD2)

const sheetTrack = v.object({ marked: v.number(), max: v.number() });

const featureKind = v.union(
  v.literal("action"),
  v.literal("reaction"),
  v.literal("rider"),
  v.literal("auto"),
  v.literal("passive"),
  v.literal("outOfCombat"),
  v.literal("narrative"),
);

/** One feature on the sheet panel (Main 'Features'): the same for every mode, plus `uses` for own / gm. */
export const hudSheetFeatureValidator = v.object({
  featureId: v.string(),
  name: v.string(),
  text: v.string(),
  /** Where it comes from: hope, class, subclass, ancestry, community, beastform, transformation, stance. */
  source: v.string(),
  /**
   * The badge: `action` / `reaction` / `rider` / `auto` (its first non-passive use's activation), `passive` (no such use),
   * or `outOfCombat` / `narrative` (the drawer's usage, Q3 / Q15).
   */
  kind: featureKind,
  /** The cost badge of its first use that costs something ("3 Hope", "1 Stress + 1 Hope"), or null. */
  cost: v.union(v.null(), v.string()),
  /** The limit badge of its first limited use ("Once per long rest"), or null. */
  limit: v.union(v.null(), v.string()),
  /** Used up (every action use exhausted) or active (its effect still holds, Rogue's Dodge); `resetLabel` says when back. */
  used: v.boolean(),
  resetLabel: v.union(v.null(), v.string()),
  /** Uses left before the limit, when it allows more than one ("2 left"), else null. */
  usesLeft: v.union(v.null(), v.number()),
  /** Tokens on it (Prayer Dice, Favor, ...). */
  tokens: v.number(),
  /** Its Use runs on the map (an effect entry exists). */
  automated: v.boolean(),
  /** Use data (`combatFeatures.drawer`'s shape, for `FeatureUse`): own and gm only; null in view mode. */
  uses: v.union(v.null(), v.array(drawerUseValidator)),
});

/**
 * `combatHud.sheet`: one PC's sheet panel (Main 'D · Sheet at hand', GMDesktop). `mode`: `gm` (campaign owner), `own`
 * (edit permission: the character's player, or a campaign edit grant), `view` (any other member). Never a domain card.
 */
export const hudSheetValidator = v.object({
  characterId: v.id("characters"),
  mode: v.union(v.literal("own"), v.literal("gm"), v.literal("view")),
  name: v.string(),
  /** The class's name ("Druid"), or its id when the class is unknown. */
  className: v.string(),
  level: v.number(),
  /** Evasion with gear, passive features, augments and active effects (Rogue's Dodge +2). */
  evasion: v.number(),
  /** The Armor Score (equipment, augments, passives): the Armor tracker's max. */
  armorScore: v.number(),
  /** Damage thresholds (Minor below `major`; Major from `major`; Severe from `severe`). */
  thresholds: v.object({ major: v.number(), severe: v.number() }),
  experiences: v.array(v.object({ id: v.string(), name: v.string(), value: v.number() })),
  /** HP / Stress / Armor `{ marked, max }`, Hope `{ value, max }` (as `combatHud.party`). */
  trackers: v.object({ hp: sheetTrack, stress: sheetTrack, hope: v.object({ value: v.number(), max: v.number() }), armor: sheetTrack }),
  features: v.array(hudSheetFeatureValidator),
  /**
   * Conditions, in their stored order. `source`: the card or feature that gave it when the sheet records one (its marker
   * effect), else null. `until`: in words, from that source, else the core rule where there is one (Hidden), else null.
   */
  conditions: v.array(v.object({ id: v.string(), label: v.string(), source: v.union(v.null(), v.string()), until: v.union(v.null(), v.string()) })),
  /**
   * Lasting effects (the sheet's `effects`, without the condition markers shown on `conditions`): `id` (for the GM's or
   * owner's End), `source` ("Rogue's Dodge"), `text`, `until` in words, `ends` the stored kind (rest / longRest / session /
   * hit / scene / manual).
   */
  effects: v.array(
    v.object({
      id: v.string(),
      source: v.string(),
      text: v.string(),
      until: v.string(),
      ends: v.union(v.literal("rest"), v.literal("longRest"), v.literal("session"), v.literal("hit"), v.literal("scene"), v.literal("manual")),
    }),
  ),
});
export type HudSheet = Infer<typeof hudSheetValidator>;
export type HudSheetFeature = Infer<typeof hudSheetFeatureValidator>;

/** The drawer's feature as the sheet panel lists it; `withUses`: own / gm (the Use data), else null. */
function sheetFeature(f: Drawer["features"][number], withUses: boolean): HudSheetFeature {
  const active = f.uses.filter((u) => u.activation !== "passive");
  const kind: HudSheetFeature["kind"] = f.usage === "outOfCombat" || f.usage === "narrative" ? f.usage : (active[0]?.activation ?? "passive");
  const costly = active.find((u) => u.costs.length > 0) ?? f.uses.find((u) => u.costs.length > 0);
  return {
    featureId: f.featureId,
    name: f.name,
    text: f.text,
    source: f.source,
    kind,
    cost: costly ? costly.costs.join(" + ") : null,
    limit: f.uses.find((u) => u.limit !== null)?.limit ?? null,
    used: f.state === "exhausted" || f.state === "active",
    resetLabel: f.resetLabel,
    usesLeft: active.find((u) => u.usesLeft !== null)?.usesLeft ?? null,
    tokens: f.tokens,
    automated: f.automated,
    uses: withUses ? f.uses : null,
  };
}

export const sheet = userQuery({
  args: { characterId: v.id("characters") },
  returns: hudSheetValidator,
  handler: async (ctx, { characterId }): Promise<HudSheet> => {
    // Answer 4a: every member views (an outsider NOT_FOUND); the permission is exact up to owner for the mode.
    const { campaign, character, permission } = await loadCharacter(ctx, ctx.user, characterId, "view", "owner");
    const mode: HudSheet["mode"] = atLeast(permission, "owner") ? "gm" : atLeast(permission, "edit") ? "own" : "view";
    const s = readSheet(character.sheet);
    const scope = featureScope(campaign);
    const augments = await installedAugments(ctx, campaign, character._id);
    const defense = derivedDefense(withEffects(s), augments, scope);
    const drawer = drawerOf(character._id, s, campaign, augments);
    const markers = new Map<string, { source: string; until: string }>();
    const markerIds = new Set<string>();
    for (const e of s.effects) {
      const m = conditionMarkerOf(e);
      if (m === null) continue;
      markerIds.add(e.id);
      if (!markers.has(m.condition)) markers.set(m.condition, { source: e.source, until: effectUntilLabel(e) });
    }
    return {
      characterId: character._id,
      mode,
      name: s.name,
      className: className(s.classId),
      level: s.level,
      evasion: defense.evasion,
      armorScore: defense.armorScore,
      thresholds: derivedThresholds(s, scope),
      experiences: s.experiences.map((e) => ({ id: e.id, name: e.name, value: e.value })),
      trackers: {
        hp: { marked: s.hp, max: s.hpMax },
        stress: { marked: s.stress, max: s.stressMax },
        hope: { value: s.hope, max: hopeMax(s.scars, s.hopeSlotBonus ?? 0) },
        armor: { marked: s.armorMarked, max: defense.armorScore },
      },
      features: drawer.features.map((f) => sheetFeature(f, mode !== "view")),
      conditions: s.conditions.map((id) => {
        const marker = markers.get(id);
        return { id, label: conditionLabel(id), source: marker?.source ?? null, until: marker?.until ?? bareConditionUntil(id) };
      }),
      effects: s.effects
        .filter((e) => !markerIds.has(e.id))
        .map((e) => ({ id: e.id, source: e.source, text: e.text, until: effectUntilLabel(e), ends: e.until })),
    };
  },
});

// ---------------------------------------------------------------- End scene preview (tracer H5.3)

/** Areas the preview reads, as `combatScenes.endSceneAreas` closes them in one transaction. */
const PREVIEW_AREAS_MAX = 200;

/**
 * What the GM's End scene (`combatScenes.end` → `endScene`) would end right now, by name, for its "End the scene?"
 * confirm (GMDesktop 'End scene'). The same reads and steps as `endScene`, without writing: every active PC's sheet after
 * the stance drop (`withoutStance`, DA10) and `expire(…, "scene")`, and the campaign's live areas that last until the
 * scene (`endSceneAreas`). A corrupt sheet is skipped, as `endScene` leaves it alone. GM only.
 */
export const sceneEndPreview = gmQuery({
  args: {},
  returns: sceneEndPreviewValidator,
  handler: async (ctx): Promise<SceneEndPreview> => {
    const campaignId = ctx.campaign._id;
    const characters = await ctx.db
      .query("characters")
      .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
      .take(MAX_CHARACTERS_PER_CAMPAIGN);
    const effects: string[] = [];
    let limits = 0;
    const walkKey = SCENE_TOKEN_KEYS[0] ?? "";
    for (const character of characters) {
      if (character.status !== "active") continue;
      try {
        const sheet = readSheet(character.sheet);
        const next = expire(withoutStance(sheet).sheet, "scene");
        const ended = sceneEndOf(sheet, next, (id) => stanceById(id)?.name ?? id, walkKey);
        effects.push(...ended.effects);
        limits += ended.limits;
      } catch {
        // a corrupt sheet is left alone by endScene too
      }
    }
    const areas = await ctx.db
      .query("combatAreas")
      .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
      .take(PREVIEW_AREAS_MAX);
    return {
      effects: [...new Set(effects)],
      limits,
      areas: [...new Set(areas.filter((a) => a.status === "active" && a.expires === "scene").map((a) => a.label))],
    };
  },
});
