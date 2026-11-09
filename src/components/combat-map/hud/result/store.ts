import { useSyncExternalStore } from "react";

import type { CardChoice, ChoiceAsk } from "../../actions/hand/model";
import type { DamageType, ResultView } from "./model";

/**
 * What the result panel shows next (plan combat-hud H4.1), set by whoever sent the use: the HUD hand (a card's result,
 * its after-the-roll asks) and the attack picker (an attack's result). A tiny external store read through
 * `useSyncExternalStore` (like H3.2's `report.ts` and H3.3's square-picking store), because the senders and the panel
 * live in different HUD regions. One entry at a time: a new result replaces the last. Held attacks ("Your roll waits")
 * and damage-phase rider picks are not here: the panel reads them from the server's open requests, so a reload keeps them.
 */

/** A card use waiting for its after-the-roll answers (a damage split, a choice, each ally's pick). */
export type AsksEntry = {
  kind: "asks";
  /** Unique per ask (a new one remounts the panel's local picks). */
  id: string;
  characterId: string;
  title: string;
  cardId: string | null;
  asks: readonly ChoiceAsk[];
  names: ReadonlyMap<string, string>;
  /** Sends the answers; a refusal throws (the panel shows it and stays). */
  answer: (choices: CardChoice[]) => Promise<void>;
  cancel: () => void;
};

export type ResultEntry = { kind: "result"; view: ResultView; done: readonly number[] };

export type HudResultEntry = AsksEntry | ResultEntry;

/** How the attack picker named a held attack (the server's request has the dice, not the weapon). */
export type HeldMeta = { weaponName: string; damageType: DamageType | null; actorName: string };

let entry: HudResultEntry | null = null;
const held = new Map<string, HeldMeta>();
/** The GM's copy of the players' results (`fromFeed`): the ids already seen (null before the first list) and its campaign. */
let feedSeen: Set<string> | null = null;
let feedScope: string | null = null;
const listeners = new Set<() => void>();

const emit = () => {
  for (const fn of listeners) fn();
};

export const hudResults = {
  get: (): HudResultEntry | null => entry,
  /** Shows a result (replacing what was shown). */
  show: (view: ResultView): void => {
    feedSeen?.add(view.id);
    entry = { kind: "result", view, done: [] };
    emit();
  },
  /**
   * dcm-uemx (user 2026-11-09): the players' results the GM's HUD receives (`combatHud.playerResults`, newest first). The
   * first list of a campaign is the baseline (shown before the HUD loaded: never popped up; the server's clock never meets
   * the browser's); afterwards the newest result not seen yet shows (newest wins, one panel at a time) unless the GM is
   * answering an after-the-roll ask. Every id is seen once: a closed result never comes back. UI only: nothing is sent.
   */
  fromFeed: (scope: string, views: readonly ResultView[]): void => {
    if (feedSeen === null || feedScope !== scope) {
      feedScope = scope;
      feedSeen = new Set(views.map((v) => v.id));
      return;
    }
    const seen = feedSeen;
    const fresh = views.filter((v) => !seen.has(v.id));
    for (const v of views) seen.add(v.id);
    const newest = fresh[0];
    if (newest === undefined || entry?.kind === "asks") return;
    entry = { kind: "result", view: newest, done: [] };
    emit();
  },
  /** Asks the after-the-roll answers of a card use. */
  ask: (asks: Omit<AsksEntry, "kind">): void => {
    entry = { kind: "asks", ...asks };
    emit();
  },
  /** A manual step of the shown result is done. */
  markDone: (id: string, index: number): void => {
    if (entry?.kind !== "result" || entry.view.id !== id) return;
    entry = { ...entry, done: [...entry.done, index] };
    emit();
  },
  /** Closes the panel when it still shows `id` (any entry without an id). */
  clear: (id?: string): void => {
    if (entry === null) return;
    if (id !== undefined && (entry.kind === "asks" ? entry.id : entry.view.id) !== id) return;
    entry = null;
    emit();
  },
  noteHeld: (requestId: string, meta: HeldMeta): void => {
    held.set(requestId, meta);
  },
  heldMeta: (requestId: string): HeldMeta | null => held.get(requestId) ?? null,
  /** Tests: back to empty. */
  reset: (): void => {
    entry = null;
    held.clear();
    feedSeen = null;
    feedScope = null;
    emit();
  },
  subscribe: (fn: () => void): (() => void) => {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};

export function useHudResultEntry(): HudResultEntry | null {
  return useSyncExternalStore(hudResults.subscribe, hudResults.get, () => null);
}
