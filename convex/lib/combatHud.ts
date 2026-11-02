import { v, type Infer } from "convex/values";

import { derivedDefense } from "../../src/lib/domain/characters/derived";
import { hopeMax } from "../../src/lib/domain/characters/index";
import { canMakeDeathMove } from "../../src/lib/domain/death/index";
import { CLASSES } from "../../src/lib/srd/classes";
import type { Effect } from "../../src/lib/validation/characters";
import { installedAugments } from "../characterExtras";
import { pcPortrait } from "../combatTokens";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { readSheet } from "./characterSheet";
import { featureScope } from "./featureScope";

/**
 * Combat HUD data (plan `.omc/plans/combat-hud.yaml`, tracer HD1; bead dcm-bxp.99.32.8). The small projections the
 * HUD's party banners, token chips and scene line read: one row per PC token (a copy of the PC branch of
 * `combatTokens.viewsOf`, plus Hope, Armor, class, level and whether a death move is due) and a condition's display
 * name. Never an adversary's, ally's or neutral token's numbers: those stay with the GM's `combatTokens.list`.
 */

const CLASS_NAMES = new Map<string, string>(CLASSES.map((c) => [c.id, c.name]));

/** The class's name ("Warrior"), or its id when the class is unknown. */
export function className(classId: string): string {
  return CLASS_NAMES.get(classId) ?? classId;
}

/** A condition as a badge shows it: its id and display name ("vulnerable" → "Vulnerable"). */
export const hudConditionValidator = v.object({ id: v.string(), label: v.string() });
export type HudCondition = Infer<typeof hudConditionValidator>;

/** The condition's display name: the id with its first letter in capitals (as the tokens' `PC_CONDITIONS`). */
export function conditionLabel(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

/** Condition ids as badges, in their stored order. */
export function hudConditions(ids: readonly string[]): HudCondition[] {
  return ids.map((id) => ({ id, label: conditionLabel(id) }));
}

/**
 * A PC's portrait, as `combatTokens`' token views carry it (an image URL, design art, or none). Spelled out here rather
 * than read from `tokenViewValidator`: this module is imported by `lib/combatVision`, which `combatTokens`' imports
 * reach, so a top-level read of that module's export can run before it is defined.
 */
const portraitValidator = v.union(
  v.null(),
  v.object({ kind: v.literal("url"), url: v.string() }),
  v.object({ kind: v.literal("asset"), asset: v.string(), position: v.string() }),
);

const trackValidator = v.object({ marked: v.number(), max: v.number() });

/** One PC banner (Main, CmpTokens 'Banners'): what the banner and the token's Hope chip and arcs show. */
export const hudPartyMemberValidator = v.object({
  characterId: v.id("characters"),
  tokenId: v.id("combatTokens"),
  name: v.string(),
  /** The class's name ("Warrior"), or its id when the class is unknown. */
  className: v.string(),
  level: v.number(),
  portrait: portraitValidator,
  /** The caller's own character (players; always false for the GM, as on `combatTokens.party`). */
  mine: v.boolean(),
  /** Hit Points: `marked` of `max` (the HUD's rings show HP left, its text "n of 6 marked", answer 2). */
  hp: trackValidator,
  stress: trackValidator,
  /** Armor Slots marked of the armor score (equipment, augments and passive features). */
  armor: trackValidator,
  /** Hope and its slots (6, Light in the Dark's seventh, minus scars). */
  hope: v.object({ value: v.number(), max: v.number() }),
  conditions: v.array(hudConditionValidator),
  /** Every Hit Point marked, or the character is dead. */
  down: v.boolean(),
  /** A death move is due (CB p.106): active, every HP marked, not unconscious, and not returned to play by the GM. */
  deathMoveDue: v.boolean(),
});
export type HudPartyMember = Infer<typeof hudPartyMemberValidator>;

/**
 * The banner of a PC token's character, or null when the character is gone, in another campaign or unreadable (a
 * banner needs a sheet; the classic token still shows such a token).
 */
export async function partyMemberOf(
  ctx: QueryCtx,
  campaign: Doc<"campaigns">,
  user: Doc<"users">,
  gm: boolean,
  tokenId: Id<"combatTokens">,
  characterId: Id<"characters">,
): Promise<HudPartyMember | null> {
  const character = await ctx.db.get("characters", characterId);
  if (character === null || character.campaignId !== campaign._id) return null;
  let sheet: ReturnType<typeof readSheet>;
  try {
    sheet = readSheet(character.sheet);
  } catch {
    return null;
  }
  const defense = derivedDefense(sheet, await installedAugments(ctx, campaign, character._id), featureScope(campaign));
  return {
    characterId: character._id,
    tokenId,
    name: sheet.name,
    className: className(sheet.classId),
    level: sheet.level,
    portrait: await pcPortrait(ctx, character._id, sheet),
    mine: !gm && character.ownerId === user._id,
    hp: { marked: sheet.hp, max: sheet.hpMax },
    stress: { marked: sheet.stress, max: sheet.stressMax },
    armor: { marked: sheet.armorMarked, max: defense.armorScore },
    hope: { value: sheet.hope, max: hopeMax(sheet.scars, sheet.hopeSlotBonus ?? 0) },
    conditions: hudConditions(sheet.conditions),
    down: character.status === "dead" || (sheet.hpMax > 0 && sheet.hp >= sheet.hpMax),
    // deathMoves' `dueNow`: a character the GM returned to play with every HP marked owes none until they mark one again.
    deathMoveDue:
      character.deathMoveSpent !== true &&
      canMakeDeathMove({ status: character.status, hp: sheet.hp, hpMax: sheet.hpMax, conditions: sheet.conditions }),
  };
}

// ---------------------------------------------------------------- the sheet panel (tracer HD2)

/** When a sheet effect ends, as the sheet panel says it (`Effect.until`; a manual one reads its "ends when" text first). */
const EFFECT_UNTIL_LABEL: Record<Effect["until"], string> = {
  rest: "until the next rest",
  longRest: "until the next long rest",
  session: "until the end of the session",
  hit: "until you are hit",
  scene: "until the end of the scene",
  manual: "until it is ended",
};

/** The `ends when ...` part `cardRunner.addEffect` writes into an effect's text, as "until ...", or null. */
function endsWhenOf(text: string): string | null {
  const part = text.split("; ").find((p) => p.startsWith("ends when "));
  const rest = part?.slice("ends when ".length).trim() ?? "";
  if (rest === "") return null;
  return rest.startsWith("until ") ? rest : `until ${rest}`;
}

/** How long a sheet effect lasts, in words ("until the next rest"; a card's own "until they break free ..."). */
export function effectUntilLabel(effect: Pick<Effect, "until" | "text">): string {
  return endsWhenOf(effect.text) ?? EFFECT_UNTIL_LABEL[effect.until];
}

/**
 * How long a bare condition (the sheet records no source for it) lasts, where the core rules say it for every case:
 * Hidden (CB p.102: "After an adversary moves to where they would see you, you move into their line of sight, or you
 * make an attack, you are no longer Hidden"). Restrained, Vulnerable and the rest last until whatever imposed them says
 * (CB p.102, "Clearing Conditions"), which a bare condition does not record: no entry, the panel shows none.
 */
const BARE_CONDITION_UNTIL: Readonly<Record<string, string>> = {
  hidden: "until an adversary would see you, you move into their sight, or you attack",
};

/** A bare condition's "until" text, or null. */
export function bareConditionUntil(id: string): string | null {
  return BARE_CONDITION_UNTIL[id] ?? null;
}

// ---------------------------------------------------------------- End scene preview (tracer H5.3)

/**
 * `combatHud.sceneEndPreview`: what the GM's End scene would end right now (GMDesktop 'End scene', CmpPromptsGM 'End the
 * scene?'), mirroring `combatScenes.endScene`. `effects`: the names of what ends on the party's sheets (each effect's
 * source, "Wall Walk"; the Unstoppable Die, the active stance and Walk Between Worlds by name), each once, in party
 * order. `limits`: how many feature uses refresh (once-per-scene and GM-turn limits). `areas`: the labels of the
 * campaign's live map areas that last until the scene, each once.
 */
export const sceneEndPreviewValidator = v.object({
  effects: v.array(v.string()),
  limits: v.number(),
  areas: v.array(v.string()),
});
export type SceneEndPreview = Infer<typeof sceneEndPreviewValidator>;

/** The parts of a sheet a scene end touches. */
type SceneSheet = {
  effects: readonly Pick<Effect, "id" | "source">[];
  featureUses?: readonly unknown[];
  classState: { unstoppable?: unknown; martial?: { active?: string } };
  cardTokens?: readonly { cardId: string }[];
};

/**
 * What a scene end takes off one sheet, as names (`before`: the stored sheet; `after`: the sheet after the stance drop and
 * `expire(…, "scene")`, as `endScene` computes it); `limits` counts the feature uses that refresh. `stanceName` turns an
 * active stance id into its name; `walkKey` is Walk Between Worlds' token key.
 */
export function sceneEndOf(
  before: SceneSheet,
  after: SceneSheet,
  stanceName: (id: string) => string,
  walkKey: string,
): { effects: string[]; limits: number } {
  const kept = new Set(after.effects.map((e) => e.id));
  const effects = before.effects.filter((e) => !kept.has(e.id)).map((e) => e.source);
  if (before.classState.unstoppable !== undefined && after.classState.unstoppable === undefined) effects.push("Unstoppable");
  const stance = before.classState.martial?.active;
  if (stance !== undefined && after.classState.martial?.active === undefined) effects.push(stanceName(stance));
  const walked = (sheet: SceneSheet) => (sheet.cardTokens ?? []).some((t) => t.cardId === walkKey);
  if (walked(before) && !walked(after)) effects.push("Walk Between Worlds");
  return { effects, limits: (before.featureUses?.length ?? 0) - (after.featureUses?.length ?? 0) };
}
