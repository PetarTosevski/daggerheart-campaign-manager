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

export function gmCharacter(overrides: Record<string, unknown> = {}) {
  return {
    _id: "entry-1",
    kind: "character" as const,
    name: "Kreil Dirn",
    role: "Spymaster",
    known: true,
    allegiance: "Haven",
    allegianceShown: "Haven",
    region: "",
    regionAuto: false,
    tokenId: null,
    images: [{ key: "img-1", storageId: "store-1", shown: true, url: "https://example.com/kreil.jpg" }],
    cover: "img-1",
    createdAt: 1,
    ...overrides,
  };
}

export function playerCharacter(overrides: Record<string, unknown> = {}) {
  return {
    _id: "entry-1",
    kind: "character" as const,
    name: "Kreil Dirn",
    role: "Spymaster",
    allegianceShown: "Haven",
    region: "",
    tokenId: null,
    images: [{ key: "0", url: "https://example.com/kreil.jpg" }],
    cover: "0",
    createdAt: 1,
    ...overrides,
  };
}

export function gmList(entries: unknown[], pins: unknown[] = []) {
  return { role: "gm" as const, entries, pins };
}

export function playerList(entries: unknown[]) {
  return { role: "player" as const, entries };
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

export function listQueries(role: "gm" | "player", list: unknown) {
  return {
    "campaigns:get": campaignRecord(role),
    "codex:list": list,
  };
}

export function entryQueries(role: "gm" | "player", list: unknown, text: unknown) {
  return {
    ...listQueries(role, list),
    "codex:entryText": text,
  };
}
