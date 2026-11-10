// Party rests and downtime moves (CB 105-106). Pure module: bundled into Convex.
//
// The GM starts a short or long rest, each PC picks two moves (the same move
// twice is allowed), and the GM finishes it (decision 10). `applyMoves` resolves
// every PC's moves against the party's sheets with the given dice; `restFear`
// is the GM's Fear; `restedSheet` ends what the rest ends (`expire`), runs the
// class hooks and wakes an Unconscious character on a long rest (CB 106).
//
// ```ts
// const { sheets, lines, projects } = applyMoves(kind, sheets, choices, rollDie);
// const rested = restedSheet(sheets[id], kind);
// const fear = restFear(kind, rollDie(4), activePcs);
// ```

import { RuleError } from "../../errors/app-error";
import type { ModeOf } from "../../rules/registry";
import type { CharacterSheet } from "../../validation/characters";
import { applyResourceDelta, hopeMax, tierForLevel, type UnconsciousMode } from "../characters/index";
import { expire } from "../characters/expiry";
import { favorOf, warlockSpellcast } from "../class-features/classes/warlock";
import { onRest } from "../class-features/hooks";
import type { Registry } from "../class-features/index";
import type { Rng } from "../class-features/types";
import { gainMartialPreparationDie } from "../session-features/slayer";
import { raiseLoadout } from "../transformations/index";
import {
  ALLY_MOVES,
  MANUAL_MOVES_MAX,
  MOVE_LABELS,
  MOVES_PER_REST,
  REST_MOVES,
  type ChosenMove,
  type RestChoice,
  type RestKind,
  type RestMove,
  type TwoDowntimeMovesMode,
} from "./moves";

export * from "./moves";

/**
 * Checks one PC's picks: exactly two moves this rest allows (plus any `extra`
 * frame or class moves, minus the frame's `forbidden` ones), a target only on
 * an ally move and never yourself, a countdown only on Work on a Project.
 * T1 Manual: from 0 to `MANUAL_MOVES_MAX` moves. Throws `RuleError("REST_RULE")`.
 */
export function validateChoice(
  kind: RestKind,
  characterId: string,
  moves: readonly ChosenMove[],
  extra: readonly RestMove[] = [],
  forbidden: readonly RestMove[] = [],
  mode: TwoDowntimeMovesMode = "book",
): void {
  const fail = (message: string): never => {
    throw new RuleError("REST_RULE", message);
  };
  if (mode === "manual" ? moves.length > MANUAL_MOVES_MAX : moves.length !== MOVES_PER_REST) {
    fail(mode === "manual" ? `Choose at most ${MANUAL_MOVES_MAX} downtime moves.` : `Choose ${MOVES_PER_REST} downtime moves.`);
  }
  for (const m of moves) {
    if (forbidden.includes(m.move)) fail(`${MOVE_LABELS[m.move]} can't be chosen in this campaign.`);
    if (!REST_MOVES[kind].includes(m.move) && !extra.includes(m.move)) fail(`${MOVE_LABELS[m.move]} isn't a ${kind} rest move.`);
    if (m.targetId !== undefined && !ALLY_MOVES.includes(m.move)) fail(`${MOVE_LABELS[m.move]} can't target an ally.`);
    if (m.targetId === characterId) fail("Leave the target empty to use a move on yourself.");
    if (m.countdownId !== undefined && m.move !== "workOnProject") fail("Only Work on a Project takes a countdown.");
  }
}

/** T1 Manual: the GM's note when a PC's picks are not the book's count ("Mira picked 3 moves"). */
export function moveCountNote(name: string, count: number): string {
  return `${name} picked ${count} ${count === 1 ? "move" : "moves"}`;
}

/** T3 What each move does (rule switch, plan rule-switches WD). */
export type DowntimeMoveEffectsMode = ModeOf<"downtimeMoveEffects">;

/** The core downtime moves of CB p.105 (either rest): what T3 Manual leaves to the table. */
export function isCoreMove(move: RestMove): boolean {
  return REST_MOVES.short.includes(move) || REST_MOVES.long.includes(move);
}

/**
 * T3 Manual (Q10 a): the picks split in two. `applied` keeps each choice's moves that are not core moves (the class,
 * heritage and frame moves: Tribute, Martial Preparation, Raise loadout, Make a Feast…, which their own rules run);
 * `byHand` keeps every choice's core moves, which the app neither rolls nor applies. Book: everything is applied.
 */
export function splitManualMoves(
  choices: readonly RestChoice[],
  mode: DowntimeMoveEffectsMode = "book",
): { applied: RestChoice[]; byHand: RestChoice[] } {
  if (mode !== "manual") return { applied: [...choices], byHand: [] };
  return {
    applied: choices.map((c) => ({ characterId: c.characterId, moves: c.moves.filter((m) => !isCoreMove(m.move)) })),
    byHand: choices.flatMap((c) => {
      const moves = c.moves.filter((m) => isCoreMove(m.move));
      return moves.length > 0 ? [{ characterId: c.characterId, moves }] : [];
    }),
  };
}

/** One PC's picks in words: "Tend to Wounds on Theo, Prepare" (`nameOf` names an ally target). */
export function picksText(moves: readonly ChosenMove[], nameOf: (id: string) => string): string {
  return moves.map((m) => `${MOVE_LABELS[m.move]}${m.targetId !== undefined ? ` on ${nameOf(m.targetId)}` : ""}`).join(", ");
}

/** "On a short rest, they gain 1d4 Fear. On a long rest, … 1d4 + the number of PCs" (CB 105). Away PCs are not counted (HF 127). */
export function restFear(kind: RestKind, d4: number, activePcs: number): number {
  return kind === "short" ? d4 : d4 + activePcs;
}

/** F2 Fear from rests (rule switch, plan rule-switches RR). */
export type FearFromRestsMode = ModeOf<"fearFromRests">;
/** T4 Interrupted rest (rule switch, plan rule-switches RR). */
export type InterruptedRestMode = ModeOf<"interruptedRest">;

/**
 * Whether the GM may start this rest as Extended downtime (Q7 a, user 2026-11-05): only a long rest, and only while F2
 * is set to Extended downtime. It is a choice for one rest, not every long rest.
 */
export function canStartExtended(mode: FearFromRestsMode, kind: RestKind): boolean {
  return mode === "extendedDowntime" && kind === "long";
}

/**
 * How a rest that runs as `kind` (an interrupted long rest runs as a short one) gains Fear: `manual` (F2 Manual: the
 * app adds none and the GM gets `restFearPrompt`), `extended` (a long rest the GM started as Extended downtime, CB 181:
 * 1d6 per PC) or `book` (`restFear`, CB 105). An extended rest that is interrupted runs as a short rest: book Fear.
 */
export function restFearRule(kind: RestKind, extended = false, mode: FearFromRestsMode = "book"): "book" | "extended" | "manual" {
  if (mode === "manual") return "manual";
  return extended && kind === "long" && mode === "extendedDowntime" ? "extended" : "book";
}

/**
 * Journey to Horizon's Doom Track, Tier 1 (HF p.177, "Dark Harbingers"): "After you mark 5 boxes in this tier, when you
 * gain Fear at the end of a long rest, you roll twice and take the higher result." Applied to the d4 of the book's
 * long-rest Fear (`restFear`): the kept roll of the two.
 */
export function higherOfTwo(first: number, second: number): number {
  return Math.max(first, second);
}

/** "If you're fast-forwarding the story across multiple days (or longer) … You gain 1d6 Fear per PC" (CB 181): one d6 per active PC, summed. */
export function extendedDowntimeFear(d6s: readonly number[]): number {
  return d6s.reduce((sum, d) => sum + d, 0);
}

/** F2 Manual: the book's Fear, said rather than applied ("Gain 1d4 Fear", "Gain 1d4 + 4 Fear"; CB 105). */
export function restFearPrompt(kind: RestKind, activePcs: number): string {
  return kind === "short" ? "Gain 1d4 Fear" : `Gain 1d4 + ${activePcs} Fear`;
}

/** T4 Manual: the GM's note when the Interrupt closes a rest and applies nothing. */
export const INTERRUPTED_REST_NOTE = "Rest interrupted: decide what anyone keeps";

const SHORT_EQUIVALENT: Partial<Record<RestMove, RestMove>> = {
  tendToWounds: "tendToWounds",
  clearStress: "clearStress",
  repairArmor: "repairArmor",
  prepare: "prepare",
  prepareTogether: "prepareTogether",
  tendToAllWounds: "tendToWounds",
  clearAllStress: "clearStress",
  repairAllArmor: "repairArmor",
  tribute: "tribute",
  martialPreparation: "martialPreparation",
  // HF 153: "During a rest" (either rest), so an interrupted long rest keeps it as Tribute does.
  raiseLoadout: "raiseLoadout",
};

/** A long rest move with no short rest equal: Tend to All Wounds, Clear All Stress, Repair All Armor, Work on a Project. */
const longOnly = (m: RestMove) => REST_MOVES.long.includes(m) && !REST_MOVES.short.includes(m);

/**
 * The moves an interrupted rest still gives (CB 105): an interrupted short
 * rest gives nothing; an interrupted long rest gives "the benefits of a short
 * rest", so each long-rest move becomes its short-rest counterpart and Work on
 * a Project (long rest only) is lost. Tribute (a downtime move on either
 * rest, HF 14) and Martial Preparation (either rest, CB 48) stay; the frame moves are dropped (their hooks read the
 * picks themselves).
 *
 * `efficient` (Clank, CB 53: "When you take a short rest, you can choose a long rest move instead of a short rest
 * move"; user 2026-10-30, dcm-bxp.99.19.58): an interrupted long rest is a short rest, so the holder keeps ONE pick at
 * full long-rest strength, the first long-rest-only move in pick order (Tend to All Wounds still clears all HP, Work on
 * a Project still ticks); the other picks convert as everyone's.
 */
export function interruptedMoves(kind: RestKind, moves: readonly ChosenMove[], efficient = false, mode: InterruptedRestMode = "book"): ChosenMove[] {
  // T4 Manual: the Interrupt only closes the rest; the GM decides what anyone keeps.
  if (kind === "short" || mode === "manual") return [];
  const kept = efficient ? moves.findIndex((m) => longOnly(m.move)) : -1;
  return moves.flatMap((m, i) => {
    if (i === kept) return [{ ...m }];
    const move = SHORT_EQUIVALENT[m.move];
    return move === undefined ? [] : [{ move, ...(m.targetId !== undefined ? { targetId: m.targetId } : {}) }];
  });
}

/** A project tick to apply (Work on a Project with a countdown), or a roll the GM asks for (no countdown). */
export type ProjectWork = { characterId: string; countdownId?: string };

export type MovesResult = {
  sheets: Record<string, CharacterSheet>;
  /** Feed lines per character id (the mover's moves, and moves allies used on them). */
  lines: Record<string, string[]>;
  projects: ProjectWork[];
};

/**
 * Resolves every PC's moves, in choice order, on a copy of `sheets` (keyed by
 * character id). Dice come from `rng` (1d4 per short-rest move, + the mover's
 * tier, CB 105). A move on a character missing from `sheets` (not resting) is
 * skipped. Prepare together gives 2 Hope to everyone who chose it when two or
 * more PCs did, otherwise 1 Hope like Prepare. Tribute gains Favor equal to
 * the Warlock's Spellcast trait, at least 0 (HF 14). Martial Preparation
 * gives the mover a d6 Slayer Die, up to their Proficiency (CB 48,
 * `gainMartialPreparationDie`). Make a Feast, Keep Watch
 * and halting lycanthropy are applied by the frame hooks, not here.
 */
export function applyMoves(kind: RestKind, input: Readonly<Record<string, CharacterSheet>>, choices: readonly RestChoice[], rng: Rng): MovesResult {
  const sheets: Record<string, CharacterSheet> = { ...input };
  const lines: Record<string, string[]> = {};
  const projects: ProjectWork[] = [];
  const say = (id: string, line: string) => (lines[id] ??= []).push(line);
  const nameOf = (id: string) => sheets[id]?.name ?? "an ally";
  const together = new Set(choices.filter((c) => sheets[c.characterId] && c.moves.some((m) => m.move === "prepareTogether")).map((c) => c.characterId));

  for (const choice of choices) {
    const mover = sheets[choice.characterId];
    if (mover === undefined) continue;
    const tier = tierForLevel(mover.level);
    for (const m of choice.moves) {
      const targetId = m.targetId ?? choice.characterId;
      const target = sheets[targetId];
      if (target === undefined) continue;
      const onAlly = targetId !== choice.characterId ? ` on ${target.name}` : "";
      const roll = () => {
        const d4 = rng(4);
        return { amount: d4 + tier, text: `1d4 ${d4} + tier ${tier}` };
      };
      switch (m.move) {
        case "tendToWounds": {
          const r = roll();
          sheets[targetId] = applyResourceDelta(target, "hp", -r.amount);
          say(choice.characterId, `Tend to Wounds${onAlly}: clears ${r.amount} HP (${r.text})`);
          break;
        }
        case "clearStress": {
          const r = roll();
          sheets[targetId] = applyResourceDelta(target, "stress", -r.amount);
          say(choice.characterId, `Clear Stress: clears ${r.amount} Stress (${r.text})`);
          break;
        }
        case "repairArmor": {
          const r = roll();
          sheets[targetId] = { ...target, armorMarked: Math.max(0, target.armorMarked - r.amount) };
          say(choice.characterId, `Repair Armor${onAlly}: clears ${r.amount} Armor Slots (${r.text})`);
          break;
        }
        case "tendToAllWounds":
          sheets[targetId] = applyResourceDelta(target, "hp", -target.hp);
          say(choice.characterId, `Tend to All Wounds${onAlly}: clears all HP`);
          break;
        case "clearAllStress":
          sheets[targetId] = { ...target, stress: 0 };
          say(choice.characterId, "Clear All Stress: clears all Stress");
          break;
        case "repairAllArmor":
          sheets[targetId] = { ...target, armorMarked: 0 };
          say(choice.characterId, `Repair All Armor${onAlly}: clears all Armor Slots`);
          break;
        case "prepare":
        case "prepareTogether": {
          const gain = m.move === "prepareTogether" && together.size >= 2 ? 2 : 1;
          sheets[targetId] = { ...target, hope: Math.min(hopeMax(target.scars, target.hopeSlotBonus), target.hope + gain) };
          const others = [...together].filter((id) => id !== choice.characterId).map(nameOf);
          const label = m.move === "prepareTogether" && others.length > 0 ? `Prepare with ${others.join(", ")}` : "Prepare";
          say(choice.characterId, `${label}: +${gain} Hope`);
          break;
        }
        case "workOnProject":
          projects.push({ characterId: choice.characterId, ...(m.countdownId !== undefined ? { countdownId: m.countdownId } : {}) });
          say(choice.characterId, m.countdownId !== undefined ? "Work on a Project: ticks the project" : "Work on a Project: the GM asks for an action roll");
          break;
        case "tribute": {
          const self = sheets[choice.characterId]!;
          const favor = favorOf(self);
          const next = Math.min(99, favor + warlockSpellcast(self));
          sheets[choice.characterId] = { ...self, classState: { ...self.classState, favor: next } };
          say(choice.characterId, `Tribute: +${next - favor} Favor (${favor} to ${next})`);
          break;
        }
        case "martialPreparation": {
          const gain = gainMartialPreparationDie(sheets[choice.characterId]!);
          sheets[choice.characterId] = gain.sheet;
          say(
            choice.characterId,
            gain.gained
              ? `Martial Preparation: +1 Slayer Die (${gain.held}/${gain.capacity})`
              : `Martial Preparation: Slayer Dice full (${gain.held}/${gain.capacity})`,
          );
          break;
        }
        case "raiseLoadout": {
          // HF 153 (bead dcm-psg9): the maximum loadout goes up by one, to at most five.
          const raised = raiseLoadout(sheets[choice.characterId]!);
          sheets[choice.characterId] = raised.sheet;
          say(choice.characterId, raised.to > raised.from ? `Raise loadout: maximum loadout ${raised.from} to ${raised.to}` : `Raise loadout: already at ${raised.to}`);
          break;
        }
        case "makeAFeast":
        case "keepWatch":
        case "haltLycanthropy":
        // Journey to Horizon (HF 176): no sheet change; the rest hook prompts the GM for the bearing (dcm-dvia).
        case "locateSoulEchoes":
          break;
      }
      if (onAlly) say(targetId, `${mover.name} used ${MOVE_LABELS[m.move]} on them`);
    }
  }
  return { sheets, lines, projects };
}

/**
 * The end of a rest for one PC: `expire` (rest effects and uses; long-rest
 * ones too on a long rest), the class hooks' `onRest`, and on a long rest an
 * Unconscious character wakes (CB 106). C4 Manual (`unconscious`): nobody
 * wakes; the caller asks the GM (`longRestWakeNote`).
 */
export function restedSheet(sheet: CharacterSheet, kind: RestKind, registry?: Registry, unconscious: UnconsciousMode = "book"): CharacterSheet {
  const expired = expire(sheet, kind === "long" ? "longRest" : "shortRest");
  const hooked = registry === undefined ? onRest(expired, kind) : onRest(expired, kind, registry);
  return kind === "long" && unconscious === "book" ? { ...hooked, conditions: hooked.conditions.filter((c) => c !== "unconscious") } : hooked;
}
