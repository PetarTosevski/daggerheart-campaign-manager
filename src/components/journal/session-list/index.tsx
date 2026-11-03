"use client";

import { useQuery } from "convex/react";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { SessionListItem } from "../../../../convex/sessionRecords";
import type { CampaignSoFarProps, PlanSessionButtonProps, SessionListProps } from "../slots";

/**
 * Session list slot (JS, contract: ../slots.ts). J1 defines `useSessionList` (the page reads it for the 'Sessions N'
 * count and the default session); the components are stubs that render nothing until JS lands.
 */

/** The campaign's sessions newest first, as this caller may see them (players: live and played); `undefined` loading. */
export function useSessionList(campaignId: Id<"campaigns">): SessionListItem[] | undefined {
  return useQuery(api.sessionRecords.list, { campaignId });
}

/** Left column: the sessions (J1 stub). */
export const SessionList: (props: SessionListProps) => React.ReactNode = () => null;

/** Left column, under the list: '+ Plan session N', GM only (J1 stub). */
export const PlanSessionButton: (props: PlanSessionButtonProps) => React.ReactNode = () => null;

/** Left column, last: 'Campaign so far' (J1 stub). */
export const CampaignSoFar: (props: CampaignSoFarProps) => React.ReactNode = () => null;
