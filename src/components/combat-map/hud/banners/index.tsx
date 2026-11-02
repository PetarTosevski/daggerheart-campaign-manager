"use client";

import "./banners.css";

import { useQuery } from "convex/react";
import type { CSSProperties, ReactNode } from "react";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { HudPartProps } from "../state";
import { useHud } from "../state";
import { Banner, type HudPartyMember } from "./banner";
import { ClassicSheetBridge } from "./classic-sheet";

/**
 * The party banners hanging from the gold rod, top-left (plan combat-hud H1.1; HANDOFF "Banners"; CmpTokens 'Banners',
 * Main, GMDesktop). One `combatHud.party` row per PC token on the map on screen (HD1), the caller's own first; each
 * banner is a button that opens that character's sheet through HudProvider (the classic drawer until H2.1). The shell
 * mounts this in its own PartBoundary (CL1).
 */
export const HudBanners: (props: HudPartProps) => ReactNode = ({ state }) => {
  const map = state.map;
  const party = useQuery(api.combatHud.party, map ? { campaignId: state.campaignId, mapId: map._id } : "skip");
  if (map === null) return null;
  if (party === undefined) {
    return (
      <p role="status" className="hbn-loading">
        Loading the party…
      </p>
    );
  }
  return (
    <>
      <BannerRow campaignId={state.campaignId} party={party} />
      <ClassicSheetBridge state={state} />
    </>
  );
};

/** The caller's own banner first (Main: "You" at x = 24), the rest in map order. */
export function orderParty(party: readonly HudPartyMember[]): HudPartyMember[] {
  return [...party.filter((m) => m.mine), ...party.filter((m) => !m.mine)];
}

/**
 * The spotlight tag after the class ("Druid · Spotlight"): H1.S's slot, with the props of H1.S's banner tag
 * (`SpotlightBannerTag` in `hud/spotlight`, in progress). Renders nothing until H1.S lands; at merge this stub is
 * replaced by that import (docs/tasks/TASK-HUD-H1.1.md, merge-time actions).
 */
function SpotlightSlot(props: { campaignId: Id<"campaigns">; characterId: Id<"characters"> }): ReactNode {
  void props;
  return null;
}

export function BannerRow({ campaignId, party }: { campaignId: Id<"campaigns">; party: readonly HudPartyMember[] }) {
  const hud = useHud();
  if (party.length === 0) return null;
  const openId = hud.sheet?.kind === "pc" ? hud.sheet.characterId : null;
  return (
    <div className="hbn-row">
      {/* The rod runs from 12 px left of the first banner to 18 px past the last (Main: 650 px for four). */}
      <span className="hbn-rod" style={{ "--hbn-n": party.length } as CSSProperties} aria-hidden="true" />
      <ul className="hbn-list" aria-label="The party">
        {orderParty(party).map((member, index) => (
          <li key={member.characterId}>
            <Banner
              member={member}
              index={index}
              open={openId === member.characterId}
              onOpen={() => hud.toggleSheet({ kind: "pc", characterId: member.characterId })}
              spotlight={<SpotlightSlot campaignId={campaignId} characterId={member.characterId} />}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
