"use client";

import "./banners.css";

import { useQuery } from "convex/react";
import type { CSSProperties, ReactNode } from "react";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { HudPartProps } from "../state";
import { useHud } from "../state";
import { SpotlightBannerTag } from "../spotlight";
import { Banner, type HudPartyMember } from "./banner";

/**
 * The party banners hanging from the gold rod, top-left (plan combat-hud H1.1; HANDOFF "Banners"; CmpTokens 'Banners',
 * Main, GMDesktop). One `combatHud.party` row per PC token on the map on screen (HD1), the caller's own first; each
 * banner is a button that opens that character's sheet panel through HudProvider (`hud/sheet`, H2.1). The shell
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
  // GMDesktop: no PC is "you" on the GM view (no gold trim, every banner ally size), whatever the server says.
  return <BannerRow campaignId={state.campaignId} party={state.role === "gm" ? party.map((m) => (m.mine ? { ...m, mine: false } : m)) : party} />;
};

/** The caller's own banner first (Main: "You" at x = 24), the rest in map order. */
export function orderParty(party: readonly HudPartyMember[]): HudPartyMember[] {
  return [...party.filter((m) => m.mine), ...party.filter((m) => !m.mine)];
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
              spotlight={<SpotlightBannerTag campaignId={campaignId} characterId={member.characterId} />}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
