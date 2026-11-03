import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { createContext, useContext, type ReactNode } from "react";

import { api, type Id } from "../../../convex";

import type { CombatSlotProps } from "../contract";
import { asCampaignId } from "./campaign-id";

export type CombatGmData = {
  campaignId: Id<"campaigns">;
  layout: CombatSlotProps["layout"];
  fear: number | undefined;
  maps: FunctionReturnType<typeof api.combatMaps.list> | undefined;
  combatants: FunctionReturnType<typeof api.combatTokens.combatants> | undefined;
  tokens: FunctionReturnType<typeof api.combatTokens.list> | undefined;
  handSharing: FunctionReturnType<typeof api.combatCards.handSharing> | undefined;
  doors: FunctionReturnType<typeof api.combatVision.doors> | undefined;
  encounters: FunctionReturnType<typeof api.encounters.list> | undefined;
  requests: FunctionReturnType<typeof api.combatRequests.mine> | undefined;
};

const Ctx = createContext<CombatGmData | null>(null);

/** One subscription per GM query while tools are open (harness-safe). */
export function CombatGmProvider({ campaignId, layout, children }: Pick<CombatSlotProps, "campaignId" | "layout"> & { children: ReactNode }) {
  const cid = asCampaignId(campaignId);
  const mapId = layout._id;
  const value: CombatGmData = {
    campaignId: cid,
    layout,
    fear: useQuery(api.campaigns.fear, { campaignId: cid }),
    maps: useQuery(api.combatMaps.list, { campaignId: cid }),
    combatants: useQuery(api.combatTokens.combatants, { campaignId: cid, mapId }),
    tokens: useQuery(api.combatTokens.list, { campaignId: cid, mapId }),
    handSharing: useQuery(api.combatCards.handSharing, { campaignId: cid }),
    doors: useQuery(api.combatVision.doors, { campaignId: cid, mapId }),
    encounters: useQuery(api.encounters.list, { campaignId: cid }),
    requests: useQuery(api.combatRequests.mine, { campaignId: cid }),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCombatGm(): CombatGmData {
  const value = useContext(Ctx);
  if (value === null) throw new Error("CombatGmProvider missing");
  return value;
}
