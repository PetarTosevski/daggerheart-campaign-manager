import type { Cost } from "@/lib/domain/card-effects/types";
import { shortfallSentence } from "@/lib/domain/combat-actions/shortfall";
import { beforeText, refusalForCode } from "@/lib/errors/refusals";

import type { HudSheetFeature } from "../sheet/model";
import { mapUses } from "../sheet/model";

/**
 * The action ring's pure parts (plan combat-hud H3.4; board Main 'Picking a target' / 'Can't afford', `.rad`): which
 * buttons it shows (answer 3b: Attack, Cast, Sheet and every feature with a Use button), why one is locked ("Evolution
 * needs 3 Hope. You have 1."), and where each sits around your token without covering its arcs.
 *
 * Geometry (board: Moss's token 48 px at (360, 456), buttons 44 px at radius 96, 38° apart, from the left over the top):
 * all in stage pixels around the token's centre; angles in degrees, 0 = right, 90 = up (screen y grows down).
 */

// ---------------------------------------------------------------- items

export type RingKind = "attack" | "cast" | "sheet" | "feature" | "more";

export type RingItem = {
  /** Stable key: "attack", "cast", "sheet", "feature:<featureId>:<useId>", "more". */
  id: string;
  kind: RingKind;
  /** The visible label under the button ("Attack", "Evolution"). */
  label: string;
  /** The accessible name ("Attack", "Use Evolution"); it always contains the label (WCAG 2.5.3). */
  name: string;
  /** Why it can't be used now; null when it can. A locked button stays focusable and shows this (aria-disabled). */
  locked: string | null;
  /** Its picker is open (Attack's session, a card being cast, the sheet showing). */
  on: boolean;
  featureId?: string;
  useId?: string;
};

/** One action use of a feature the ring offers: a Use button on the sheet panel (not a reaction's React). */
export type RingUse = { featureId: string; useId: string; label: string; ready: boolean; resetLabel: string | null };

/**
 * The feature uses the ring shows: exactly the sheet panel's Use buttons (`mapUses`), action uses only. Reactions keep
 * their React on the sheet and their prompts (they answer something; nothing to start from your token). A feature with
 * several uses gets one button per use, named by the use.
 */
export function ringUses(features: readonly HudSheetFeature[]): RingUse[] {
  const out: RingUse[] = [];
  for (const f of features) {
    const uses = mapUses(f).filter((u) => u.activation === "action");
    for (const u of uses) {
      out.push({ featureId: f.featureId, useId: u.useId, label: uses.length > 1 ? u.name : f.name, ready: u.ready, resetLabel: u.resetLabel ?? f.resetLabel });
    }
  }
  return out;
}

/** The fixed Hope a use's costs need (a choice of costs or a chosen amount is the server's to check). */
export function hopeNeeded(costs: readonly Cost[] | undefined): number {
  return (costs ?? []).reduce((n, c) => n + (c.kind === "hope" && c.amount.kind === "fixed" ? c.amount.value : 0), 0);
}

/**
 * Why a feature's button is locked (board 'Can't afford': "Evolution needs 3 Hope. You have 1."), or null, in the
 * refusal table's words (H6.1 / H6.2): used up first ("Evolution is used up for now. Back after a long rest."), then a
 * fixed Hope cost above what you hold (`shortfallSentence`, verb "needs" as the board's ring). Stress, Armor and other
 * costs are left to the server (it refuses with its own reason): Stress past full marks a Hit Point (CB p.106).
 */
export function featureLock(use: Pick<RingUse, "label" | "ready" | "resetLabel">, hopeNeed: number, hope: number | null): string | null {
  if (!use.ready) {
    const used = refusalForCode("FEATURE_EXHAUSTED", { subject: use.label }).lead;
    return use.resetLabel ? `${used} ${use.resetLabel}.` : used;
  }
  if (hope !== null && hopeNeed > hope) {
    const s = shortfallSentence({ resource: "hope", need: hopeNeed, have: hope }, { subject: use.label, verb: "needs" });
    return s.rest ? `${s.lead} ${s.rest}` : s.lead;
  }
  return null;
}

/**
 * The lock of every action button while the GM holds the spotlight (H6.2, answer 1c): "The GM has the spotlight ·
 * reactions only". Null otherwise. Sheet and More never lock (they start nothing).
 */
export function spotlightLock(reactionsOnly: boolean): string | null {
  return reactionsOnly ? beforeText("SPOTLIGHT_WITH_GM") : null;
}

/** Cast's lock: a hand with no card in the loadout; null while it loads (the hand says so itself). */
export function castLock(loadout: number | null): string | null {
  return loadout === 0 ? "No cards in your loadout." : null;
}

/** Attack's lock from the picker's reason ("No weapon equipped", "Loading your weapons…"). */
export function attackLock(ready: boolean, reason: string | null): string | null {
  return ready ? null : (reason ?? "You can’t attack right now.");
}

export type RingInput = {
  attack: { locked: string | null; on: boolean };
  cast: { locked: string | null; on: boolean };
  sheet: { on: boolean };
  features: readonly (RingUse & { locked: string | null; on: boolean })[];
};

/** Every button in ring order: Attack, Cast, Sheet (the board's), then the features as the sheet lists them. */
export function ringItems({ attack, cast, sheet, features }: RingInput): RingItem[] {
  return [
    { id: "attack", kind: "attack", label: "Attack", name: "Attack", locked: attack.locked, on: attack.on },
    { id: "cast", kind: "cast", label: "Cast", name: "Cast", locked: cast.locked, on: cast.on },
    { id: "sheet", kind: "sheet", label: "Sheet", name: "Sheet", locked: null, on: sheet.on },
    ...features.map<RingItem>((f) => ({
      id: `feature:${f.featureId}:${f.useId}`,
      kind: "feature",
      label: f.label,
      name: `Use ${f.label}`,
      locked: f.locked,
      on: f.on,
      featureId: f.featureId,
      useId: f.useId,
    })),
  ];
}

// ---------------------------------------------------------------- geometry

/** The buttons' size (board `.rad`: 44 px, also the touch minimum). */
export const BUTTON = 44;
/** Centre-to-centre distance between neighbours: the button plus room for its label (board: 2·96·sin 19° ≈ 62). */
const CHORD = 62;
/** The arc the buttons may use: from the left (180°) over the top to just below the right (−20°), never under the token. */
export const ARC_FROM = 180;
export const ARC_TO = -20;

/**
 * The token's arcs reach 0.566 of its footprint from its centre (token.css: the svg is 1.12 × the footprint, the path
 * r = 46 of 50 with a 9-unit stroke); the Hope chip sits inside that. The ring keeps every button outside it.
 */
export const ARC_REACH = 0.57;
/** The gap between the arcs and the nearest button's edge. */
const GAP = 8;

/** The ring's radius for a token `size` px across: the board's 96 for a 48 px token, wider for a bigger one. */
export function ringRadius(size: number): number {
  return Math.max(size / 2 + 72, ARC_REACH * size + GAP + BUTTON / 2);
}

/** Degrees between neighbours at this radius (38° at the board's 96). */
export function ringStep(radius: number): number {
  return (2 * Math.asin(Math.min(1, CHORD / 2 / radius)) * 180) / Math.PI;
}

/** How many buttons fit on the arc at this radius (6 at the board's 96). */
export function ringSlots(radius: number): number {
  return Math.floor((ARC_FROM - ARC_TO) / ringStep(radius)) + 1;
}

/**
 * The overflow (decided: a "More" button, not a second ring). When every button fits it shows them all; otherwise the
 * last slot is "More", which opens the rest as a list beside the ring. A second ring would sit twice as far from the
 * token (over its neighbours on a busy map) and its labels would collide with the first ring's.
 */
export function splitRing(items: readonly RingItem[], slots: number): { ring: RingItem[]; more: RingItem[] } {
  if (items.length <= slots) return { ring: [...items], more: [] };
  const keep = Math.max(1, slots - 1);
  return { ring: items.slice(0, keep), more: items.slice(keep) };
}

/** The "More" button for the overflow: locked never; on while its list is open. */
export function moreItem(count: number, open: boolean): RingItem {
  return { id: "more", kind: "more", label: "More", name: `More actions (${count})`, locked: null, on: open };
}

/** Where button `i` sits, relative to the token's centre (stage px). */
export function ringPoint(i: number, radius: number): { x: number; y: number; angle: number } {
  const angle = ARC_FROM - i * ringStep(radius);
  const rad = (angle * Math.PI) / 180;
  return { x: radius * Math.cos(rad), y: -radius * Math.sin(rad), angle };
}

/** Whether a button at `p` (relative to the centre) keeps clear of a `size` px token's arcs. */
export function clearsArcs(p: { x: number; y: number }, size: number): boolean {
  return Math.hypot(p.x, p.y) - BUTTON / 2 >= ARC_REACH * size;
}

/** The next button for an arrow key (Left / Up go back round the ring, Right / Down forward; Home / End the ends). */
export function stepFocus(index: number, count: number, key: string): number | null {
  if (count === 0) return null;
  if (key === "ArrowRight" || key === "ArrowDown") return (index + 1) % count;
  if (key === "ArrowLeft" || key === "ArrowUp") return (index - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}
