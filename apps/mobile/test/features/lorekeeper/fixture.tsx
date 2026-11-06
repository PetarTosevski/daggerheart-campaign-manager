import type { ReactElement } from "react";

import { CampaignProvider, CampaignScreen } from "../../../src/shell/campaign-provider";
import { OfflineFrame } from "../../../src/shell/offline";
import type { Id } from "../../../src/convex";
import { campaignSummary } from "../../harness/records";

export const campaignId = "campaign-1" as Id<"campaigns">;
export const conversationId = "conv-1" as Id<"lorekeeperConversations">;

export function campaignRecord(role: "gm" | "player") {
  return campaignSummary({
    _id: campaignId,
    frameId: "witherwild",
    name: "The Table",
    role,
    tier: 1,
    level: 1,
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
  });
}

const conversation = {
  _id: conversationId,
  title: "Range rules",
  userId: "user-gm",
  mine: true,
  visibility: "campaign" as const,
  webSearch: true,
  messageCount: 2,
  lastAt: 1,
  createdAt: 1,
};

const messages = [
  {
    _id: "msg-q1",
    _creationTime: 1,
    conversationId,
    role: "question" as const,
    text: "How do ranges work?",
    status: "done" as const,
    createdAt: 1,
    updatedAt: 1,
  },
  {
    _id: "msg-a1",
    _creationTime: 2,
    conversationId,
    role: "answer" as const,
    text: "Melee is adjacent.",
    status: "done" as const,
    parts: { verdict: "rules" as const, quotes: [], web: [] },
    createdAt: 2,
    updatedAt: 2,
  },
];

export function lorekeeperQueries(role: "gm" | "player", extra: Record<string, unknown> = {}) {
  return {
    "lorekeeper:available": true,
    // Defaults: the GM asks, web search allowed by the campaign and the admin switch (lorekeeper.access, features.mine).
    "lorekeeper:access": { available: true, canAsk: true, webAllowed: true },
    "features:mine": { journal: true, dice3d: true, phoneLayout: true, lorekeeperWeb: true, spriteTokens: true, shareLinks: true },
    "lorekeeper:listConversations": { mine: [conversation], shared: [] },
    "lorekeeper:getConversation": conversation,
    "lorekeeper:listMessages": messages,
    "lorekeeperLibrary:list": { indexedCount: 1, books: [{ bookId: "core", key: "core", title: "Core", subtitle: "Rules", cover: "core", pages: 1, chunkCount: 1, enabled: true }] },
    "lorekeeperUsage:mine": { questionsLeft: 50, webSearchesLeft: 10, campaignCapReached: false, deploymentCapReached: false, shortAnswers: false },
    "lorekeeperAsks:mine": [],
    "lorekeeperRulings:list": [],
    "members:roster": {
      viewer: role,
      gm: { userId: "user-gm", name: "GM" },
      players: [{ userId: "user-p1", name: "Ash", joinedAt: 1, coGm: false, ...(role === "gm" ? { email: null } : {}) }],
    },
    ...(role === "gm" ? { "lorekeeperAsks:listOpen": [] } : {}),
    ...extra,
  };
}

export function inCampaign(role: "gm" | "player", ui: ReactElement, offline = false) {
  return (
    <CampaignProvider campaignId={campaignId}>
      <CampaignScreen>
        <OfflineFrame offline={offline}>{ui}</OfflineFrame>
      </CampaignScreen>
    </CampaignProvider>
  );
}
