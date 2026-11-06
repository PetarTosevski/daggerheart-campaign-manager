"use client";

import { useQuery } from "convex/react";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { useActor, useTargetHints } from "../../actions/targets";
import type { CombatPageState } from "../../slots";
import { buildRows, conditionName, rowsFrom, type PickCreature } from "./model";
import type { PickActor, PickRow, PickSessionSpec } from "./types";

/**
 * The creatures a session can list and the rows it shows (plan combat-hud H3.0). One hook for the panel and the ring
 * layer: Convex shares one subscription per query and arguments, so both read the same data (and the classic slots'
 * `playerView` / `combatActionsReads.targets` subscriptions too).
 *
 * - A player: their character's view (`combatVision.playerView`): their own token ("self"), the other PCs, every other
 *   token they see, with condition names (HD1, answer 10a; never a number). Line of sight and a weapon's reach: the
 *   server's `combatActionsReads.targets` hints for the rule's weapon slot.
 * - The GM: every token of the map (`combatTokensReads.list`) with `spec.actor` as "self"; hints only for a PC actor.
 */

type Positioned = { _id: Id<"combatTokens">; x: number; y: number; size: number };

const at = (t: Positioned) => ({ x: t.x, y: t.y, size: t.size });

export type PickScene = {
  /** Every creature the session could list, by token id (for the ring layer's positions). */
  tokens: ReadonlyMap<string, Positioned>;
  rows: PickRow[];
  /** The acting token, for the panel's anchor when nothing is picked. */
  actorTokenId: Id<"combatTokens"> | null;
  /** Rows can't be built yet (queries loading). */
  loading: boolean;
};

const EMPTY: PickScene = { tokens: new Map(), rows: [], actorTokenId: null, loading: true };

export function usePickScene(state: CombatPageState, spec: PickSessionSpec<unknown> | null, picked: readonly string[]): PickScene {
  const player = state.role === "player";
  const actor = useActor(state);
  // The GM's tokens, only while a session is open (a player reads their view, which the map already subscribes to).
  const gmTokens = useQuery(api.combatTokensReads.list, !player && spec !== null && state.map !== null ? { campaignId: state.campaignId, mapId: state.map._id } : "skip");
  const characterId: Id<"characters"> | null = spec === null ? null : player ? (actor?.characterId ?? null) : (spec.actor?.characterId ?? null);
  const hints = useTargetHints(state.campaignId, spec !== null && state.map !== null ? characterId : null, state.map?._id ?? ("" as Id<"combatMaps">), spec?.rule.slot ?? "primary");
  // Rule switches RFC, M1: a Manual campaign lets a no-line-of-sight target be picked (Book until the modes load).
  const sightMode = useQuery(api.ruleSettings.get, spec !== null && state.map !== null ? { campaignId: state.campaignId } : "skip")?.modes.lineOfSight;
  if (spec === null || state.map === null) return EMPTY;

  let creatures: PickCreature[] = [];
  let actorTokenId: Id<"combatTokens"> | null = spec.actor?.tokenId ?? null;
  const tokens = new Map<string, Positioned>();
  if (player) {
    if (!actor) return EMPTY;
    const view = actor.view;
    actorTokenId = view.tokenId;
    for (const pc of view.pcs) {
      tokens.set(pc._id, pc);
      creatures.push({
        tokenId: pc._id,
        name: pc.name,
        side: pc._id === view.tokenId ? "self" : "pc",
        at: at(pc),
        conditions: (pc.stats?.conditions ?? []).map(conditionName),
      });
    }
    for (const t of view.others) {
      tokens.set(t._id, t);
      creatures.push({ tokenId: t._id, name: t.name, side: t.side, at: at(t), conditions: (t.conditions ?? []).map((c) => c.label) });
    }
  } else {
    if (gmTokens === undefined) return EMPTY;
    const self: PickActor | undefined = spec.actor;
    creatures = gmTokens.map((t) => {
      tokens.set(t._id, t);
      return {
        tokenId: t._id,
        name: t.name,
        side: self && t._id === self.tokenId ? "self" : t.side,
        at: at(t),
        conditions: (t.stats?.conditions ?? []).map(conditionName),
      };
    });
  }
  const rows = spec.rows ? rowsFrom(spec.rows) : buildRows({ creatures, rule: spec.rule, hints, picked, ...(sightMode !== undefined ? { sightMode } : {}) });
  // The rule's weapon reach and line of sight wait for the hints of a PC actor.
  const loading = characterId !== null && hints === undefined && !spec.rows;
  return { tokens, rows, actorTokenId, loading };
}
