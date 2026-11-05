import type { ReactElement } from "react";

import type { Id } from "../../../src/convex";
import { CampaignProvider, CampaignScreen } from "../../../src/shell/campaign-provider";
import { OfflineFrame } from "../../../src/shell/offline";

export const campaignId = "campaign-1" as Id<"campaigns">;

export function campaignRecord(role: "gm" | "player") {
  return {
    _id: campaignId,
    frameId: "witherwild",
    name: "The Ford",
    role,
    tier: 2,
    level: 3,
    custom: null,
    tome: null,
    options: {
      hopeAndFear: true,
      lessLethal: false,
      transformations: false,
      enduranceCountdowns: false,
      remnantCorruption: false,
      witherPersists: false,
    },
    createdAt: 1,
    lastOpenedAt: 1,
    players: 2,
  };
}

export const gmSession = {
  _id: "session-1" as Id<"sessions">,
  n: 1,
  title: "The Bridge",
  date: "2026-03-01",
  status: "planned" as const,
};

export const playerSession = {
  _id: "session-2" as Id<"sessions">,
  n: 1,
  title: "The Bridge",
  date: "2026-03-01",
  status: "played" as const,
  recap: "They held the ford.",
};

export function inCampaign(role: "gm" | "player", ui: ReactElement) {
  return (
    <CampaignProvider campaignId={campaignId}>
      <CampaignScreen>
        <OfflineFrame offline={false}>{ui}</OfflineFrame>
      </CampaignScreen>
    </CampaignProvider>
  );
}

export function listQueries(role: "gm" | "player") {
  const sessions = role === "gm" ? [gmSession] : [playerSession];
  return {
    "campaigns:get": campaignRecord(role),
    "sessionRecords:list": sessions,
  };
}

export function gmPrepQueries() {
  return {
    ...listQueries("gm"),
    "encounters:list": { active: [], ended: [] },
    "sessions:current": { startedAt: null, extraCharacters: false },
    "sessionPrep:get": { scenes: [], hooks: "", encounter: null },
  };
}

export function gmPlayQueries() {
  return {
    ...listQueries("gm"),
    "sessions:current": { startedAt: Date.now(), extraCharacters: false },
    "sessionPrep:get": { scenes: [], hooks: "", encounter: null },
    "sessionPlay:spotlight": [],
    "sessionPlay:tally": { tally: null, live: true, truncated: false },
    "sessionPlay:log": [],
  };
}

export function gmWrapQueries() {
  return {
    ...listQueries("gm"),
    "sessions:current": { startedAt: null, extraCharacters: false },
    "sessionWrap:get": { sessionId: gmSession._id, n: 1, recap: "", loot: "", threads: "" },
  };
}
