/**
 * Dropping out of a martial stance (HF p.12, "Dropping Out of Stances": "If you are already in a stance when you shift
 * into a different stance, you automatically drop out of the previously active stance. You also drop out of your active
 * stance when you take Severe damage or mark your last Hit Point. Otherwise, you drop out of your active stance at the end
 * of the scene. When you drop out of a stance, you lose any ongoing benefits it provides.").
 *
 * User answer 2026-10-29 (dcm-bxp.99.19.10; plan drawer-answers DA10): Grappling's Restrain (HF p.12: "temporarily
 * Restrain the target") ends when the stance drops. The stance entry's condition carries `endsOn: ["stanceDrops"]`
 * (src/lib/srd/feature-effects/stances.ts); when the actor gives it, `writeSheetChanges` (convex/lib/cardRunner.ts) puts a
 * marker effect on the actor's sheet (`stanceDropMarker`: the target's token and the condition). `dropStance` runs where
 * the stance drops: a shift to another stance (`combatFeatures.shiftStance`), the scene's end (`endScene`) and a hit that
 * is Severe or marks the last Hit Point (convex/lib/incomingHits.ts). A rest leaves the stance (SD8 Q3), so not there.
 * It takes the stance and the markers off the sheet and the condition off each marked target's encounter instance; the
 * caller writes both in its own undo group (`adversaryBefore` on its row).
 */
import type { CharacterSheet, Effect } from "../../src/lib/validation/characters";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { AdversaryBefore } from "./validators/actionLog";
import { ENCOUNTER_CONDITIONS, type EncounterCondition } from "./validators/encounters";

/** Marker effect ids: `sd:<target token id>` (sheet effect ids hold at most 40 characters; a Convex id is 32). */
const PREFIX = "sd:";
const CONDITION = /; condition: ([A-Za-z0-9 '-]+)$/;
const ENCOUNTER_SET = new Set<string>(ENCOUNTER_CONDITIONS);

/** The sheet marker of a condition `source` gave the creature on token `tokenId` that ends when the stance drops. */
export function stanceDropMarker(tokenId: string, source: string, condition: string): Effect {
  const name = condition.charAt(0).toUpperCase() + condition.slice(1);
  return { id: `${PREFIX}${tokenId}`.slice(0, 40), source: source.slice(0, 80), text: `${name} on a target until your stance drops; condition: ${condition}`.slice(0, 300), until: "manual" };
}

export type StanceMarker = { tokenId: string; condition: string; source: string };

/** The stance-drop markers on a sheet. */
export function stanceMarkers(sheet: Pick<CharacterSheet, "effects">): StanceMarker[] {
  return sheet.effects.flatMap((e) => {
    const condition = CONDITION.exec(e.text)?.[1];
    return e.id.startsWith(PREFIX) && condition ? [{ tokenId: e.id.slice(PREFIX.length), condition, source: e.source }] : [];
  });
}

/** The sheet with no active stance and no stance-drop markers; `dropped` whether anything went. Pure. */
export function withoutStance(sheet: CharacterSheet): { sheet: CharacterSheet; markers: StanceMarker[]; dropped: boolean } {
  const markers = stanceMarkers(sheet);
  const martial = sheet.classState.martial;
  const active = martial?.active !== undefined;
  if (!active && markers.length === 0) return { sheet, markers, dropped: false };
  let next: CharacterSheet = sheet;
  if (martial && active) {
    const { active: _active, ...kept } = martial;
    void _active;
    next = { ...next, classState: { ...next.classState, martial: kept } };
  }
  if (markers.length > 0) next = { ...next, effects: next.effects.filter((e) => !e.id.startsWith(PREFIX) || !CONDITION.test(e.text)) };
  return { sheet: next, markers, dropped: true };
}

function beforeOf(instance: Doc<"encounterAdversaries">): AdversaryBefore {
  return {
    instanceId: instance._id,
    hp: instance.hp,
    stress: instance.stress,
    defeated: instance.defeated,
    ...(instance.minionCount !== undefined ? { minionCount: instance.minionCount } : {}),
    conditions: instance.conditions,
    tags: instance.tags,
  };
}

/**
 * Takes each marker's condition off the encounter instance on its token (the campaign's own tokens only). Returns the
 * instances before (for the caller's `adversaryBefore`) and one feed line per condition ended. A token or instance that
 * is gone, or a condition already cleared, is skipped.
 */
export async function endStanceConditions(ctx: MutationCtx, campaignId: Id<"campaigns">, markers: readonly StanceMarker[]): Promise<{ before: AdversaryBefore[]; lines: string[] }> {
  const before: AdversaryBefore[] = [];
  const lines: string[] = [];
  for (const m of markers) {
    const tokenId = ctx.db.normalizeId("combatTokens", m.tokenId);
    const token = tokenId === null ? null : await ctx.db.get("combatTokens", tokenId);
    if (token === null || token.campaignId !== campaignId || token.ref.kind !== "adversary") continue;
    const instance = await ctx.db.get("encounterAdversaries", token.ref.adversaryId);
    if (instance === null || instance.campaignId !== campaignId) continue;
    const standard = ENCOUNTER_SET.has(m.condition) && instance.conditions.includes(m.condition as EncounterCondition);
    const tagged = !standard && (instance.tags ?? []).includes(m.condition);
    if (!standard && !tagged) continue;
    if (!before.some((b) => b.instanceId === instance._id)) before.push(beforeOf(instance));
    await ctx.db.patch("encounterAdversaries", instance._id, {
      ...(standard ? { conditions: instance.conditions.filter((c) => c !== m.condition) } : { tags: (instance.tags ?? []).filter((t) => t !== m.condition) }),
      updatedAt: Date.now(),
    });
    lines.push(`${instance.label} is no longer ${m.condition} (${m.source} ended with the stance)`);
  }
  return { before, lines };
}

/**
 * The stance drops: the sheet without the stance and its markers (the caller saves it) and every marked condition ended
 * on its instance (the caller logs `before` in its undo group).
 */
export async function dropStance(ctx: MutationCtx, campaignId: Id<"campaigns">, sheet: CharacterSheet): Promise<{ sheet: CharacterSheet; dropped: boolean; before: AdversaryBefore[]; lines: string[] }> {
  const off = withoutStance(sheet);
  if (!off.dropped) return { sheet, dropped: false, before: [], lines: [] };
  const ended = await endStanceConditions(ctx, campaignId, off.markers);
  return { sheet: off.sheet, dropped: true, ...ended };
}
