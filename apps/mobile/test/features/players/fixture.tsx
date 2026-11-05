import type { ReactElement } from "react";

import { CampaignProvider, CampaignScreen } from "../../../src/shell/campaign-provider";
import { OfflineFrame } from "../../../src/shell/offline";

export const campaignId = "campaign-1";

export function campaignRecord(role: "gm" | "player") {
  return {
    _id: campaignId,
    frameId: "witherwild",
    name: "The Table",
    role,
    tier: 1,
    level: 1,
    custom: null,
    tome: null,
    options: { hopeAndFear: true },
    createdAt: 1,
    lastOpenedAt: 1,
    players: 2,
  };
}

export const gmRoster = {
  viewer: "gm",
  gm: { userId: "gm-1", name: "Ash" },
  players: [{ userId: "player-1", name: "Nikola", email: "nikola@example.test", joinedAt: 1 }],
};

export const playerRoster = {
  viewer: "player",
  gm: { userId: "gm-1", name: "Ash" },
  players: [{ userId: "player-1", name: "Nikola", joinedAt: 1 }],
};

export const accessWithCode = {
  joinCode: "K7QM3XRP",
  invites: [{ _id: "invite-1", email: "friend@example.test", createdAt: 1 }],
};

export const accessEmptyCode = {
  joinCode: null,
  invites: [] as { _id: string; email: string; createdAt: number }[],
};

export function inCampaign(role: "gm" | "player", ui: ReactElement, offline = false) {
  return (
    <CampaignProvider campaignId={campaignId}>
      <CampaignScreen>
        <OfflineFrame offline={offline}>{ui}</OfflineFrame>
      </CampaignScreen>
    </CampaignProvider>
  );
}

export function gmQueries(overrides: Record<string, unknown> = {}) {
  return {
    "campaigns:get": campaignRecord("gm"),
    "members:roster": gmRoster,
    "members:access": accessWithCode,
    ...overrides,
  };
}

export function playerQueries(overrides: Record<string, unknown> = {}) {
  return {
    "campaigns:get": campaignRecord("player"),
    "members:roster": playerRoster,
    ...overrides,
  };
}
