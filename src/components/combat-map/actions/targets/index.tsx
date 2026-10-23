"use client";

import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { ActionsLayerProps, ActionsPanelProps } from "../../slots";
import { useTokens } from "../../tokens/use-tokens";
import type { OtherToken } from "../../vision/use-vision";
import { seenTargets, useActor, useCombatTargets, type WeaponSlot } from "./state";

export { ActionsProvider, useCombatTargets, useActor, seenTargets, type CombatTargets, type WeaponSlot, type Actor } from "./state";

/**
 * Targets (plan combat-actions CA5): the rings on picked enemy tokens (a map layer of its own, not map-canvas) and the
 * list of the enemies the character can attack, each with its Defined Range band and the hint from
 * `combatActions.targets` (Q1: out of range waits for the GM; Q2: line of sight required, cover gives disadvantage).
 * Players only ever get bands and booleans here, never an enemy's numbers (U1).
 */

export type TargetHint = FunctionReturnType<typeof api.combatActions.targets>[number];
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
  return useQuery(api.combatActions.targets, characterId ? { campaignId, characterId, mapId, slot } : "skip");
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

/** One row of the target list: the enemy's name, band and hint, pressed while it is a target. */
export function TargetRows({
  enemies,
  hints,
  picked,
  onToggle,
}: {
  enemies: readonly Pick<OtherToken, "_id" | "name">[];
  hints: readonly TargetHint[];
  picked: readonly Id<"combatTokens">[];
  onToggle: (tokenId: Id<"combatTokens">) => void;
}) {
  const names = new Map<string, string>(enemies.map((t) => [t._id, t.name]));
  const listed = new Set<string>(hints.map((h) => h.tokenId));
  // Attackable enemies first (as the server lists them), then picked tokens that can't be attacked.
  const rows: { tokenId: Id<"combatTokens">; hint: TargetHint | undefined }[] = [
    ...hints.filter((h) => names.has(h.tokenId)).map((h) => ({ tokenId: h.tokenId, hint: h })),
    ...picked.filter((id) => !listed.has(id) && names.has(id)).map((id) => ({ tokenId: id, hint: undefined })),
  ];
  if (rows.length === 0) {
    return (
      <p className="cm-muted cma-note" data-testid="combat-no-targets">
        No enemy in sight. Enemies you can see appear here; tap one on the map to target it.
      </p>
    );
  }
  return (
    <ul className="cma-targets" aria-label="Enemies in sight">
      {rows.map(({ tokenId, hint }) => {
        const on = picked.includes(tokenId);
        const { tone, text } = hintOf(hint);
        const name = names.get(tokenId)!;
        return (
          <li key={tokenId}>
            <button
              type="button"
              className="cma-target"
              data-tone={tone}
              aria-pressed={on}
              data-testid="combat-target"
              aria-label={`${name}${hint ? `, ${BAND_LABEL[hint.band]}` : ""}, ${text}`}
              onClick={() => onToggle(tokenId)}
            >
              <span className="cma-target-check" aria-hidden="true">
                {on ? "◎" : "○"}
              </span>
              <span className="cma-target-name">{name}</span>
              {hint ? <span className="cma-band">{BAND_LABEL[hint.band]}</span> : null}
              <span className="cma-hint">{text}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Player column: the enemies the character sees and can attack; a row (or the token on the map) toggles a target. */
export function TargetList(props: ActionsPanelProps) {
  const { campaignId, map } = props;
  const actor = useActor(props);
  const { targetTokenIds, toggleTarget, slot } = useCombatTargets();
  const hints = useTargetHints(campaignId, actor?.characterId ?? null, map._id, slot);
  if (!actor) return null;
  if (hints === undefined) {
    return (
      <p role="status" className="cm-muted">
        Loading targets…
      </p>
    );
  }
  return (
    <div className="cma-targets-wrap">
      <div className="cma-row">
        <span className="cm-lbl">Targets</span>
        <span className="cm-muted cma-small" data-testid="combat-target-count">
          {seenTargets(targetTokenIds, actor.enemies).length} picked
        </span>
      </div>
      <TargetRows enemies={actor.enemies} hints={hints} picked={targetTokenIds} onToggle={toggleTarget} />
    </div>
  );
}
