"use client";

import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { ActionsLayerProps } from "../../slots";
import { useTokens } from "../../tokens/use-tokens";
import { useActor, useCombatTargets, type WeaponSlot } from "./state";

export { ActionsProvider, useCombatTargets, useActor, seenTargets, type Aim, type CombatTargets, type WeaponSlot, type Actor } from "./state";

/**
 * Targets (plan combat-actions CA5): the rings on picked enemy tokens (a map layer of its own, not map-canvas) and the
 * hints the HUD's picking panel shows for each enemy, its Defined Range band and the hint from
 * `combatActionsReads.targets` (Q1: out of range waits for the GM; Q2: line of sight required, cover gives disadvantage).
 * Players only ever get bands and booleans here, never an enemy's numbers (U1). The classic target list went with
 * the cut-over (plan combat-hud H8.1): the HUD's picking panel lists the targets.
 */

export type TargetHint = FunctionReturnType<typeof api.combatActionsReads.targets>[number];
export type RangeBand = TargetHint["band"];

export const BAND_LABEL: Record<RangeBand, string> = {
  melee: "Melee",
  veryClose: "Very Close",
  close: "Close",
  far: "Far",
  veryFar: "Very Far",
};

/** The hint a target shows: what the attack will do with it. */
export type HintTone = "ok" | "cover" | "range" | "sight" | "none";

export function hintOf(hint: TargetHint | undefined): { tone: HintTone; text: string } {
  if (!hint) return { tone: "none", text: "Can't be attacked" };
  if (!hint.lineOfSight) return { tone: "sight", text: "No line of sight" };
  if (!hint.inRange) return { tone: "range", text: "Out of range: the GM decides" };
  if (hint.cover) return { tone: "cover", text: "Cover: disadvantage" };
  return { tone: "ok", text: "In range" };
}

/** The character's attackable enemies with hints for the weapon in `slot` (shared subscription; undefined = loading). */
export function useTargetHints(campaignId: Id<"campaigns">, characterId: Id<"characters"> | null, mapId: Id<"combatMaps">, slot: WeaponSlot) {
  return useQuery(api.combatActionsReads.targets, characterId ? { campaignId, characterId, mapId, slot } : "skip");
}

const RING_COLOUR: Record<HintTone, string> = {
  ok: "#f3cf86",
  cover: "#f3cf86",
  range: "#e8a75a",
  sight: "#ff8a7a",
  none: "#9fb2b6",
};

/** A ringed token as the layer draws it: where it stands, and the enemy hint's tone and band (others: "ally", no band). */
type Ring = { id: Id<"combatTokens">; x: number; y: number; size: number; tone: HintTone | "ally"; band: RangeBand | null };

/** Ring colour of a creature picked in a card dialog that is not an enemy (F7-H4). */
const ALLY_RING = "#9fd8b0";

function Rings({ rings, viewport }: { rings: readonly Ring[]; viewport: ActionsLayerProps["viewport"] }) {
  if (rings.length === 0) return null;
  const step = viewport.cell * viewport.zoom;
  const pad = viewport.pad;
  return (
    <div className="cma-rings" aria-hidden="true" data-testid="combat-target-rings">
      {rings.map((r) => {
        const size = r.size * step;
        return (
          <div
            key={r.id}
            className="cma-ring"
            data-testid="combat-target-ring"
            data-tone={r.tone}
            style={{
              left: (r.x + pad) * step - 4,
              top: (r.y + pad) * step - 4,
              width: size + 8,
              height: size + 8,
              ["--ring" as string]: r.tone === "ally" ? ALLY_RING : RING_COLOUR[r.tone],
            }}
          >
            {r.band ? <span className="cma-ring-lbl">{BAND_LABEL[r.band]}</span> : null}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Map layer (Play): a ring on every picked target. Players: each picked token their character sees, an enemy with its
 * band and hint colour; since F7-H4 also the allies and other creatures picked in a card dialog (`toggleExtraTarget`).
 * The GM: the creatures picked in a card dialog while playing for a character. Drawn above the fog and the tokens, never
 * catching the pointer, so the token under it still takes clicks.
 */
export function TargetsLayer(props: ActionsLayerProps) {
  return props.role === "gm" ? <GmRings {...props} /> : <PlayerRings {...props} />;
}

function PlayerRings(props: ActionsLayerProps) {
  const { campaignId, map, viewport } = props;
  const actor = useActor(props);
  const { targetTokenIds, slot } = useCombatTargets();
  const hints = useTargetHints(campaignId, actor?.characterId ?? null, map._id, slot);
  if (!actor) return null;
  const seen = new Map<string, { _id: Id<"combatTokens">; x: number; y: number; size: number; side: string }>(
    [...actor.view.pcs, ...actor.view.others].map((t) => [t._id, t]),
  );
  const rings: Ring[] = targetTokenIds.flatMap((id): Ring[] => {
    const t = seen.get(id);
    if (!t) return [];
    if (t.side !== "enemy") return [{ id, x: t.x, y: t.y, size: t.size, tone: "ally", band: null }];
    const hint = hints?.find((h) => h.tokenId === id);
    return [{ id, x: t.x, y: t.y, size: t.size, tone: hints === undefined ? "ok" : hintOf(hint).tone, band: hint?.band ?? null }];
  });
  return <Rings rings={rings} viewport={viewport} />;
}

function GmRings(props: ActionsLayerProps) {
  const { campaignId, map, viewport } = props;
  const { targetTokenIds } = useCombatTargets();
  const tokens = useTokens(campaignId, "gm", map._id);
  if (!tokens || targetTokenIds.length === 0) return null;
  const byId = new Map(tokens.map((t) => [t._id as string, t]));
  const rings: Ring[] = targetTokenIds.flatMap((id): Ring[] => {
    const t = byId.get(id);
    return t ? [{ id, x: t.x, y: t.y, size: t.size, tone: t.side === "enemy" ? "ok" : "ally", band: null }] : [];
  });
  return <Rings rings={rings} viewport={viewport} />;
}
