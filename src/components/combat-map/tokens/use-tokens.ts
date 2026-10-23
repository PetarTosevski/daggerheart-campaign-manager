"use client";

import { useMutation, useQuery } from "convex/react";
import type { OptimisticLocalStore } from "convex/browser";
import { ConvexError } from "convex/values";
import { useState } from "react";

import { errorMessage } from "@/lib/convex-errors";
import { applyResourceDelta } from "@/lib/domain/characters";
import { applyCondition, applyMark } from "@/lib/domain/encounters/damage";
import type { Condition } from "@/lib/validation/characters";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { TokenView } from "../../../../convex/combatTokens";
import type { CombatMapSummary, CombatRole } from "../slots";
import { moveToken, snapTurn } from "./geometry";
import { noteBlocked, noteMove } from "./move-notes";

/** Whether a Convex function refused a move because something blocks the way (map-movement M0, D3). */
function isMoveBlocked(error: unknown): boolean {
  if (!(error instanceof ConvexError)) return false;
  const data: unknown = error.data;
  return typeof data === "object" && data !== null && (data as { code?: unknown }).code === "MOVE_BLOCKED";
}

export type { TokenView };
export type TrackerCondition = "hidden" | "restrained" | "vulnerable" | "distracted";

/**
 * The tokens on screen: the GM's `combatTokens.list` (every token with stats) or, for a player, the PC tokens of
 * C7's `combatVision.playerView` (`pcs`, with public sheet numbers, Q4): the same subscription the vision layer
 * reads, so a player holds one query for the map's tokens (dcm-bxp.53). Only while that view has none (the player
 * has no character on the map, `noCharacter`, or the view is of another map) does a player read
 * `combatTokens.party`. `undefined` while loading.
 */
export function useTokens(campaignId: Id<"campaigns">, role: CombatRole, mapId: Id<"combatMaps">): TokenView[] | undefined {
  const player = role === "player";
  const gm = useQuery(api.combatTokens.list, player ? "skip" : { campaignId, mapId });
  const view = useQuery(api.combatVision.playerView, player ? { campaignId } : "skip");
  const fromView = view?.state === "ok" && view.mapId === mapId ? view.pcs : null;
  const party = useQuery(api.combatTokens.party, player && view !== undefined && fromView === null ? { campaignId, mapId } : "skip");
  if (!player) return gm;
  if (view === undefined) return undefined;
  return fromView ?? party;
}

/**
 * Applies `change` to every loaded token list that holds a matching token (CL4): the GM's list, the party list and
 * the PC tokens of the character views (`playerView`, the GM's `previewAs`).
 */
export function patchTokens(store: OptimisticLocalStore, match: (t: TokenView) => boolean, change: (t: TokenView) => TokenView) {
  for (const query of [api.combatTokens.list, api.combatTokens.party]) {
    for (const { args, value } of store.getAllQueries(query)) {
      if (value === undefined || !value.some(match)) continue;
      store.setQuery(query, args, value.map((t) => (match(t) ? change(t) : t)));
    }
  }
  for (const query of [api.combatVision.playerView, api.combatVision.previewAs]) {
    for (const { args, value } of store.getAllQueries(query)) {
      if (value?.state !== "ok" || !value.pcs.some(match)) continue;
      store.setQuery(query, args, { ...value, pcs: value.pcs.map((t) => (match(t) ? change(t) : t)) });
    }
  }
}

function withStats(t: TokenView, change: (s: NonNullable<TokenView["stats"]>) => NonNullable<TokenView["stats"]>): TokenView {
  return t.stats === null ? t : { ...t, stats: change(t.stats) };
}

const idempotencyKey = () => crypto.randomUUID();

/**
 * Every token write the map and the token panel make, with optimistic updates on the token lists: move and turn
 * (the same geometry as the server, R5), HP and Stress pips through the existing character and encounter-tracker
 * mutations (one source of truth, R4), and a custom token's own numbers. A failure is kept in `error`.
 */
export function useTokenActions(campaignId: Id<"campaigns">, map: CombatMapSummary) {
  const [error, setError] = useState<string | null>(null);

  const move = useMutation(api.combatTokens.move).withOptimisticUpdate((store, { tokenId, x, y }) =>
    patchTokens(store, (t) => t._id === tokenId, (t) => ({ ...t, ...moveToken(t, x, y, map) })),
  );
  const turn = useMutation(api.combatTokens.turn).withOptimisticUpdate((store, { tokenId, angle }) =>
    patchTokens(store, (t) => t._id === tokenId, (t) => ({ ...t, face: snapTurn(angle) })),
  );
  const adjustResource = useMutation(api.characters.adjustResource).withOptimisticUpdate((store, { characterId, resource, delta }) =>
    patchTokens(
      store,
      (t) => t.characterId === characterId,
      (t) =>
        withStats(t, (s) => {
          if (resource !== "hp" && resource !== "stress") return s;
          const next = applyResourceDelta({ hp: s.hp, hpMax: s.hpMax, stress: s.stress, stressMax: s.stressMax, hope: 0, scars: 0 }, resource, delta);
          return { ...s, hp: next.hp, stress: next.stress, down: s.hpMax > 0 && next.hp >= s.hpMax };
        }),
    ),
  );
  const togglePcCondition = useMutation(api.characters.toggleCondition).withOptimisticUpdate((store, { characterId, condition }) =>
    patchTokens(store, (t) => t.characterId === characterId, (t) => withStats(t, (s) => applyCondition<string, typeof s>(s, condition))),
  );
  const markTrack = (track: "hp" | "stress") =>
    (store: OptimisticLocalStore, { instanceId, delta }: { instanceId: string; delta: number }) =>
      patchTokens(
        store,
        (t) => t.instanceId === instanceId,
        (t) =>
          withStats(t, (s) => {
            const next = applyMark({ hp: s.hp, stress: s.stress, defeated: s.down, stats: { hpMax: s.hpMax, stressMax: s.stressMax } }, track, delta);
            return { ...s, hp: next.hp, stress: next.stress, down: next.defeated };
          }),
      );
  const markHp = useMutation(api.encounterTracking.markHp).withOptimisticUpdate(markTrack("hp"));
  const markStress = useMutation(api.encounterTracking.markStress).withOptimisticUpdate(markTrack("stress"));
  const toggleCondition = useMutation(api.encounterTracking.toggleCondition).withOptimisticUpdate((store, { instanceId, condition }) =>
    patchTokens(store, (t) => t.instanceId === instanceId, (t) => withStats(t, (s) => applyCondition<string, typeof s>(s, condition))),
  );
  const markCustom = useMutation(api.combatTokens.markCustom).withOptimisticUpdate((store, { tokenId, track, delta }) =>
    patchTokens(
      store,
      (t) => t._id === tokenId,
      (t) =>
        withStats(t, (s) => {
          const hp = track === "hp" ? Math.max(0, Math.min(s.hpMax, s.hp + delta)) : s.hp;
          const stress = track === "stress" ? Math.max(0, Math.min(s.stressMax, s.stress + delta)) : s.stress;
          return { ...s, hp, stress, down: s.hpMax > 0 && hp >= s.hpMax };
        }),
    ),
  );
  const toggleCustomCondition = useMutation(api.combatTokens.toggleCustomCondition).withOptimisticUpdate((store, { tokenId, condition }) =>
    patchTokens(store, (t) => t._id === tokenId, (t) => withStats(t, (s) => applyCondition<string, typeof s>(s, condition))),
  );
  const setSide = useMutation(api.combatTokens.setSide).withOptimisticUpdate((store, { tokenId, side }) =>
    patchTokens(store, (t) => t._id === tokenId, (t) => ({ ...t, side })),
  );
  const setSize = useMutation(api.combatTokens.setSize).withOptimisticUpdate((store, { tokenId, size }) =>
    patchTokens(
      store,
      (t) => t._id === tokenId,
      (t) => ({ ...t, size, x: Math.max(0, Math.min(t.x, map.w - size)), y: Math.max(0, Math.min(t.y, map.h - size)) }),
    ),
  );
  const remove = useMutation(api.combatTokens.remove).withOptimisticUpdate((store, { tokenId }) => {
    for (const { args, value } of store.getAllQueries(api.combatTokens.list)) {
      if (value?.some((t) => t._id === tokenId)) store.setQuery(api.combatTokens.list, args, value.filter((t) => t._id !== tokenId));
    }
  });
  const rename = useMutation(api.combatTokens.rename);

  async function run(call: () => Promise<unknown>) {
    setError(null);
    try {
      await call();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return {
    error,
    clearError: () => setError(null),
    /**
     * Moves a token (optimistic). A player's move through a wall is refused (MOVE_BLOCKED): Convex rolls the
     * optimistic move back and the layer announces "Blocked" instead of an error card. The result's `blocked` (the
     * GM's warning) and `difficult` (the card's note) go to `move-notes.ts` (map-movement M1).
     */
    move: async (tokenId: Id<"combatTokens">, x: number, y: number) => {
      setError(null);
      try {
        const result = await move({ campaignId, tokenId, x, y });
        noteMove(tokenId, result, result);
      } catch (e) {
        if (isMoveBlocked(e)) noteBlocked(tokenId);
        else setError(errorMessage(e));
      }
    },
    turn: (tokenId: Id<"combatTokens">, angle: number) => run(() => turn({ campaignId, tokenId, angle })),
    /** HP or Stress by a delta on the token's own source: the sheet (PC), the tracker (adversary) or the token (custom). */
    mark: (token: TokenView, track: "hp" | "stress", delta: number) => {
      if (delta === 0) return Promise.resolve();
      if (token.kind === "pc" && token.characterId) return run(() => adjustResource({ characterId: token.characterId!, resource: track, delta }));
      if (token.kind === "adversary" && token.instanceId) {
        const args = { campaignId, instanceId: token.instanceId, delta, idempotencyKey: idempotencyKey() };
        return run(() => (track === "hp" ? markHp(args) : markStress(args)));
      }
      return run(() => markCustom({ campaignId, tokenId: token._id, track, delta, idempotencyKey: idempotencyKey() }));
    },
    toggleCondition: (token: TokenView, condition: TrackerCondition) => {
      if (token.kind === "adversary" && token.instanceId) {
        const instanceId = token.instanceId;
        return run(() => toggleCondition({ campaignId, instanceId, condition, idempotencyKey: idempotencyKey() }));
      }
      return run(() => toggleCustomCondition({ campaignId, tokenId: token._id, condition, idempotencyKey: idempotencyKey() }));
    },
    /** A PC's condition, on the character sheet (owner or GM). */
    togglePcCondition: (token: TokenView, condition: Condition) => {
      if (token.kind !== "pc" || !token.characterId) return Promise.resolve();
      const characterId = token.characterId;
      return run(() => togglePcCondition({ characterId, condition }));
    },
    setSide: (tokenId: Id<"combatTokens">, side: TokenView["side"]) => run(() => setSide({ campaignId, tokenId, side })),
    setSize: (tokenId: Id<"combatTokens">, size: number) => run(() => setSize({ campaignId, tokenId, size })),
    remove: (tokenId: Id<"combatTokens">) => run(() => remove({ campaignId, tokenId })),
    rename: (tokenId: Id<"combatTokens">, name: string) => run(() => rename({ campaignId, tokenId, name })),
  };
}

export type TokenActions = ReturnType<typeof useTokenActions>;
