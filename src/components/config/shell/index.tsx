"use client";

import { SlotBoundary } from "@/components/party/session/boundary";

import type { CampaignSummary } from "../../../../convex/campaigns";
import { PresenceBeat } from "../presence-beat";
import { SpotlightPing } from "../spotlight-ping";
import { CampaignSettingsPanel } from "./panel";

export { CampaignSettingsPanel } from "./panel";
export { PreferencesBody } from "./preferences";
export { AvatarFace } from "./avatar";
export { closeSettings, openSettings, useSettingsSection } from "./url";

/**
 * What the campaign shell mounts once per campaign page (plan config S1): the GM's Campaign settings panel (opened by
 * the gear through `?settings=`), the presence heartbeat (U3p) and the spotlight ping (U6d). Each in its own boundary.
 * The gear and avatar buttons live in `src/components/app-bar/account.tsx` (the bar and the art header both use them).
 */
export function ConfigMounts({ campaign }: { campaign: CampaignSummary }) {
  const isGm = campaign.role === "gm";
  return (
    <>
      {isGm ? (
        <SlotBoundary fallback={null}>
          <CampaignSettingsPanel campaign={campaign} />
        </SlotBoundary>
      ) : null}
      <SlotBoundary fallback={null}>
        <PresenceBeat campaignId={campaign._id} />
      </SlotBoundary>
      <SlotBoundary fallback={null}>
        <SpotlightPing campaignId={campaign._id} isGm={isGm} />
      </SlotBoundary>
    </>
  );
}
