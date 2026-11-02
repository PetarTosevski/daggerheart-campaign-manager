"use client";

import "./hand.css";

import type { Id } from "../../../../../convex/_generated/dataModel";
import { usePlayFor } from "../../play-for";
import type { CombatMapSummary } from "../../slots";
import { useTokens } from "../../tokens/use-tokens";
import { handShared, useHandSharing } from "../../actions/hand/sharing";
import type { Creature } from "../../actions/hand/model";
import { seenTargets, useActor, useCombatTargets } from "../../actions/targets/state";
import { useHud, type HudPartProps } from "../state";
import { HiddenHand, HudHandBody } from "./body";

/**
 * The HUD hand region (plan combat-hud H2.3; boards CmpCards, Main): bottom centre with the vault, Roll options and Hide
 * cards beside the fan; the shell's `hand` region places it (H2.2 moves that region while a sheet is open). Whose hand:
 *
 * - a player: their own; while another PC's sheet is open, that PC's hand view only (or why it is hidden: the GM's
 *   switch is off, or its player hid it; F7-H4);
 * - the GM: the hand of the PC whose sheet is open, locked ("Turn on “Play for Moss”") until Play-for is on (answer 5a).
 */
export function HudHand({ state }: HudPartProps) {
  if (state.mode !== "play" || state.map === null) return null;
  return state.role === "gm" ? <GmHand campaignId={state.campaignId} map={state.map} /> : <PlayerHand state={state} map={state.map} />;
}

type Actor = NonNullable<ReturnType<typeof useActor>>;

/** The player's creatures: their own token, the other PCs, and every other token their character sees (R4). */
function playerCreatures(view: Actor["view"]): Creature[] {
  const self = view.pcs.find((pc) => pc._id === view.tokenId);
  const at = (t: { x: number; y: number; size: number }) => ({ x: t.x, y: t.y, size: t.size });
  const out: Creature[] = [{ tokenId: view.tokenId, name: "You", side: "self", ...(self ? { at: at(self) } : {}) }];
  for (const pc of view.pcs) if (pc._id !== view.tokenId) out.push({ tokenId: pc._id, name: pc.name, side: "pc", at: at(pc) });
  for (const t of view.others) out.push({ tokenId: t._id, name: t.name, side: t.side === "pc" ? "pc" : t.side, at: at(t) });
  return out;
}

function PlayerHand({ state, map }: HudPartProps & { map: CombatMapSummary }) {
  const actor = useActor(state);
  const hud = useHud();
  const { targetTokenIds } = useCombatTargets();
  if (!actor) return null;
  const sheetPc = hud.sheet?.kind === "pc" && hud.sheet.characterId !== actor.characterId ? hud.sheet.characterId : null;
  const other = sheetPc ? actor.view.pcs.find((pc) => pc.characterId === sheetPc) : undefined;
  if (sheetPc && other) return <ViewHand campaignId={state.campaignId} mapId={map._id} characterId={sheetPc} name={other.name} creatures={playerCreatures(actor.view)} />;
  const own = actor.view.pcs.find((pc) => pc._id === actor.view.tokenId);
  return (
    <HudHandBody
      campaignId={state.campaignId}
      mapId={map._id}
      characterId={actor.characterId}
      name={own?.name ?? "You"}
      mode="own"
      canPlay
      creatures={playerCreatures(actor.view)}
      pickedEnemies={seenTargets(targetTokenIds, actor.enemies)}
    />
  );
}

/** Another player's hand, read only, when it is shared; otherwise why not. */
function ViewHand({ campaignId, mapId, characterId, name, creatures }: { campaignId: Id<"campaigns">; mapId: Id<"combatMaps">; characterId: Id<"characters">; name: string; creatures: readonly Creature[] }) {
  const sharing = useHandSharing(campaignId);
  if (sharing === undefined) {
    return (
      <p role="status" className="hud-hand-note">
        Loading the hand…
      </p>
    );
  }
  if (!handShared(sharing, characterId)) return <HiddenHand name={name} gmPrivate={!sharing.playersSeeHands} />;
  return <HudHandBody campaignId={campaignId} mapId={mapId} characterId={characterId} name={name} mode="view" canPlay={false} creatures={creatures} pickedEnemies={[]} />;
}

function GmHand({ campaignId, map }: { campaignId: Id<"campaigns">; map: CombatMapSummary }) {
  const hud = useHud();
  const tokens = useTokens(campaignId, "gm", map._id);
  const characterId = hud.sheet?.kind === "pc" ? hud.sheet.characterId : null;
  if (characterId === null || tokens === undefined) return null;
  const token = tokens.find((t) => t.characterId === characterId);
  if (!token) return null;
  return <GmHandFor campaignId={campaignId} mapId={map._id} characterId={characterId} name={token.name} creatures={tokens.map((t) => ({ tokenId: t._id, name: t.name, side: t.characterId === characterId ? "self" : t.side, at: { x: t.x, y: t.y, size: t.size } }))} />;
}

function GmHandFor({ campaignId, mapId, characterId, name, creatures }: { campaignId: Id<"campaigns">; mapId: Id<"combatMaps">; characterId: Id<"characters">; name: string; creatures: readonly Creature[] }) {
  const playFor = usePlayFor(campaignId, characterId, true);
  return <HudHandBody campaignId={campaignId} mapId={mapId} characterId={characterId} name={name} mode="gm" canPlay={playFor.on} creatures={creatures} pickedEnemies={[]} />;
}
