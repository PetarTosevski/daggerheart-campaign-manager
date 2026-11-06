import { v } from "convex/values";

import { awaiting } from "../src/lib/domain/adversary-actions/index";
import { appError } from "../src/lib/errors/app-error";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { isPreRollRow, type PreRollRow } from "./lib/adversaryActions";
import { answeringFeatures, hopeAndFearOf } from "./lib/adversaryHits";
import { loadCharacter } from "./lib/characterSheet";
import { encounterRunning, openRequests } from "./lib/combatRequests";
import { campaignQuery, gmQuery } from "./lib/functions";
import { featureView, groupUndone, hitView, isHitRow, isPcAttacker, memberId, partyMembers, rebuildWindow, type HitRow, type HitView } from "./lib/incomingHits";

/**
 * The reaction windows' reads (plan adversary-actions, AA2; SD4; moved out of `adversaryActions.ts` by dcm-uh6r so the
 * HUD's and the GM queue's subscriptions do not load the adversary action runner the mutations need). Same wrappers,
 * arguments and returns as before.
 *
 * - `pending`: a character's open hits and before-roll prompts (the hit PC's and the allies' prompt); answered with
 *   `adversaryActions.respond`.
 * - `windows`: the GM's view of the open reaction windows; `adversaryActions.resolve` is the GM's "Resolve now".
 */

const severityValidator = v.union(v.literal("none"), v.literal("minor"), v.literal("major"), v.literal("severe"));
const damageTypeValidator = v.union(v.literal("physical"), v.literal("magic"), v.literal("both"));

/** Who made a hit, for `windows`: the instance, or (AA2b) the PC whose card it was. One shape, both fields optional. */
function attackerIds(attacker: HitRow["payload"]["attacker"]): { instanceId?: Id<"encounterAdversaries">; attackerCharacterId?: Id<"characters"> } {
  if (isPcAttacker(attacker)) return { attackerCharacterId: attacker.characterId };
  // Plan rule-switches OFA: a fall or a collision has neither.
  return "instanceId" in attacker ? { instanceId: attacker.instanceId } : {};
}

/** SD4: open hit and before-roll rows of a running encounter whose action wasn't undone. */
async function liveRows(ctx: QueryCtx, campaignId: Id<"campaigns">): Promise<(HitRow | PreRollRow)[]> {
  const out: (HitRow | PreRollRow)[] = [];
  for (const row of await openRequests(ctx, campaignId)) {
    if ((!isHitRow(row) && !isPreRollRow(row)) || !(await encounterRunning(ctx, row)) || (await groupUndone(ctx, row))) continue;
    out.push(row);
  }
  return out;
}

/**
 * SD4 (Q2): what one character sees of a held attack: "Bandit attacks Mira", their before-roll features with Use, and
 * Pass; only while they owe an answer. Nothing is rolled yet, so there are no numbers.
 */
async function preRollView(ctx: QueryCtx, row: PreRollRow, characterId: Id<"characters">): Promise<HitView | null> {
  const p = row.payload;
  const responder = p.responders.find((r) => r.characterId === characterId);
  if (!responder || row.responses.some((r) => r.characterId === characterId)) return null;
  const party = await partyMembers(ctx, row.campaignId);
  const me = party.find((m) => m.character._id === characterId);
  if (!me) return null;
  const hopeAndFear = await hopeAndFearOf(ctx, row.campaignId);
  const effects = answeringFeatures(me.sheet, hopeAndFear);
  const features = responder.featureIds.flatMap((id) => {
    const effect = effects.find((f) => f.featureId === id);
    const use = effect?.uses.find((u) => u.activation.kind === "reaction");
    return effect && use ? [featureView(effect, use.id, me.sheet, hopeAndFear)] : [];
  });
  const targets = p.attack.targetCharacterIds;
  const names = targets.map((id) => party.find((m) => m.character._id === id)?.sheet.name ?? "Unknown");
  return {
    requestId: row._id,
    attackerLabel: p.attacker.label,
    targetCharacterId: targets.includes(characterId) ? characterId : targets[0]!,
    targetName: names.join(", "),
    role: targets.includes(characterId) ? "target" : "ally",
    awaiting: true,
    cardIds: [],
    createdAt: row.createdAt,
    preRoll: true,
    features,
  };
}

const armorStepValidator = v.object({ slots: v.number(), severity: severityValidator, hp: v.number() });

/** SD4: a feature answer as the prompt shows it (its SRD name and text, and what its Use asks). */
const featureViewValidator = v.object({
  featureId: v.string(),
  useId: v.string(),
  name: v.string(),
  text: v.string(),
  numbers: v.array(v.object({ id: v.string(), label: v.string(), min: v.number() })),
  options: v.array(v.object({ id: v.string(), label: v.string(), options: v.array(v.object({ id: v.string(), label: v.string() })) })),
  /** DA8 (widened): `defaultOn` optionals are ticked unless the player unticks them (Draining Bane). */
  optionals: v.array(v.object({ id: v.string(), label: v.string(), defaultOn: v.optional(v.boolean()) })),
  situations: v.array(v.string()),
});

/**
 * A character's open hits (need edit on the character: its player or the GM). As the hit PC (Q14): the damage, its
 * severity against their own thresholds, how many Armor Slots they may mark and what each gives, and their eligible
 * cards. As an ally: who was hit, by whom, and their eligible cards. Never the attack roll or an adversary's stats (CF6).
 */
export const pending = campaignQuery({
  need: "view",
  enough: "owner",
  args: { characterId: v.id("characters") },
  returns: v.array(
    v.object({
      requestId: v.id("combatRequests"),
      attackerLabel: v.string(),
      targetCharacterId: v.id("characters"),
      targetName: v.string(),
      role: v.union(v.literal("target"), v.literal("ally")),
      awaiting: v.boolean(),
      cardIds: v.array(v.string()),
      createdAt: v.number(),
      damage: v.optional(v.number()),
      severity: v.optional(severityValidator),
      direct: v.optional(v.boolean()),
      maxSlots: v.optional(v.number()),
      armorPreview: v.optional(v.array(armorStepValidator)),
      /** AA2b: the hit resolved; answer an after-hit card in `cardIds` (Unbreakable) with `card` or `pass`. */
      afterHit: v.optional(v.boolean()),
      /** AA2b: with `afterHit`, the hit marked this character's last HP. */
      deathMove: v.optional(v.boolean()),
      /** AA2b: after a redirect (I Am Your Shield), the PC hit first. */
      originalTargetName: v.optional(v.string()),
      /** SD4: the features this character may answer with now (Iron Will, Thick Skin, Not This Time, …). */
      features: v.optional(v.array(featureViewValidator)),
      /** SD4: the hit PC answered armor; a severity-gated feature (Thick Skin) or Done is left. */
      armorAnswered: v.optional(v.boolean()),
      /** SD4 (Q2): a before-roll prompt (nothing rolled yet): a feature's Use, or Pass. */
      preRoll: v.optional(v.boolean()),
      /**
       * Lane E7, round 2 (dcm-5cn5; widened, absent = none): answers the attacker grants the hit PC (Money Talks, CB p.228:
       * "spend a handful of gold instead of marking HP"). E2's window fills it; `respond` takes the answer through
       * `hitChoiceValidator` (validators/combatRequests.ts).
       */
      grants: v.optional(v.array(v.object({ id: v.string(), label: v.string(), amount: v.optional(v.number()) }))),
    }),
  ),
  handler: async (ctx, { characterId }) => {
    const { campaign } = await loadCharacter(ctx, ctx.user, characterId, "edit", "owner");
    if (campaign._id !== ctx.campaign._id) throw appError("NOT_FOUND");
    const views = [];
    for (const row of await liveRows(ctx, ctx.campaign._id)) {
      const view = isPreRollRow(row) ? await preRollView(ctx, row, characterId) : await hitView(ctx, row, characterId);
      if (view) views.push(view);
    }
    return views;
  },
});

/** The GM's view of the open reaction windows (Q17): who was hit for how much, and who still has to answer. */
export const windows = gmQuery({
  args: {},
  returns: v.array(
    v.object({
      requestId: v.id("combatRequests"),
      encounterId: v.optional(v.id("encounters")),
      /** The attacking instance; absent when a PC's card made the hit (AA2b: `attackerCharacterId` instead). */
      instanceId: v.optional(v.id("encounterAdversaries")),
      /** AA2b: the PC whose card made the hit (card damage to an ally). */
      attackerCharacterId: v.optional(v.id("characters")),
      attackerLabel: v.string(),
      feature: v.optional(v.string()),
      originalTargetId: v.id("characters"),
      targetCharacterId: v.id("characters"),
      targetName: v.string(),
      damage: v.number(),
      damageType: damageTypeValidator,
      direct: v.boolean(),
      critical: v.boolean(),
      awaiting: v.array(v.object({ characterId: v.id("characters"), name: v.string(), role: v.union(v.literal("target"), v.literal("ally")) })),
      answers: v.number(),
      createdAt: v.number(),
      /** AA2b: the hit resolved; only its target's after-hit answer (`awaiting`) is left. */
      afterHit: v.optional(v.boolean()),
      /** SD4 (Q2): the attack is held before its roll (no damage yet); `awaiting` are the PCs with a before-roll feature. */
      preRoll: v.optional(v.boolean()),
    }),
  ),
  handler: async (ctx) => {
    const out = [];
    for (const row of await liveRows(ctx, ctx.campaign._id)) {
      if (isPreRollRow(row)) {
        out.push(await preRollWindow(ctx, row));
        continue;
      }
      const { state, members } = await rebuildWindow(ctx, row);
      const nameOf = (id: string) => members.find((m: { character: Doc<"characters"> }) => m.character._id === id)?.sheet.name ?? "Unknown";
      const p = row.payload;
      const offer = p.afterHit;
      out.push({
        requestId: row._id,
        ...(row.encounterId ? { encounterId: row.encounterId } : {}),
        ...attackerIds(p.attacker),
        ...(offer ? { afterHit: true } : {}),
        attackerLabel: p.attacker.label,
        ...(p.attacker.feature !== undefined ? { feature: p.attacker.feature } : {}),
        originalTargetId: p.targetCharacterId,
        targetCharacterId: memberId(members, state.targetId, p.targetCharacterId),
        targetName: nameOf(state.targetId),
        damage: p.damage,
        damageType: p.damageType,
        direct: p.direct,
        critical: p.critical,
        awaiting: offer ? [{ characterId: offer.characterId, name: nameOf(offer.characterId), role: "target" as const }] : awaiting(state).map((id) => ({ characterId: memberId(members, id, p.targetCharacterId), name: nameOf(id), role: state.responders.find((r) => r.characterId === id)?.role ?? ("ally" as const) })),
        answers: row.responses.length,
        createdAt: row.createdAt,
      });
    }
    return out;
  },
});

/** SD4 (Q2): the GM's line for a held attack: who it targets and who still has to answer before the roll. */
async function preRollWindow(ctx: QueryCtx, row: PreRollRow) {
  const p = row.payload;
  const party = await partyMembers(ctx, row.campaignId);
  const nameOf = (id: string) => party.find((m) => m.character._id === id)?.sheet.name ?? "Unknown";
  const first = p.attack.targetCharacterIds[0]!;
  return {
    requestId: row._id,
    ...(row.encounterId ? { encounterId: row.encounterId } : {}),
    instanceId: p.attacker.instanceId,
    attackerLabel: p.attacker.label,
    ...(p.attacker.feature !== undefined ? { feature: p.attacker.feature } : {}),
    originalTargetId: first,
    targetCharacterId: first,
    targetName: p.attack.targetCharacterIds.map(nameOf).join(", "),
    damage: 0,
    damageType: "physical" as const,
    direct: false,
    critical: false,
    awaiting: p.responders.filter((r) => !row.responses.some((x) => x.characterId === r.characterId)).map((r) => ({ characterId: r.characterId, name: nameOf(r.characterId), role: p.attack.targetCharacterIds.includes(r.characterId) ? ("target" as const) : ("ally" as const) })),
    answers: row.responses.length,
    createdAt: row.createdAt,
    preRoll: true,
  };
}
