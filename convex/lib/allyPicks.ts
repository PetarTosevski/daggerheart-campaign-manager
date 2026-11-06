/**
 * Per-ally picks (plan finish-hud-lk, tracer FH-AP; bead dcm-bxp.99.32.24; user decisions 2026-11-05). A `choose` step
 * with `by` lets each chooser pick their own option (Rousing Strike, CB p.342: "you and all allies who can see or hear you
 * can clear a Hit Point or 1d4 Stress"; Critical Inspiration, CB p.341; Locust Swarm, Awesome Size and the Fire head of
 * Elemental Breath, HF p.92-93). Each chooser answers on their own screen:
 *
 * - The use waits whole (like a reaction window): nothing of it applies until every chooser answered. Its picks are one
 *   open `combatRequests` row of kind `allyPick` (convex/lib/validators/combatRequests.ts) holding what runs afterwards:
 *   a PC's rider on its attack (`source.kind` `rider`: the rider, its choices and the attack's roll) or an adversary
 *   feature use (`adversary`: `useFeature`'s arguments and the dice its first run rolled, replayed first).
 * - Only the chooser's player or the GM answers (`answerAllyPick`, access by `loadCharacter` / the wrapper's permission,
 *   both `permissionFor`); the GM answers any outstanding pick from the queue (a no-show).
 * - The last answer runs the use with every pick (`by:<step>:<chooser>` choices for a rider, `chooserOptions` for an
 *   adversary feature) in the use's actionLog group, so one Undo takes it all back.
 * - Undoing the use's group declines the row (`declineGroupHits` in ./actionLog.ts); ending the encounter declines it
 *   with every other open request of the encounter (`closeEncounterRequests`), as reaction windows end today. A row whose
 *   group was undone or whose encounter ended is declined when someone answers it.
 */
import { ConvexError } from "convex/values";

import type { CardUse } from "../../src/lib/domain/card-effects/types";
import { rangeCheck } from "../../src/lib/domain/combat-actions/index";
import { appError } from "../../src/lib/errors/app-error";
import { cardEffect } from "../../src/lib/srd/card-effects/index";
import { featureEffect } from "../../src/lib/srd/feature-effects/index";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { logAction } from "./actionLog";
export { holdForAllyPicks, pickDice } from "./allyPickHold";
import { adversaryAction } from "./adversaryActions";
import { parseChoices, type CardChoice } from "./cardChoices";
import { bindGates, buildRun, pickCard, runCard, writeSheetChanges, type HostRoll, type UsePick } from "./cardRunner";
import { readSheet, saveSheet } from "./characterSheet";
import { attackScene, riderFacts, runRiderPart, type AttackScene, type PickedRider, type RiderEnv } from "./combatActions";
import { closeRequest, encounterRunning } from "./combatRequests";
import { rollDie } from "./dice";
import { pickFeature } from "./featureRunner";
import { campaignFearState } from "./fear";
import { groupUndone } from "./incomingHits";
import { changed } from "./rolls";
import { ruleMode } from "./ruleModes";
import { MAX_ALLY_PICK_CHOOSERS, type AllyPickChooser, type AllyPickPayload } from "./validators/combatRequests";

export type AllyPickRow = Doc<"combatRequests"> & { payload: AllyPickPayload };

export function isAllyPickRow(row: Doc<"combatRequests">): row is AllyPickRow {
  return row.kind === "allyPick" && row.payload.kind === "allyPick";
}

// ---------------------------------------------------------------- what the data says

type ByChoose = { by: { to: string; pick?: { range?: string } } };

/** The first `choose` step with `by` among these steps (nested branches included), or undefined. */
function byChooseOf(steps: readonly unknown[]): ByChoose | undefined {
  for (const s of steps) {
    if (s === null || typeof s !== "object") continue;
    const step = s as { kind?: unknown; by?: unknown };
    if (step.kind === "choose" && step.by !== undefined) return step as ByChoose;
    for (const value of Object.values(s)) {
      const list = Array.isArray(value) ? value : value !== null && typeof value === "object" && Array.isArray((value as { steps?: unknown }).steps) ? (value as { steps: unknown[] }).steps : null;
      const found = list ? byChooseOf(list) : undefined;
      if (found) return found;
    }
  }
  return undefined;
}

/** Whether a use's choosers each pick their own option (a `choose` step with `by`). */
export function hasOwnPicks(steps: readonly unknown[]): boolean {
  return byChooseOf(steps) !== undefined;
}

function riderUseOf(r: Pick<PickedRider, "source" | "id" | "useId">): CardUse | undefined {
  const uses = r.source === "card" ? cardEffect(r.id)?.uses : featureEffect(r.id)?.uses;
  return uses?.find((u) => u.id === r.useId) as CardUse | undefined;
}

/** A rider whose choosers pick their own option: it never runs inline with the attack, it waits for the picks. */
export function riderHasOwnPicks(r: Pick<PickedRider, "source" | "id" | "useId">): boolean {
  const use = riderUseOf(r);
  return use !== undefined && hasOwnPicks(use.steps);
}

/**
 * The allies a rider's choosers are (the server names them: "all allies who can see or hear you", "all allies within Very
 * Close range"): every other PC token on the live map within the `by` pick's range of the attacker ("unlimited" or no
 * range: all of them), at most a party. With Defined Ranges off (optional rule `definedRanges`, CB p.103; user 2026-11-06:
 * automatic range effects don't apply, the actor decides) every other PC on the map. Either way the acting player then
 * unticks who can't see or hear them before the picks go out (`sendAllyPicks`, the row's `review`).
 */
function alliesFor(campaign: Doc<"campaigns">, scene: AttackScene, use: CardUse): string[] {
  const range = byChooseOf(use.steps)?.by.pick?.range;
  const measured =
    !ruleMode(campaign, "definedRanges") || range === undefined || range === "unlimited" || range === "weapon" ? null : (range as Parameters<typeof rangeCheck>[2]);
  return scene.scene.tokens
    .filter((t) => t._id !== scene.attacker._id && t.side === "pc" && t.ref.kind === "pc" && (measured === null || rangeCheck(scene.attacker, t, measured).inRange))
    .map((t) => t._id)
    .slice(0, MAX_ALLY_PICK_CHOOSERS - 1);
}

/** The rider's choices with the server's allies and the picks so far (`by:<step>:<chooser>`); the player's own lists go. */
function riderChoices(stored: readonly CardChoice[], allies: readonly string[], answers: AllyPickPayload["answers"]): CardChoice[] {
  const own = stored.filter((c) => c.id !== "allies" && c.id !== "picked" && !c.id.startsWith("by:"));
  return [...own, { id: "allies", value: [...allies] }, ...answers.map((a) => ({ id: `by:${a.stepId}:${a.chooserId}`, value: [...a.options] }))];
}

// ---------------------------------------------------------------- a PC's rider (Rousing Strike, Critical Inspiration)

/** Runs the rider whole on the attack's roll without writing; a chooser without a pick comes back as a choose ask. */
async function dryRun(env: RiderEnv, rider: PickedRider, sheet: CharacterSheet, hostRoll: HostRoll, allies: readonly string[]) {
  const transform = (use: CardUse): CardUse => ({ ...use, steps: bindGates(use.steps, hostRoll) });
  let pick: UsePick;
  if (rider.source === "feature") {
    pick = pickFeature({ sheet, campaign: env.campaign, featureId: rider.id, useId: rider.useId, times: 1, rollUsedExperience: env.rollUsedExperience, party: [], transform, extraFacts: await riderFacts(env, undefined, undefined) });
  } else {
    const base = pickCard(sheet, rider.id, rider.useId);
    const use = transform(base.use);
    pick = { ...base, use, effect: { ...base.effect, uses: base.effect.uses.map((u) => (u.id === use.id ? use : u)) } };
  }
  const choices = parseChoices(riderChoices(rider.choices, allies, []));
  const built = await buildRun(env.ctx, { campaign: env.campaign, character: env.character, sheet, scene: env.scene, pick, targetTokenIds: [], choices, roll: {}, gmFear: env.gmFear, lastRollWithHope: false });
  return runCard(built, pick, env.rng);
}

/** A character's name for the picks ("Mira"), or a token's label. */
async function chooserOf(ctx: MutationCtx, scene: AttackScene, tokenId: string): Promise<Pick<AllyPickChooser, "characterId" | "name">> {
  const token = scene.scene.tokens.find((t) => t._id === tokenId);
  if (token?.ref.kind === "pc") {
    const character = await ctx.db.get("characters", token.ref.characterId);
    if (character !== null) return { characterId: character._id, name: readSheet(character.sheet).name };
  }
  return { name: "a creature" };
}

/**
 * After an attack (a weapon's or a card's) is written: each rider whose choosers pick their own option and whose trigger
 * held opens its `allyPick` row (the actor's own pick included: Rousing Strike's "you and all allies"). A rider with no
 * chooser left (Critical Inspiration with no ally near) or one that can't run now (spent, unaffordable) opens nothing.
 * Returns the rows it opened, for the attack's answer.
 */
export async function openRiderAllyPicks(
  ctx: MutationCtx,
  input: { env: RiderEnv; riders: readonly PickedRider[]; hostRoll: HostRoll; entryId: Id<"actionLog">; groupId: string; encounterId?: Id<"encounters">; createdBy: Id<"users"> },
): Promise<{ requestId: Id<"combatRequests">; name: string }[]> {
  const out: { requestId: Id<"combatRequests">; name: string }[] = [];
  const { env } = input;
  for (const rider of input.riders) {
    const use = riderUseOf(rider);
    if (use === undefined) continue;
    const character = await ctx.db.get("characters", env.character._id);
    if (character === null) continue;
    const sheet = readSheet(character.sheet);
    const allies = alliesFor(env.campaign, env.scene, use);
    let outcome;
    try {
      outcome = await dryRun(env, rider, sheet, input.hostRoll, allies);
    } catch (e) {
      // Spent or unaffordable by now: the rider just doesn't happen (as an automatic use that can't run).
      if (e instanceof ConvexError) continue;
      throw e;
    }
    if (outcome.kind !== "needsChoice") continue;
    if (outcome.asks.some((a) => a.kind !== "choose" || a.chooserId === undefined)) throw appError("INVALID", `${rider.name}: ${outcome.asks.map((a) => a.label).join(", ")}.`);
    const choosers: AllyPickChooser[] = [];
    for (const a of outcome.asks.slice(0, MAX_ALLY_PICK_CHOOSERS)) {
      if (a.kind !== "choose" || a.chooserId === undefined) continue;
      choosers.push({ stepId: a.stepId, chooserId: a.chooserId, ...(await chooserOf(ctx, env.scene, a.chooserId)), label: a.label, options: a.options });
    }
    const requestId = await ctx.db.insert("combatRequests", {
      campaignId: env.campaign._id,
      ...(input.encounterId ? { encounterId: input.encounterId } : {}),
      mapId: env.scene.map._id,
      kind: "allyPick",
      status: "open",
      createdBy: input.createdBy,
      createdAt: Date.now(),
      responses: [],
      payload: {
        schemaVersion: 1,
        kind: "allyPick",
        name: rider.name.slice(0, 80),
        actorName: sheet.name.slice(0, 80),
        groupId: input.groupId,
        source: {
          kind: "rider",
          characterId: env.character._id,
          rider: { source: rider.source, id: rider.id, useId: rider.useId, name: rider.name.slice(0, 80) },
          choices: rider.choices.slice(0, 40),
          hostRoll: input.hostRoll,
          entryId: input.entryId,
        },
        choosers,
        answers: [],
        // CU2 (user 2026-11-06): with allies on the list, the actor reviews it first (`sendAllyPicks`).
        ...(choosers.some((c) => c.chooserId !== env.scene.attacker._id) ? { review: true as const } : {}),
      },
    });
    out.push({ requestId, name: rider.name });
  }
  return out;
}

/** The rider's run with every pick, written in the attack's group: the actor's sheet and each ally's. */
async function completeRider(ctx: MutationCtx, row: AllyPickRow, by: Id<"users">): Promise<"resolved" | "declined"> {
  const p = row.payload;
  if (p.source.kind !== "rider") throw appError("NOT_FOUND");
  const s = p.source;
  const entry = await ctx.db.get("actionLog", s.entryId);
  const campaign = await ctx.db.get("campaigns", row.campaignId);
  const character = await ctx.db.get("characters", s.characterId);
  const use = riderUseOf({ source: s.rider.source, id: s.rider.id, useId: s.rider.useId });
  if (entry === null || entry.undoneAt !== undefined || row.mapId === undefined || campaign === null || character === null || use === undefined) return decline(ctx, row, by);
  if (use.activation.kind !== "rider" && use.activation.kind !== "auto") return decline(ctx, row, by);
  const scene = await attackScene(ctx, campaign, character, row.mapId);
  const sheet = readSheet(character.sheet);
  const env: RiderEnv = {
    ctx,
    campaign,
    character,
    scene,
    host: { spec: { kind: "attack", weapon: "primary", difficulty: { kind: "target" } }, trait: undefined, weapon: true, weaponRange: null, damageType: "physical" },
    gmFear: (await campaignFearState(ctx, campaign._id)).fear,
    rng: rollDie,
    rollUsedExperience: false,
  };
  const allies = p.choosers.filter((c) => c.chooserId !== scene.attacker._id).map((c) => c.chooserId);
  const rider: PickedRider = { source: s.rider.source, id: s.rider.id, useId: s.rider.useId, name: s.rider.name, trigger: use.activation.trigger, phase: "after", choices: riderChoices(s.choices, allies, p.answers), auto: false };
  let run;
  try {
    run = await runRiderPart(env, rider, sheet, "whole", s.hostRoll, [], undefined);
  } catch (e) {
    if (e instanceof ConvexError) return decline(ctx, row, by, `${p.actorName}'s ${p.name} can't run now: nothing applied`);
    throw e;
  }
  if (run === null || run === "empty") return decline(ctx, row, by);
  // Each ally's Hit Points, Stress and Hope from the plan (as a card's ally rows, convex/combatCards.ts).
  for (const c of run.built.creatures.all) {
    if (c.kind !== "pc" || c.character._id === character._id) continue;
    const to = run.plan.creatures.find((x) => x.id === c.tokenId)?.after;
    let after = writeSheetChanges(c.sheet, run.plan.steps, c.tokenId, run.plan.cardId, run.name, run.plan.exclusive, false);
    if (to) after = { ...after, hp: Math.min(c.sheet.hpMax, to.hp), stress: Math.min(c.sheet.stressMax, to.stress), armorMarked: Math.max(0, to.armor ?? c.sheet.armorMarked) };
    if (!changed(c.sheet, after)) continue;
    await saveSheet(ctx, c.character._id, after);
    await logAction(ctx, { campaignId: row.campaignId, characterId: c.character._id, actorId: by, kind: "combat", visibility: "public", summary: `${c.sheet.name}: ${p.name} (${pickLine(p, c.tokenId)})`.slice(0, 1000), groupId: p.groupId, before: c.sheet, undoable: true });
  }
  const sheetChanged = changed(sheet, run.sheet);
  if (sheetChanged) await saveSheet(ctx, character._id, run.sheet);
  await logAction(ctx, {
    campaignId: row.campaignId,
    characterId: character._id,
    actorId: by,
    kind: "combat",
    visibility: "public",
    summary: `${p.actorName} · ${p.name} → ${p.choosers.map((c) => `${c.name}: ${pickLine(p, c.chooserId)}`).join("; ")}`.slice(0, 1000),
    groupId: p.groupId,
    ...(sheetChanged ? { before: sheet } : {}),
    undoable: true,
  });
  await closeRequest(ctx, row._id, "resolved", by);
  return "resolved";
}

/** "Clear a Hit Point": the option a chooser picked, by its label. */
function pickLine(p: AllyPickPayload, chooserId: string): string {
  const answer = p.answers.find((a) => a.chooserId === chooserId);
  const chooser = p.choosers.find((c) => c.chooserId === chooserId && c.stepId === answer?.stepId);
  return (answer?.options ?? []).map((id) => chooser?.options.find((o) => o.id === id)?.label ?? id).join(", ") || "no pick";
}

// ---------------------------------------------------------------- an adversary feature (Locust Swarm, Awesome Size, Fire)


/** The held feature run with every pick, in its group (as the GM sent it; the dice it rolled first are replayed). */
async function completeAdversary(ctx: MutationCtx, row: AllyPickRow, by: Id<"users">): Promise<"resolved" | "declined"> {
  const p = row.payload;
  if (p.source.kind !== "adversary") throw appError("NOT_FOUND");
  const campaign = await ctx.db.get("campaigns", row.campaignId);
  const user = await ctx.db.get("users", row.createdBy);
  if (campaign === null || user === null) return decline(ctx, row, by);
  const chooserOptions: Record<string, Record<string, string[]>> = {};
  for (const a of p.answers) (chooserOptions[a.stepId] ??= {})[a.chooserId] = [...a.options];
  // Closed first: the run reads open requests (its reaction windows), never this one.
  await closeRequest(ctx, row._id, "resolved", by);
  try {
    const out = await adversaryAction(ctx, campaign, user, { ...p.source.args }, undefined, { picks: { chooserOptions, dice: p.source.dice, groupId: p.groupId } });
    if (out.status !== "resolved") return decline(ctx, row, by, `${p.actorName}'s ${p.name} needs more Fear now: nothing applied`);
  } catch (e) {
    // The feature can't run any more (the adversary left, the Fear is gone): called off with a GM line.
    if (e instanceof ConvexError) return decline(ctx, row, by, `${p.actorName}'s ${p.name} can't run now: nothing applied`);
    throw e;
  }
  return "resolved";
}

async function decline(ctx: MutationCtx, row: AllyPickRow, by: Id<"users">, gmLine?: string): Promise<"declined"> {
  await closeRequest(ctx, row._id, "declined", by);
  if (gmLine) await logAction(ctx, { campaignId: row.campaignId, actorId: by, kind: "combat", visibility: "gm", summary: gmLine.slice(0, 1000), groupId: row.payload.groupId, undoable: false });
  return "declined";
}

// ---------------------------------------------------------------- the answer

/**
 * One chooser's pick (`allyPicks.answer`): the caller is already checked (the chooser's player or the GM). INVALID for an
 * option the chooser wasn't offered (or not exactly one); NOT_A_RESPONDER for a chooser the row doesn't list or one that
 * already picked. A row whose use was undone or whose encounter ended is declined. The last pick runs the use.
 */
export async function answerAllyPick(ctx: MutationCtx, row: AllyPickRow, pick: { stepId: string; chooserId: string; options: readonly string[] }, by: Id<"users">): Promise<"open" | "resolved" | "declined"> {
  const p = row.payload;
  const chooser = p.choosers.find((c) => c.stepId === pick.stepId && c.chooserId === pick.chooserId);
  if (p.review === true) throw appError("NOT_A_RESPONDER", "The picks haven't gone out yet.");
  if (chooser === undefined || p.answers.some((a) => a.stepId === pick.stepId && a.chooserId === pick.chooserId)) throw appError("NOT_A_RESPONDER");
  if (pick.options.length !== 1 || !chooser.options.some((o) => o.id === pick.options[0])) throw appError("INVALID", "Pick one of the options.");
  if (!(await encounterRunning(ctx, row)) || (await groupUndone(ctx, row))) return decline(ctx, row, by);
  const answers = [...p.answers, { stepId: pick.stepId, chooserId: pick.chooserId, options: [...pick.options], by, at: Date.now() }];
  const payload: AllyPickPayload = { ...p, answers };
  await ctx.db.patch("combatRequests", row._id, { payload });
  if (!p.choosers.every((c) => answers.some((a) => a.stepId === c.stepId && a.chooserId === c.chooserId))) return "open";
  const full: AllyPickRow = { ...row, payload };
  return p.source.kind === "rider" ? completeRider(ctx, full, by) : completeAdversary(ctx, full, by);
}

// ---------------------------------------------------------------- the actor's review (CU2)

/**
 * The acting player's review of the computed allies (plan rule-switches CU2, bead dcm-bxp.99.32.46, user 2026-11-06: "the
 * acting player can deselect allies from the computed list (can't see/hear) before the picks go out"; Rousing Strike, CB
 * p.342: "all allies who can see or hear you"). The caller is already checked (the actor's player or the GM). `drop`
 * names the choosers unticked; the actor's own pick (Rousing Strike's "you") can't be dropped (INVALID), nor a chooser
 * the row doesn't list (INVALID). NOT_A_RESPONDER once the picks went out. A row whose use was undone or whose encounter
 * ended is declined. Every chooser dropped: the rider doesn't happen (declined; its use is not spent). Else the picks go
 * out (`review` cleared) and each chooser answers (`answerAllyPick`).
 */
export async function sendAllyPicks(ctx: MutationCtx, row: AllyPickRow, drop: readonly string[], by: Id<"users">): Promise<"open" | "declined"> {
  const p = row.payload;
  if (p.review !== true || p.source.kind !== "rider") throw appError("NOT_A_RESPONDER", "The picks already went out.");
  const actorId = p.source.characterId;
  const dropped = new Set(drop);
  for (const id of dropped) {
    const chooser = p.choosers.find((c) => c.chooserId === id);
    if (chooser === undefined) throw appError("INVALID", "That character isn't on the list.");
    if (chooser.characterId === actorId) throw appError("INVALID", "Your own pick stays.");
  }
  if (!(await encounterRunning(ctx, row)) || (await groupUndone(ctx, row))) return decline(ctx, row, by);
  const choosers = p.choosers.filter((c) => !dropped.has(c.chooserId));
  if (choosers.length === 0) return decline(ctx, row, by);
  const payload: AllyPickPayload = { ...p, choosers };
  delete payload.review;
  await ctx.db.patch("combatRequests", row._id, { payload });
  return "open";
}
