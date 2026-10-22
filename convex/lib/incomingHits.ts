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
 */
import { applyDamageTo, rangeCheck, type Combatant } from "../../src/lib/domain/combat-actions/index";
import type { PlanStep, RunPlan, RunRefusal } from "../../src/lib/domain/card-effects/run";
import type { Range } from "../../src/lib/domain/card-effects/types";
import { derivedThresholds } from "../../src/lib/domain/characters/derived";
import { hopeMax } from "../../src/lib/domain/characters/index";
import {
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
import type { HitResponder, IncomingHitPayload } from "./validators/combatRequests";

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
};

function windowHitOf(attacker: HitAttacker, hit: Pick<HitDraft, "amount" | "type" | "direct" | "forcedArmor" | "critical" | "attackTotal">): WindowHit {
  return {
    amount: hit.amount,
    type: hit.type,
    direct: hit.direct,
    ...(hit.forcedArmor > 0 ? { forcedArmor: hit.forcedArmor } : {}),
    attackerId: attacker.instanceId,
    critical: hit.critical,
    ...(hit.attackTotal !== undefined ? { attackTotal: hit.attackTotal } : {}),
  };
}

/**
 * Opens one hit's reaction window (Q13): the responders are the target (when they can mark an Armor Slot or hold an
 * eligible card) and every ally with an eligible reaction card (at most MAX_RESPONDERS). A window nobody has to answer
 * resolves in the same mutation. Returns the row and, when it resolved, the resolution.
 *
 * Card damage to another PC (user answer 2026-10-22) opens the same row. AA0's payload names an adversary instance as
 * the attacker; a PC attacker needs a widened `attacker` (see the task doc's QUESTIONS).
 */
export async function openIncomingHit(ctx: MutationCtx, input: OpenHitInput): Promise<{ requestId: Id<"combatRequests">; resolution: HitResolution | null }> {
  const party = windowParty(input.party, input.targetCharacterId, input.bands);
  const state = openWindow({ hit: windowHitOf(input.attacker, input.hit), targetId: input.targetCharacterId, party });
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

/** The attacking instance as a creature (the card runner's trigger `source`); null when it is gone. */
async function attackerCombatant(ctx: QueryCtx, row: HitRow): Promise<{ instance: Doc<"encounterAdversaries">; combatant: Combatant } | null> {
  const instance = await ctx.db.get("encounterAdversaries", row.payload.attacker.instanceId);
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
  const members = await partyMembers(ctx, row.campaignId);
  const bands = await bandsOnMap(ctx, row.mapId);
  const party = windowParty(members, p.targetCharacterId, bands);
  const attacker = await attackerCombatant(ctx, row);
  const hit = windowHitOf(p.attacker, { amount: p.damage, type: p.damageType, direct: p.direct, forcedArmor: p.forcedArmor ?? 0, critical: p.critical, ...(attackTotal !== undefined ? { attackTotal } : {}) });
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
};

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

  if (target && result) {
    const sheet = target.sheet;
    const next: CharacterSheet = { ...sheet, hp: result.after.hp, stress: result.after.stress, armorMarked: result.after.armor, hope: Math.max(0, result.after.hope) };
    await saveSheet(ctx, target.character._id, next);
    await logAction(ctx, {
      campaignId: row.campaignId,
      characterId: target.character._id,
      actorId: row.createdBy,
      kind: "adversary",
      visibility: "public",
      summary: res.negated ? `${targetName} avoided ${p.attacker.label}'s hit` : `${targetName} took ${p.attacker.label}'s hit${result.deathMove ? " and must make a death move" : ""}`,
      groupId: p.groupId,
      before: sheet,
      undoable: true,
    });
    const armor = result.armorSlots > 0 ? `, ${result.armorSlots} Armor Slot${result.armorSlots === 1 ? "" : "s"}` : "";
    const forced = result.forcedArmor > 0 ? `, ${result.forcedArmor} forced` : "";
    const resisted = result.resisted !== "none" ? ` (${result.resisted}: ${result.taken})` : "";
    const marks = [result.hpMarked > 0 ? `${result.hpMarked} HP (${result.after.hp}/${sheet.hpMax})` : "no HP", ...(result.stressMarked > 0 ? [`${result.stressMarked} Stress`] : []), ...(result.hopeSpent > 0 ? [`${result.hopeSpent} Hope`] : [])];
    gm.push(
      `${targetName}: ${result.incoming} ${TYPE_WORD[p.damageType]}${resisted} → ${SEVERITY_WORD[result.severityBefore]}${armor}${forced} → ${SEVERITY_WORD[result.severity]} → ${marks.join(", ")}${result.deathMove ? "; death move" : ""}`,
    );
  } else if (target) {
    gm.push(`${targetName}: ${res.missed ? "the hit became a miss" : "no damage"}`);
    await logAction(ctx, { campaignId: row.campaignId, actorId: row.createdBy, kind: "adversary", visibility: "public", summary: `${targetName} avoided ${p.attacker.label}'s hit`, groupId: p.groupId, undoable: true });
  }
  if (res.targetId !== res.originalTargetId) gm.push(`(redirected from ${rebuilt.members.find((m) => m.character._id === res.originalTargetId)?.sheet.name ?? "the first target"})`);
  if (input.early) gm.push("(resolved by the GM)");

  // Damage a card sends back (Arcane Reflection): the attacker takes it against its thresholds (CB p.91, p.99).
  const adversaryBefore: AdversaryBefore[] = [];
  const reflectedToAttacker = res.reflected.filter((r) => r.to === "attacker").reduce((n, r) => n + r.amount, 0);
  if (reflectedToAttacker > 0 && rebuilt.attacker) {
    const { instance, combatant } = rebuilt.attacker;
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
    kind: "adversary",
    visibility: "gm",
    summary: `${p.attacker.label} → ${gm.join("; ")}`,
    groupId: p.groupId,
    ...(adversaryBefore.length > 0 ? { adversaryBefore } : {}),
    undoable: true,
  });
  await closeRequest(ctx, row._id, "resolved", input.by);
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
    deathMove: result?.deathMove ?? false,
    taken: result?.taken ?? 0,
    manual: res.manual,
    window: res,
  };
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
};

/** What one character sees of an open hit: the target their own numbers (Q14), an ally only who was hit and their cards. */
export async function hitView(ctx: QueryCtx, row: HitRow, characterId: Id<"characters">): Promise<HitView | null> {
  const { state, party, members } = await rebuildWindow(ctx, row);
  const responder = state.responders.find((r) => r.characterId === characterId);
  const isTarget = state.targetId === characterId;
  if (!responder && !isTarget && row.payload.targetCharacterId !== characterId) return null;
  const awaiting = awaitingOf(state).includes(characterId);
  const target = members.find((m) => m.character._id === state.targetId);
  const view: HitView = {
    requestId: row._id,
    attackerLabel: row.payload.attacker.label,
    targetCharacterId: memberId(members, state.targetId, row.payload.targetCharacterId),
    targetName: target?.sheet.name ?? "Unknown",
    role: isTarget ? "target" : "ally",
    awaiting,
    cardIds: responder?.cardIds ?? [],
    createdAt: row.createdAt,
  };
  const defense = party.find((p) => p.id === characterId);
  if (isTarget && defense) {
    const prompt = targetPrompt(state, defense);
    const extra = prompt.maxSlots > 1 ? ("any" as const) : 0;
    return { ...view, damage: prompt.damage, severity: prompt.severity, direct: row.payload.direct, maxSlots: prompt.maxSlots, armorPreview: armorPreview(defense, state.hit, extra).slice(0, prompt.maxSlots + 1) };
  }
  return view;
}
