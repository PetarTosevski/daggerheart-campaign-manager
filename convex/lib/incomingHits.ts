/**
 * Incoming hits on PCs and their reaction windows (plan combat-actions, tracer AA2; docs/tasks/TASK-CA-AA2.md). One
 * `combatRequests` row of kind `incomingHit` per hit PC: the damage waits while the target chooses armor and allies
 * answer with eligible reaction cards, then the hit resolves into HP / Stress / Armor / Hope marks on the sheet. The
 * state machine is AA1's pure window (src/lib/domain/adversary-actions/window.ts); this module stores, rebuilds and
 * writes it. Callers are campaign wrappers that already checked access.
 *
 * User answers (binding, quoted in the task doc): Q13 the hit PC chooses whether to mark an Armor Slot and allies may
 * respond (I Am Your Shield, CB p.341); Q14 the hit PC sees the damage and its severity against their own thresholds,
 * never the roll; Q17 (a) the window closes when the target chose armor and every eligible ally answered, or on the
 * GM's "Resolve now", no timer; Q18 (a) without a live map no range limits; 2026-10-22: card damage to another PC opens
 * the same incoming hit (this module is that API; see `openIncomingHit`).
 *
 * Rules (printed pages): CB p.91 thresholds, last HP → death move; CB p.114 one Armor Slot per hit, one step each;
 * CB p.99 no Armor Slot on direct damage; CB p.195 forced slots "without gaining its benefit"; CB p.92 Stress overflow.
 *
 * Storage: the row holds the hit, its responders and the answers (AA0's validators, unchanged). The window is rebuilt
 * from them on every read: `openWindow` with the party now, the stored responders, then every stored answer in order.
 * A card answer's folds are recomputed by re-running the card with dice seeded from the request and the answer's index
 * (`seededRng`), so a rolled fold (Rune Ward's 1d8) comes out the same every time and can't be fished for.
 *
 * Every actionLog row written here carries the request's `createdBy` (the GM who made the attack) as actor, so a player
 * can't undo an adversary's hit by undoing their own armor answer; the GM undoes the whole group.
 *
 * AA2b (docs/tasks/TASK-CA-AA2b.md; user answers 2026-10-22): the attacker may be a PC (a card's damage to an ally); the
 * attack's riders (conditions, effects, Stress, Hope) wait in the row and land on whoever takes the hit, so they follow
 * I Am Your Shield; a hit that marks the target's last HP makes the sheet's death move due at once (`deathMoveSpent`
 * cleared, `deathMove` returned); the hit PC's after-hit card uses run (Rise Up, Valor-Touched) or are offered with the
 * row kept open (`afterHit`: Unbreakable); Bold Presence keeps condition riders off.
 */
import { applyDamageTo, applyStressTo, rangeCheck, type Combatant } from "../../src/lib/domain/combat-actions/index";
import { run as runCardUse, type PlanStep, type RunPlan, type RunRefusal } from "../../src/lib/domain/card-effects/run";
import type { Range } from "../../src/lib/domain/card-effects/types";
import { derivedThresholds } from "../../src/lib/domain/characters/derived";
import { hopeMax } from "../../src/lib/domain/characters/index";
import {
  afterHitUses,
  armorPreview,
  awaiting as awaitingOf,
  isComplete,
  openWindow,
  resolveNow,
  resolveWindow,
  respond as windowRespond,
  runReactionCard,
  targetPrompt,
  type HitChoice,
  type PcSeverity,
  type WindowHit,
  type WindowPc,
  type WindowResolution,
  type WindowState,
} from "../../src/lib/domain/adversary-actions/index";
import type { Rng } from "../../src/lib/domain/dice/index";
import { appError } from "../../src/lib/errors/app-error";
import { cardEffect } from "../../src/lib/srd/card-effects/index";
import { getDomainCard } from "../../src/lib/srd/index";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { logAction } from "./actionLog";
import { cardActor, pcCombatant, writeSheetChanges } from "./cardRunner";
import { partyOf, readSheet, saveSheet } from "./characterSheet";
import { tokensOnMap } from "./combatMaps";
import { closeRequest } from "./combatRequests";
import type { AdversaryBefore } from "./validators/actionLog";
import { MAX_RIDERS, type AfterHit, type HitResponder, type HitRider, type IncomingHitPayload, type PcAttacker } from "./validators/combatRequests";

/** The most responders one window lists (the party cap the validator names, CD8). */
export const MAX_RESPONDERS = 12;

/** One hit before armor, as the runner's `IncomingHitDraft` gives it. */
export type HitDraft = {
  amount: number;
  type: "physical" | "magic" | "both";
  direct: boolean;
  forcedArmor: number;
  critical: boolean;
  /** Kept only in memory (an Evasion fold compares against it at once); never stored (Q14). */
  attackTotal?: number;
};

export type HitAttacker = IncomingHitPayload["attacker"];

/** A PC attacker (a card's damage to an ally, AA2b); otherwise the attacker is an adversary instance. */
export function isPcAttacker(attacker: HitAttacker): attacker is PcAttacker {
  return "kind" in attacker && attacker.kind === "pc";
}

/** The attacking instance, or null for a PC attacker. */
export function attackerInstanceId(attacker: HitAttacker): Id<"encounterAdversaries"> | null {
  return isPcAttacker(attacker) ? null : attacker.instanceId;
}

/** An active character of the campaign with a readable sheet. */
export type PartyMember = { character: Doc<"characters">; sheet: CharacterSheet };

/** Distance band between two characters' tokens on the live map; undefined without a map (Q18: any range). */
export type BandBetween = (from: Id<"characters">, to: Id<"characters">) => Range | undefined;

// ---------------------------------------------------------------- the party

/** The campaign's active characters with readable sheets (bounded by the campaign's character cap). */
export async function partyMembers(ctx: QueryCtx, campaignId: Id<"campaigns">): Promise<PartyMember[]> {
  const out: PartyMember[] = [];
  for (const character of await partyOf(ctx, campaignId)) {
    if (character.status !== "active") continue;
    try {
      out.push({ character, sheet: readSheet(character.sheet) });
    } catch {
      // A corrupt sheet can't take or answer a hit; its own reads report CHARACTER_CORRUPT.
    }
  }
  return out;
}

/** Bands between the PCs' tokens on a map (the window's card ranges, I Am Your Shield's Very Close). */
export async function bandsOnMap(ctx: QueryCtx, mapId: Id<"combatMaps"> | undefined): Promise<BandBetween> {
  if (mapId === undefined) return () => undefined;
  const map = await ctx.db.get("combatMaps", mapId);
  if (map === null || !map.live) return () => undefined;
  const tokens = await tokensOnMap(ctx, mapId);
  const tokenOf = (id: Id<"characters">) => tokens.find((t) => t.ref.kind === "pc" && t.ref.characterId === id);
  return (from, to) => {
    const a = tokenOf(from);
    const b = tokenOf(to);
    return a && b ? rangeCheck(a, b, "melee").band : undefined;
  };
}

/** A PC as the window reads them: thresholds (armor + level, CB p.91), tracks, Evasion, loadout cards with effects. */
export function windowPcOf(member: PartyMember, bandToTarget?: Range): WindowPc {
  const { character, sheet } = member;
  const c = pcCombatant(character._id, sheet);
  const cards = sheet.domainCards.loadout.flatMap((id) => {
    const effect = cardEffect(id);
    return effect ? [effect] : [];
  });
  return {
    id: character._id,
    thresholds: derivedThresholds(sheet),
    hp: sheet.hp,
    hpMax: sheet.hpMax,
    stress: sheet.stress,
    stressMax: sheet.stressMax,
    armor: c.armor,
    armorMax: c.armorMax,
    hope: sheet.hope,
    ...(c.evasion !== undefined ? { evasion: c.evasion } : {}),
    featureUses: sheet.featureUses,
    cards,
    ...(bandToTarget !== undefined ? { bandToTarget } : {}),
  };
}

/** The typed id of a character the window names by string (always one of the party, or the stored target). */
export function memberId(members: readonly PartyMember[], id: string, fallback: Id<"characters">): Id<"characters"> {
  return members.find((m) => m.character._id === id)?.character._id ?? fallback;
}

function windowParty(party: readonly PartyMember[], targetId: Id<"characters">, bands: BandBetween): WindowPc[] {
  return party.map((m) => windowPcOf(m, m.character._id === targetId ? undefined : bands(m.character._id, targetId)));
}

// ---------------------------------------------------------------- dice for card answers

/** FNV-1a, 32 bit. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** Dice seeded from the request and the answer's index (mulberry32): a card answer's folds rebuild the same every time. */
export function seededRng(seed: string): Rng {
  let a = hash(seed);
  return (sides: number) => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    return Math.floor(r * sides) + 1;
  };
}

// ---------------------------------------------------------------- opening a hit

export type OpenHitInput = {
  campaignId: Id<"campaigns">;
  encounterId?: Id<"encounters">;
  mapId?: Id<"combatMaps">;
  /** The GM who made the attack (the rows' actor). */
  createdBy: Id<"users">;
  /** The action's actionLog group; the hit's resolution logs into it, so one undo reverts the lot (U4). */
  groupId: string;
  attacker: HitAttacker;
  targetCharacterId: Id<"characters">;
  targetTokenId?: Id<"combatTokens">;
  hit: HitDraft;
  party: readonly PartyMember[];
  bands: BandBetween;
  /** AA2b: the attack's riders, for whoever takes the hit (at most MAX_RIDERS). */
  riders?: readonly HitRider[];
};

function windowHitOf(attacker: HitAttacker, hit: Pick<HitDraft, "amount" | "type" | "direct" | "forcedArmor" | "critical" | "attackTotal">, riders: readonly HitRider[] = []): WindowHit {
  return {
    amount: hit.amount,
    type: hit.type,
    direct: hit.direct,
    ...(hit.forcedArmor > 0 ? { forcedArmor: hit.forcedArmor } : {}),
    attackerId: isPcAttacker(attacker) ? attacker.characterId : attacker.instanceId,
    critical: hit.critical,
    ...(hit.attackTotal !== undefined ? { attackTotal: hit.attackTotal } : {}),
    ...(riders.some(isConditionRider) ? { conditionRiders: true } : {}),
  };
}

/** A rider Bold Presence avoids ("when you would gain a condition"): a condition, or a card tag's effect. */
function isConditionRider(r: HitRider): boolean {
  return r.kind === "condition" || (r.kind === "effect" && r.fromCondition === true);
}

/** The party a hit's window reads: a PC attacker doesn't answer their own card's hit. */
function respondingParty(party: readonly PartyMember[], attacker: HitAttacker): readonly PartyMember[] {
  return isPcAttacker(attacker) ? party.filter((m) => m.character._id !== attacker.characterId) : party;
}

/**
 * Opens one hit's reaction window (Q13): the responders are the target (when they can mark an Armor Slot or hold an
 * eligible card) and every ally with an eligible reaction card (at most MAX_RESPONDERS). A window nobody has to answer
 * resolves in the same mutation. Returns the row and, when it resolved, the resolution.
 *
 * Card damage to another PC (user answer 2026-10-22) opens the same row with a PC `attacker` (AA2b, widened); that PC
 * doesn't answer their own card's hit.
 */
export async function openIncomingHit(ctx: MutationCtx, input: OpenHitInput): Promise<{ requestId: Id<"combatRequests">; resolution: HitResolution | null }> {
  const riders = (input.riders ?? []).slice(0, MAX_RIDERS);
  const party = windowParty(respondingParty(input.party, input.attacker), input.targetCharacterId, input.bands);
  const state = openWindow({ hit: windowHitOf(input.attacker, input.hit, riders), targetId: input.targetCharacterId, party });
  const responders: HitResponder[] = state.responders.slice(0, MAX_RESPONDERS).map((r) => ({
    characterId: memberId(input.party, r.characterId, input.targetCharacterId),
    role: r.role,
    cardIds: r.cardIds.slice(0, 10),
  }));
  const requestId = await ctx.db.insert("combatRequests", {
    campaignId: input.campaignId,
    ...(input.encounterId ? { encounterId: input.encounterId } : {}),
    ...(input.mapId ? { mapId: input.mapId } : {}),
    kind: "incomingHit",
    status: "open",
    createdBy: input.createdBy,
    createdAt: Date.now(),
    responses: [],
    payload: {
      schemaVersion: 1,
      kind: "incomingHit",
      attacker: input.attacker,
      targetCharacterId: input.targetCharacterId,
      ...(input.targetTokenId ? { targetTokenId: input.targetTokenId } : {}),
      damage: Math.max(0, Math.trunc(input.hit.amount)),
      damageType: input.hit.type,
      direct: input.hit.direct,
      ...(input.hit.forcedArmor > 0 ? { forcedArmor: input.hit.forcedArmor } : {}),
      critical: input.hit.critical,
      groupId: input.groupId,
      responders,
      ...(riders.length > 0 ? { riders: [...riders] } : {}),
    },
  });
  if (!isComplete({ ...state, responders: state.responders.slice(0, MAX_RESPONDERS) })) return { requestId, resolution: null };
  const row = await ctx.db.get("combatRequests", requestId);
  if (row === null || !isHitRow(row)) throw new Error("openIncomingHit: the row just written is gone.");
  return { requestId, resolution: await resolveIncomingHit(ctx, { row, by: input.createdBy, early: false, ...(input.hit.attackTotal !== undefined ? { attackTotal: input.hit.attackTotal } : {}) }) };
}

// ---------------------------------------------------------------- rebuilding a window

export type HitRow = Doc<"combatRequests"> & { payload: IncomingHitPayload };

export function isHitRow(row: Doc<"combatRequests">): row is HitRow {
  return row.kind === "incomingHit" && row.payload.kind === "incomingHit";
}

/**
 * The attacker as a creature (the card runner's trigger `source`): the instance, or a PC attacker's character (AA2b,
 * `instance` null); null when it is gone.
 */
async function attackerCombatant(ctx: QueryCtx, row: HitRow, members: readonly PartyMember[]): Promise<{ instance: Doc<"encounterAdversaries"> | null; combatant: Combatant } | null> {
  const attacker = row.payload.attacker;
  if (isPcAttacker(attacker)) {
    const member = members.find((m) => m.character._id === attacker.characterId);
    return member ? { instance: null, combatant: pcCombatant(member.character._id, member.sheet) } : null;
  }
  const instance = await ctx.db.get("encounterAdversaries", attacker.instanceId);
  if (instance === null || instance.campaignId !== row.campaignId) return null;
  return {
    instance,
    combatant: {
      id: instance._id,
      side: "adversary",
      difficulty: instance.stats.difficulty,
      thresholds: { major: instance.stats.major, severe: instance.stats.severe },
      hp: instance.hp,
      hpMax: instance.stats.hpMax,
      stress: instance.stress,
      stressMax: instance.stats.stressMax,
      defeated: instance.defeated,
      ...(instance.resistance ? { resistance: { physical: instance.resistance.physical, magic: instance.resistance.magic } } : {}),
      conditions: instance.conditions,
      tags: instance.tags,
    },
  };
}

/** The responder's sheet with its card's resources topped up, so re-running a paid card for its folds can't refuse. */
function replayActor(member: PartyMember, cardId: string) {
  const s = member.sheet;
  const sheet: CharacterSheet = {
    ...s,
    hope: hopeMax(s.scars, s.hopeSlotBonus),
    stress: 0,
    hp: 0,
    armorMarked: 0,
    featureUses: s.featureUses.filter((u) => !u.key.startsWith(`card:${cardId}`)),
  };
  return cardActor(member.character._id, sheet, cardId, undefined);
}

export type Rebuilt = { state: WindowState; party: WindowPc[]; members: PartyMember[]; attacker: Awaited<ReturnType<typeof attackerCombatant>> };

/** The row's window now: opened with today's party and the stored responders, then every stored answer replayed. */
export async function rebuildWindow(ctx: QueryCtx, row: HitRow, attackTotal?: number): Promise<Rebuilt> {
  const p = row.payload;
  const everyone = await partyMembers(ctx, row.campaignId);
  const members = [...respondingParty(everyone, p.attacker)];
  const bands = await bandsOnMap(ctx, row.mapId);
  const party = windowParty(members, p.targetCharacterId, bands);
  const attacker = await attackerCombatant(ctx, row, everyone);
  const hit = windowHitOf(p.attacker, { amount: p.damage, type: p.damageType, direct: p.direct, forcedArmor: p.forcedArmor ?? 0, critical: p.critical, ...(attackTotal !== undefined ? { attackTotal } : {}) }, p.riders ?? []);
  let state: WindowState = { ...openWindow({ hit, targetId: p.targetCharacterId, party }), responders: p.responders.map((r) => ({ ...r, cardIds: [...r.cardIds] })) };
  for (const [i, answer] of row.responses.entries()) {
    let folds;
    if (answer.choice.kind === "card") {
      const card = cardEffect(answer.choice.cardId);
      const member = members.find((m) => m.character._id === answer.characterId);
      const target = members.find((m) => m.character._id === state.targetId);
      if (card && member && target) {
        const actor = replayActor(member, card.cardId);
        const creatures = { target: pcCombatant(target.character._id, target.sheet), ...(attacker ? { attacker: attacker.combatant } : {}) };
        folds = runReactionCard(card, actor, state, creatures, seededRng(`${row._id}:${i}`), answer.choice.useId).folds;
      }
    }
    const next = windowRespond(state, { characterId: answer.characterId, choice: answer.choice, ...(folds ? { folds } : {}) });
    if (next.ok) state = next.state;
  }
  return { state, party, members, attacker };
}

// ---------------------------------------------------------------- answering

function cardRefusal(r: RunRefusal) {
  switch (r.reason) {
    case "exhausted":
      return appError("CARD_EXHAUSTED", r.detail);
    case "cost":
      return appError("CARD_COST_UNPAID", `Short of: ${r.detail}.`);
    case "targets":
      return appError("COMBAT_TARGET_INVALID", r.detail);
    default:
      return appError("INVALID", r.detail);
  }
}

/** The responder's sheet after paying a reaction card: resources, its once-per entry, tokens, effects, the vault (CB p.101). */
function sheetAfterCard(sheet: CharacterSheet, plan: RunPlan, who: string, cardName: string): CharacterSheet {
  const after = plan.actor.after;
  const base = writeSheetChanges(sheet, plan.steps, who, plan.cardId, cardName, plan.exclusive, true);
  const others = (sheet.cardTokens ?? []).filter((t) => t.cardId !== plan.cardId);
  const cardTokens = after.cardTokens > 0 ? [...others, { cardId: plan.cardId, count: Math.min(99, after.cardTokens) }] : others;
  const toVault = plan.steps.some((s: PlanStep) => s.kind === "toVault");
  return {
    ...base,
    hope: after.hope,
    stress: Math.min(sheet.stressMax, after.stress),
    hp: Math.min(sheet.hpMax, after.hp),
    armorMarked: Math.max(0, after.armor),
    featureUses: plan.actor.featureUses.slice(-40),
    cardTokens,
    ...(toVault ? { domainCards: { ...sheet.domainCards, loadout: sheet.domainCards.loadout.filter((c) => c !== plan.cardId) } } : {}),
  };
}

export type RespondInput = { row: HitRow; characterId: Id<"characters">; choice: HitChoice; by: Id<"users"> };

/**
 * Records one answer (Q13, Q17): the target's armor choice (`armor {slots}` up to what this hit allows, `noArmor`,
 * `pass`) or a responder's reaction card, run through CA1's card runner with the hit as its trigger and paid at once
 * (its Stress / Hope, its once-per entry, Shrug It Off's vault). NOT_A_RESPONDER for a character the window doesn't
 * list, one that already answered, or a card it wasn't offered; INVALID for more Armor Slots than allowed. Returns
 * whether the window is now complete (the caller resolves it in the same mutation).
 */
export async function respondToHit(ctx: MutationCtx, input: RespondInput): Promise<{ complete: boolean }> {
  const { row, characterId, choice } = input;
  const rebuilt = await rebuildWindow(ctx, row);
  const { state, members, attacker } = rebuilt;
  const member = members.find((m) => m.character._id === characterId);
  if (!member) throw appError("NOT_A_RESPONDER");
  let folds;
  let paid: { sheet: CharacterSheet; cardName: string } | null = null;
  if (choice.kind === "armor") {
    const slots = choice.slots ?? 1;
    if (!Number.isInteger(slots) || slots < 1) throw appError("INVALID", "Mark at least one Armor Slot.");
    const defense = rebuilt.party.find((p) => p.id === characterId);
    if (state.targetId === characterId && defense && slots > targetPrompt(state, defense).maxSlots) throw appError("INVALID", "You can't mark that many Armor Slots on this hit.");
  }
  if (choice.kind === "card") {
    const card = cardEffect(choice.cardId);
    const target = members.find((m) => m.character._id === state.targetId);
    if (!card || !target) throw appError("NOT_A_RESPONDER", choice.cardId);
    const actor = cardActor(characterId, member.sheet, card.cardId, undefined);
    const creatures = { target: pcCombatant(target.character._id, target.sheet), ...(attacker ? { attacker: attacker.combatant } : {}) };
    const run = runReactionCard(card, actor, state, creatures, seededRng(`${row._id}:${row.responses.length}`), choice.useId);
    if (!run.result.ok) throw cardRefusal(run.result);
    folds = run.folds;
    const cardName = getDomainCard(card.cardId)?.name ?? card.cardId;
    paid = { sheet: sheetAfterCard(member.sheet, run.result.plan, characterId, cardName), cardName };
  }
  const next = windowRespond(state, { characterId, choice, ...(folds ? { folds } : {}) });
  if (!next.ok) throw appError(next.code, next.detail);

  if (paid) {
    await saveSheet(ctx, characterId, paid.sheet);
    const targetName = members.find((m) => m.character._id === state.targetId)?.sheet.name ?? "an ally";
    await logAction(ctx, {
      campaignId: row.campaignId,
      characterId,
      actorId: row.createdBy,
      kind: "adversary",
      visibility: "public",
      summary: characterId === state.targetId ? `${member.sheet.name} uses ${paid.cardName}` : `${member.sheet.name} uses ${paid.cardName} for ${targetName}`,
      groupId: row.payload.groupId,
      before: member.sheet,
      undoable: true,
    });
  }
  await ctx.db.patch("combatRequests", row._id, { responses: [...row.responses, { characterId, choice, by: input.by, at: Date.now() }] });
  return { complete: isComplete(next.state) };
}

// ---------------------------------------------------------------- resolving

export type HitResolution = {
  requestId: Id<"combatRequests">;
  /** The action's actionLog group (the attacker's triggers log into it). */
  groupId: string;
  attacker: HitAttacker;
  originalTargetId: Id<"characters">;
  /** Who took the hit (after I Am Your Shield). */
  targetId: Id<"characters">;
  missed: boolean;
  negated: boolean;
  severity: PcSeverity;
  hpMarked: number;
  stressMarked: number;
  armorMarked: number;
  deathMove: boolean;
  taken: number;
  manual: string[];
  /** The window's raw resolution (the adversary side reads it for its triggers). */
  window: WindowResolution;
  /** AA2b: the riders that landed on the target (none when the hit was avoided or Bold Presence kept them off). */
  ridersApplied: number;
  /** AA2b: after-hit card uses that ran at once (Rise Up, Valor-Touched), by card name. */
  autos: string[];
  /** AA2b: set when the target still has an after-hit card to answer (the row stays open for it). */
  afterHit: AfterHit | null;
};

// ---------------------------------------------------------------- riders and after-hit uses (AA2b)

const EFFECT_ID = /^(.*):(\d+)$/;

/** An effect id not on the sheet yet (a rider's effect keeps its id unless the target already has it). */
function freeEffectId(effects: readonly { id: string }[], id: string): string {
  if (!effects.some((e) => e.id === id)) return id;
  const base = EFFECT_ID.exec(id)?.[1] ?? id.slice(0, 36);
  for (let n = 1; n < 100; n++) {
    const next = `${base}:${n}`.slice(-40);
    if (!effects.some((e) => e.id === next)) return next;
  }
  return id;
}

/**
 * The riders on the sheet of whoever took the hit (user answer 2026-10-22: the rider moves with the damage): conditions,
 * effects (the sheet keeps at most 20), Hope, Stress (a full track marks HP instead, CB p.92), forced HP. Bold Presence's
 * fold (`skipConditions`) keeps conditions and card tags off.
 */
export function applyRiders(sheet: CharacterSheet, riders: readonly HitRider[], skipConditions: boolean): { sheet: CharacterSheet; applied: number } {
  let next = sheet;
  let applied = 0;
  for (const r of riders) {
    if (skipConditions && isConditionRider(r)) continue;
    applied++;
    switch (r.kind) {
      case "condition":
        if (!next.conditions.includes(r.condition)) next = { ...next, conditions: [...next.conditions, r.condition] };
        break;
      case "effect":
        next = { ...next, effects: [...next.effects, { ...r.effect, id: freeEffectId(next.effects, r.effect.id) }].slice(-20) };
        break;
      case "hope":
        next = { ...next, hope: Math.max(0, Math.min(hopeMax(next.scars, next.hopeSlotBonus), next.hope + r.delta)) };
        break;
      case "stress": {
        const marked = applyStressTo(pcCombatant("rider", next), r.amount).after;
        next = { ...next, stress: Math.min(next.stressMax, marked.stress), hp: Math.min(next.hpMax, marked.hp) };
        break;
      }
      case "hp":
        next = { ...next, hp: Math.min(next.hpMax, next.hp + Math.max(0, Math.trunc(r.amount))) };
        break;
    }
  }
  return { sheet: next, applied };
}

/** Runs one of the hit PC's after-hit card uses with the hit as its trigger (dice seeded from the row: no fishing). */
function runAfterHitCard(member: PartyMember, sheet: CharacterSheet, cardId: string, useId: string | undefined, trigger: { amount: number; source?: Combatant }, seed: string): { plan: RunPlan; cardName: string } | RunRefusal {
  const card = cardEffect(cardId);
  if (!card) return { ok: false, reason: "noUse", detail: cardId };
  const actor = cardActor(member.character._id, sheet, cardId, undefined);
  const reactionUse = useId ?? card.uses.find((u) => u.activation.kind === "reaction")?.id;
  const result = runCardUse(card, { actor, gmFear: 0, ...(reactionUse ? { useId: reactionUse } : {}), trigger: { amount: trigger.amount, subject: pcCombatant(member.character._id, sheet), ...(trigger.source ? { source: trigger.source } : {}) }, rng: seededRng(seed) });
  if (!result.ok) return result;
  return { plan: result.plan, cardName: getDomainCard(cardId)?.name ?? cardId };
}

const SEVERITY_WORD: Record<PcSeverity, string> = { none: "No damage", minor: "Minor", major: "Major", severe: "Severe" };
const TYPE_WORD = { physical: "phy", magic: "mag", both: "phy/mag" } as const;

/**
 * Resolves the hit (Q17: complete, or the GM's "Resolve now" with `early`): AA1's `resolveWindow`, then the target's
 * HP / Stress / Armor / Hope on the sheet (CB p.91, p.114, p.92), reflected damage dealt to the attacker, and the rows:
 * a public row "<target> took <attacker>'s hit" (no numbers, Q14) with the sheet before, and a GM row with the damage,
 * severity, armor and marks (and the attacker's `adversaryBefore` when it took reflected damage). Closes the request.
 */
export async function resolveIncomingHit(ctx: MutationCtx, input: { row: HitRow; by: Id<"users">; early: boolean; attackTotal?: number }): Promise<HitResolution> {
  const { row } = input;
  const p = row.payload;
  const rebuilt = await rebuildWindow(ctx, row, input.attackTotal);
  const state = input.early ? resolveNow(rebuilt.state) : rebuilt.state;
  const res = resolveWindow(state, rebuilt.party);
  const target = rebuilt.members.find((m) => m.character._id === res.targetId);
  const result = res.result;
  const gm: string[] = [];
  const targetName = target?.sheet.name ?? "The target";

  let ridersApplied = 0;
  let deathMove = false;
  let afterHit: AfterHit | null = null;
  const autos: string[] = [];
  const kind = isPcAttacker(p.attacker) ? ("combat" as const) : ("adversary" as const);

  if (target && result) {
    const sheet = target.sheet;
    let next: CharacterSheet = { ...sheet, hp: result.after.hp, stress: result.after.stress, armorMarked: result.after.armor, hope: Math.max(0, result.after.hope) };
    // The attack's riders land on whoever took the hit (user answer 2026-10-22), unless it was avoided.
    if (!res.negated && (p.riders?.length ?? 0) > 0) {
      const landed = applyRiders(next, p.riders ?? [], res.conditionNegated);
      next = landed.sheet;
      ridersApplied = landed.applied;
      gm.push(`riders on ${targetName}: ${ridersApplied}${res.conditionNegated ? " (conditions avoided)" : ""}`);
    }
    const hpMarked = Math.max(0, next.hp - sheet.hp);
    deathMove = next.hpMax > 0 && sheet.hp < next.hpMax && next.hp >= next.hpMax;
    // After-hit card uses (CE-valor): autos run now; reactions are offered with the row kept open.
    const facts = { hpMarked, deathMove, armorSlots: result.armorSlots, fromAttack: true };
    const uses = afterHitUses(windowPcOf({ character: target.character, sheet: next }), facts);
    for (const [i, u] of uses.auto.entries()) {
      const ran = runAfterHitCard(target, next, u.cardId, u.useId, { amount: result.taken, ...(rebuilt.attacker ? { source: rebuilt.attacker.combatant } : {}) }, `${row._id}:after:${i}`);
      if ("ok" in ran) continue;
      next = sheetAfterCard(next, ran.plan, target.character._id, ran.cardName);
      autos.push(ran.cardName);
    }
    if (autos.length > 0) gm.push(`${targetName}: ${autos.join(", ")}`);
    if (uses.offers.length > 0) afterHit = { characterId: target.character._id, cardIds: uses.offers.slice(0, 10), severity: result.severity, hpMarked, deathMove };
    await saveSheet(ctx, target.character._id, next);
    // The sheet's death move is due at once (user answer 2026-10-22; CB p.91): a new last HP clears an earlier "spent".
    if (deathMove) await ctx.db.patch("characters", target.character._id, { deathMoveSpent: undefined });
    await logAction(ctx, {
      campaignId: row.campaignId,
      characterId: target.character._id,
      actorId: row.createdBy,
      kind,
      visibility: "public",
      summary: res.negated ? `${targetName} avoided ${p.attacker.label}'s hit` : `${targetName} took ${p.attacker.label}'s hit${deathMove ? " and must make a death move" : ""}${autos.length > 0 ? ` (${autos.join(", ")})` : ""}`,
      groupId: p.groupId,
      before: sheet,
      undoable: true,
    });
    const armor = result.armorSlots > 0 ? `, ${result.armorSlots} Armor Slot${result.armorSlots === 1 ? "" : "s"}` : "";
    const forced = result.forcedArmor > 0 ? `, ${result.forcedArmor} forced` : "";
    const resisted = result.resisted !== "none" ? ` (${result.resisted}: ${result.taken})` : "";
    const marks = [result.hpMarked > 0 ? `${result.hpMarked} HP (${result.after.hp}/${sheet.hpMax})` : "no HP", ...(result.stressMarked > 0 ? [`${result.stressMarked} Stress`] : []), ...(result.hopeSpent > 0 ? [`${result.hopeSpent} Hope`] : [])];
    gm.push(
      `${targetName}: ${result.incoming} ${TYPE_WORD[p.damageType]}${resisted} → ${SEVERITY_WORD[result.severityBefore]}${armor}${forced} → ${SEVERITY_WORD[result.severity]} → ${marks.join(", ")}${deathMove ? "; death move" : ""}`,
    );
  } else if (target) {
    gm.push(`${targetName}: ${res.missed ? "the hit became a miss" : "no damage"}`);
    await logAction(ctx, { campaignId: row.campaignId, actorId: row.createdBy, kind, visibility: "public", summary: `${targetName} avoided ${p.attacker.label}'s hit`, groupId: p.groupId, undoable: true });
  }
  if (afterHit) gm.push(`${targetName} may answer ${afterHit.cardIds.map((id) => getDomainCard(id)?.name ?? id).join(", ")}`);
  if (res.targetId !== res.originalTargetId) gm.push(`(redirected from ${rebuilt.members.find((m) => m.character._id === res.originalTargetId)?.sheet.name ?? "the first target"})`);
  if (input.early) gm.push("(resolved by the GM)");

  // Damage a card sends back (Arcane Reflection): the attacker takes it against its thresholds (CB p.91, p.99).
  const adversaryBefore: AdversaryBefore[] = [];
  const reflectedToAttacker = res.reflected.filter((r) => r.to === "attacker").reduce((n, r) => n + r.amount, 0);
  if (reflectedToAttacker > 0 && rebuilt.attacker && rebuilt.attacker.instance === null) {
    gm.push(`Reflected ${reflectedToAttacker} damage to ${p.attacker.label}: mark it on their sheet`);
  } else if (reflectedToAttacker > 0 && rebuilt.attacker && rebuilt.attacker.instance !== null) {
    const { combatant } = rebuilt.attacker;
    const instance = rebuilt.attacker.instance;
    const dealt = applyDamageTo(combatant, reflectedToAttacker, p.damageType);
    adversaryBefore.push({ instanceId: instance._id, hp: instance.hp, stress: instance.stress, defeated: instance.defeated, conditions: instance.conditions, tags: instance.tags });
    const hp = Math.min(instance.stats.hpMax, dealt.after.hp);
    await ctx.db.patch("encounterAdversaries", instance._id, { hp, defeated: instance.defeated || hp >= instance.stats.hpMax, updatedAt: Date.now() });
    gm.push(`${p.attacker.label} takes ${reflectedToAttacker} reflected → ${dealt.hpMarked} HP (${hp}/${instance.stats.hpMax})`);
  }
  for (const r of res.reflected.filter((x) => x.to === "picked")) gm.push(`Redirected ${r.amount} damage to a creature the player picks: apply it in the tracker`);
  for (const text of res.manual) gm.push(text);

  await logAction(ctx, {
    campaignId: row.campaignId,
    actorId: row.createdBy,
    kind,
    visibility: "gm",
    summary: `${p.attacker.label} → ${gm.join("; ")}`,
    groupId: p.groupId,
    ...(adversaryBefore.length > 0 ? { adversaryBefore } : {}),
    undoable: true,
  });
  // An after-hit card to answer keeps the row open for that character alone (AA2b); otherwise it closes.
  if (afterHit) await ctx.db.patch("combatRequests", row._id, { payload: { ...p, afterHit } });
  else await closeRequest(ctx, row._id, "resolved", input.by);
  return {
    requestId: row._id,
    groupId: p.groupId,
    attacker: p.attacker,
    originalTargetId: p.targetCharacterId,
    targetId: memberId(rebuilt.members, res.targetId, p.targetCharacterId),
    missed: res.missed,
    negated: res.negated,
    severity: result?.severity ?? "none",
    hpMarked: result?.hpMarked ?? 0,
    stressMarked: result?.stressMarked ?? 0,
    armorMarked: (result?.armorSlots ?? 0) + (result?.forcedArmor ?? 0),
    deathMove,
    taken: result?.taken ?? 0,
    manual: res.manual,
    window: res,
    ridersApplied,
    autos,
    afterHit,
  };
}

/**
 * An answer to an after-hit offer (AA2b; the row's `afterHit`): `card` runs the offered card with the hit as its trigger
 * (Unbreakable: 1d6 HP cleared, the card to the vault, CB p.342) and logs a public row in the hit's group; `pass` (or any
 * armor answer) declines it. A death-move offer whose moment passed (the character is no longer at their last HP or
 * left play) declines the row. NOT_A_RESPONDER for anyone else or a card not offered. Closes the row.
 */
export async function respondAfterHit(ctx: MutationCtx, input: RespondInput & { row: HitRow & { payload: { afterHit: AfterHit } } }): Promise<"resolved" | "declined"> {
  const { row, characterId, choice } = input;
  const offer = row.payload.afterHit;
  if (offer.characterId !== characterId) throw appError("NOT_A_RESPONDER");
  if (choice.kind !== "card") {
    await closeRequest(ctx, row._id, "resolved", input.by);
    return "resolved";
  }
  if (!offer.cardIds.includes(choice.cardId)) throw appError("NOT_A_RESPONDER", choice.cardId);
  const members = await partyMembers(ctx, row.campaignId);
  const member = members.find((m) => m.character._id === characterId);
  if (!member || (offer.deathMove && member.sheet.hp < member.sheet.hpMax)) {
    await closeRequest(ctx, row._id, "declined", input.by);
    return "declined";
  }
  const ran = runAfterHitCard(member, member.sheet, choice.cardId, choice.useId, { amount: offer.hpMarked }, `${row._id}:afterHit`);
  if ("ok" in ran) throw cardRefusal(ran);
  const next = sheetAfterCard(member.sheet, ran.plan, characterId, ran.cardName);
  await saveSheet(ctx, characterId, next);
  await logAction(ctx, {
    campaignId: row.campaignId,
    characterId,
    actorId: row.createdBy,
    kind: isPcAttacker(row.payload.attacker) ? "combat" : "adversary",
    visibility: "public",
    summary: `${member.sheet.name} uses ${ran.cardName}${offer.deathMove ? " instead of a death move" : ""}`,
    groupId: row.payload.groupId,
    before: member.sheet,
    undoable: true,
  });
  await ctx.db.patch("combatRequests", row._id, { responses: [...row.responses, { characterId, choice, by: input.by, at: Date.now() }] });
  await closeRequest(ctx, row._id, "resolved", input.by);
  return "resolved";
}

/** A hit row waiting only for its after-hit answer. */
export function hasAfterHit(row: HitRow): row is HitRow & { payload: { afterHit: AfterHit } } {
  return row.payload.afterHit !== undefined;
}

// ---------------------------------------------------------------- reading

/** Whether the hit's actionLog group was undone (undo leaves the hit's row open; it is declined when next touched). */
export async function groupUndone(ctx: QueryCtx, row: HitRow): Promise<boolean> {
  const first = await ctx.db
    .query("actionLog")
    .withIndex("by_campaign_group", (q) => q.eq("campaignId", row.campaignId).eq("groupId", row.payload.groupId))
    .first();
  return first !== null && first.undoneAt !== undefined;
}

export type HitView = {
  requestId: Id<"combatRequests">;
  attackerLabel: string;
  targetCharacterId: Id<"characters">;
  targetName: string;
  role: "target" | "ally";
  /** Still owed an answer from this character. */
  awaiting: boolean;
  cardIds: string[];
  createdAt: number;
  /** Only for the hit PC (Q14): the damage, its severity against their own thresholds, the slots they may mark. */
  damage?: number;
  severity?: PcSeverity;
  direct?: boolean;
  maxSlots?: number;
  armorPreview?: { slots: number; severity: PcSeverity; hp: number }[];
  /**
   * AA2b: the hit already resolved and this character (who took it) may answer an after-hit card (`cardIds`, e.g.
   * Unbreakable) with `card` or `pass`; no armor choice. `deathMove`: the hit marked their last HP.
   */
  afterHit?: boolean;
  deathMove?: boolean;
  /** AA2b: after a redirect (I Am Your Shield), who was hit first ("Tabby stepped in" on their line). */
  originalTargetName?: string;
};

/** What one character sees of an open hit: the target their own numbers (Q14), an ally only who was hit and their cards. */
export async function hitView(ctx: QueryCtx, row: HitRow, characterId: Id<"characters">): Promise<HitView | null> {
  const offer = row.payload.afterHit;
  if (offer) {
    if (offer.characterId !== characterId) return null;
    const member = (await partyMembers(ctx, row.campaignId)).find((m) => m.character._id === characterId);
    return {
      requestId: row._id,
      attackerLabel: row.payload.attacker.label,
      targetCharacterId: characterId,
      targetName: member?.sheet.name ?? "Unknown",
      role: "target",
      awaiting: true,
      cardIds: offer.cardIds,
      createdAt: row.createdAt,
      afterHit: true,
      deathMove: offer.deathMove,
    };
  }
  const { state, party, members } = await rebuildWindow(ctx, row);
  const responder = state.responders.find((r) => r.characterId === characterId);
  const isTarget = state.targetId === characterId;
  if (!responder && !isTarget && row.payload.targetCharacterId !== characterId) return null;
  const awaiting = awaitingOf(state).includes(characterId);
  const target = members.find((m) => m.character._id === state.targetId);
  // AA2b: a card this character already played in this window isn't offered again (I Am Your Shield after its use).
  const played = new Set(state.responses.flatMap((r) => (r.characterId === characterId && r.choice.kind === "card" ? [r.choice.cardId] : [])));
  const redirected = state.targetId !== state.originalTargetId;
  const view: HitView = {
    requestId: row._id,
    attackerLabel: row.payload.attacker.label,
    targetCharacterId: memberId(members, state.targetId, row.payload.targetCharacterId),
    targetName: target?.sheet.name ?? "Unknown",
    role: isTarget ? "target" : "ally",
    awaiting,
    cardIds: (responder?.cardIds ?? []).filter((id) => !played.has(id)),
    createdAt: row.createdAt,
    ...(redirected ? { originalTargetName: members.find((m) => m.character._id === state.originalTargetId)?.sheet.name ?? "Unknown" } : {}),
  };
  const defense = party.find((p) => p.id === characterId);
  if (isTarget && defense) {
    const prompt = targetPrompt(state, defense);
    const extra = prompt.maxSlots > 1 ? ("any" as const) : 0;
    return { ...view, damage: prompt.damage, severity: prompt.severity, direct: row.payload.direct, maxSlots: prompt.maxSlots, armorPreview: armorPreview(defense, state.hit, extra).slice(0, prompt.maxSlots + 1) };
  }
  return view;
}
