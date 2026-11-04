"use client";

import "./players.css";

import type { ReactNode } from "react";

import type { SettingsSectionProps } from "../../slots";
import { EmailInvites, JoinLinkCard } from "./invite";
import { PlayerRoster } from "./roster";

/**
 * Campaign settings, Players (design `.s-players`, tracer U3): the roster with the co-GM menu, the 'Invite a player'
 * card (join link, Copy link, New link) and invites by email ('Invite as' Player / Co-GM for the creator, Q8 b). The
 * creator alone promotes and demotes co-GMs (Q7 a); a co-GM sees the roster, removes players and invites players.
 */
export function PlayersSection({ campaign }: SettingsSectionProps): ReactNode {
  return (
    <div className="cfg-pl-sec">
      <PlayerRoster campaignId={campaign._id} viewerIsCreator={campaign.isCreator} />
      <JoinLinkCard campaignId={campaign._id} />
      <div className="cfg-lbl">Invite by email</div>
      <EmailInvites campaignId={campaign._id} canInviteCoGm={campaign.isCreator} />
    </div>
  );
}
