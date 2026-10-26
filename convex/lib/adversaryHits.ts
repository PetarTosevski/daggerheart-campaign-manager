/**
 * The building blocks of incoming hits (plan combat-actions; split out of ./incomingHits.ts by AA2c, CH9: logic files
 * under 800 lines). The party a window reads, the PC as the window sees them, the seeded dice of card answers, the
 * stored row rebuilt into AA1's window state, a reaction card's payment, and the riders and after-hit card uses of
 * AA2b. ./incomingHits.ts opens, answers, resolves and reads hits with them and re-exports the public names, so callers
 * keep importing from there (docs/tasks/TASK-CA-AA2.md, TASK-CA-AA2b.md, TASK-CA-AA2c.md).
 *
 * Rules (printed pages): CB p.91 thresholds; CB p.92 Stress overflow; CB p.101 the vault; CB p.114 Armor Slots.
 */
import { applyStressTo, rangeCheck, type Combatant } from "../../src/lib/domain/combat-actions/index";
import { run as runCardUse, type PlanStep, type RunPlan, type RunRefusal } from "../../src/lib/domain/card-effects/run";
import type { Range } from "../../src/lib/domain/card-effects/types";
import { derivedThresholds } from "../../src/lib/domain/characters/derived";
import { hopeMax } from "../../src/lib/domain/characters/index";
import { openWindow, respond as windowRespond, runReactionCard, type WindowHit, type WindowPc, type WindowState } from "../../src/lib/domain/adversary-actions/index";
import type { Rng } from "../../src/lib/domain/dice/index";
import { appError } from "../../src/lib/errors/app-error";
import { cardEffect } from "../../src/lib/srd/card-effects/index";
import { getDomainCard } from "../../src/lib/srd/index";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { cardActor, pcCombatant, writeSheetChanges } from "./cardRunner";
import { partyOf, readSheet } from "./characterSheet";
import { tokensOnMap } from "./combatMaps";
import type { HitRider, IncomingHitPayload, PcAttacker } from "./validators/combatRequests";

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

export function windowParty(party: readonly PartyMember[], targetId: Id<"characters">, bands: BandBetween): WindowPc[] {
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

export function windowHitOf(attacker: HitAttacker, hit: Pick<HitDraft, "amount" | "type" | "direct" | "forcedArmor" | "critical" | "attackTotal">, riders: readonly HitRider[] = []): WindowHit {
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
export function isConditionRider(r: HitRider): boolean {
  return r.kind === "condition" || (r.kind === "effect" && r.fromCondition === true);
}

/** The party a hit's window reads: a PC attacker doesn't answer their own card's hit. */
export function respondingParty(party: readonly PartyMember[], attacker: HitAttacker): readonly PartyMember[] {
  return isPcAttacker(attacker) ? party.filter((m) => m.character._id !== attacker.characterId) : party;
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
export async function attackerCombatant(ctx: QueryCtx, row: HitRow, members: readonly PartyMember[]): Promise<{ instance: Doc<"encounterAdversaries"> | null; combatant: Combatant } | null> {
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
    // A feature answer (stored responses widened by sheet-drawer SD0); nothing writes one until SD4 folds them in.
    if (answer.choice.kind === "feature") continue;
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

export function cardRefusal(r: RunRefusal) {
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
export function sheetAfterCard(sheet: CharacterSheet, plan: RunPlan, who: string, cardName: string): CharacterSheet {
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
export function runAfterHitCard(member: PartyMember, sheet: CharacterSheet, cardId: string, useId: string | undefined, trigger: { amount: number; source?: Combatant }, seed: string): { plan: RunPlan; cardName: string } | RunRefusal {
  const card = cardEffect(cardId);
  if (!card) return { ok: false, reason: "noUse", detail: cardId };
  const actor = cardActor(member.character._id, sheet, cardId, undefined);
  const reactionUse = useId ?? card.uses.find((u) => u.activation.kind === "reaction")?.id;
  const result = runCardUse(card, { actor, gmFear: 0, ...(reactionUse ? { useId: reactionUse } : {}), trigger: { amount: trigger.amount, subject: pcCombatant(member.character._id, sheet), ...(trigger.source ? { source: trigger.source } : {}) }, rng: seededRng(seed) });
  if (!result.ok) return result;
  return { plan: result.plan, cardName: getDomainCard(cardId)?.name ?? cardId };
}