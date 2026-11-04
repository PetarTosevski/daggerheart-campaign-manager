"use client";

import { useQuery } from "convex/react";
import { useId, type CSSProperties } from "react";

import { cn } from "@/lib/utils";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { orderParty } from "../banners";
import { Portrait, bannerLabel, bannerSummary, type HudPartyMember } from "../banners/banner";
import { PhoneSpotlight } from "../spotlight/disc";
import { pcHolds } from "../spotlight/model";
import { useHud } from "../state";
import { miniBars } from "./model";

/**
 * The mini banner strip across the top of the phone (plan combat-hud H7.2; PlayerPhone `.mparty`): one small banner per
 * PC (portrait, name, HP-left and Stress bars, the Hope seal at the tip), yours first and gold, then the GM's Fear as a
 * purple banner. Each PC banner is a real `<button>` that opens that sheet, full screen (hard rule 4; the same
 * `toggleSheet` as the desktop banners). Fear reads only (answer 6a: the − / + are the GM's).
 */
export function PhoneStrip({ campaignId, mapId }: { campaignId: Id<"campaigns">; mapId: Id<"combatMaps"> }) {
  const party = useQuery(api.combatHud.party, { campaignId, mapId });
  const scene = useQuery(api.combatHud.scene, { campaignId });
  // H9.1 (PlayerPhone `.mspot`, `.mb.lit`): the 44 px spotlight disc under the strip and the holder's mini banner lit.
  const spotlight = useQuery(api.combatSpotlight.state, { campaignId });
  const hud = useHud();
  const openId = hud.sheet?.kind === "pc" ? hud.sheet.characterId : null;
  return (
    <div className="hud-ph-strip" data-testid="hud-phone-strip">
      {party === undefined ? (
        <p role="status" className="hud-ph-loading">
          Loading the party…
        </p>
      ) : (
        <ul className="hud-ph-party" aria-label="The party">
          {orderParty(party).map((member) => (
            <li key={member.characterId}>
              <MiniBanner
                member={member}
                open={openId === member.characterId}
                lit={pcHolds(spotlight, member.characterId)}
                onOpen={() => hud.toggleSheet({ kind: "pc", characterId: member.characterId })}
              />
            </li>
          ))}
        </ul>
      )}
      {spotlight === undefined || party === undefined ? null : <PhoneSpotlight state={spotlight} party={party} />}
      {scene === undefined ? null : (
        <div className="hud-ph-mb hud-ph-fear" role="img" aria-label={`GM Fear ${scene.fear}`} data-testid="hud-phone-fear">
          <span className="hud-ph-in">
            <svg className="hud-ph-flame" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
              <path d="M8 1c1.5 3 4.5 4.5 4.5 8.2A4.5 4.5 0 0 1 3.5 9.2C3.5 7 5 6 5.5 4.5 6.5 6 7 6.2 7.3 6 7.6 4 8 2.5 8 1z" />
            </svg>
            <b>Fear</b>
            <em>{scene.fear}</em>
          </span>
        </div>
      )}
    </div>
  );
}

function MiniBanner({ member, open, lit, onOpen }: { member: HudPartyMember; open: boolean; lit: boolean; onOpen: () => void }) {
  const describedBy = useId();
  const bars = miniBars(member);
  return (
    <button
      type="button"
      className={cn("hud-ph-mb", member.mine && "hud-ph-you", open && "hud-ph-open", member.down && "hud-ph-down", lit && "hud-ph-lit")}
      data-lit={lit ? "true" : undefined}
      aria-label={bannerLabel(member)}
      aria-describedby={describedBy}
      data-open={open ? "true" : undefined}
      data-testid={`hud-phone-banner-${member.characterId}`}
      onClick={onOpen}
    >
      <span className="hud-ph-in">
        <Portrait member={member} className="hud-ph-face" sizes="30px" />
        <b>{member.name}</b>
        <span className="hud-ph-bars" aria-hidden="true">
          <i className="hud-ph-r" style={{ "--v": bars.hp } as CSSProperties} />
          <i className="hud-ph-s" style={{ "--v": bars.stress } as CSSProperties} />
        </span>
      </span>
      <span className={cn("hud-ph-seal", member.hope.value === 0 && "hud-ph-seal-empty")} aria-hidden="true">
        {member.hope.value}
      </span>
      <span id={describedBy} className="sr-only">
        {bannerSummary(member)}
      </span>
    </button>
  );
}
