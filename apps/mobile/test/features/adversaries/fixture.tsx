import type { ReactElement } from "react";

import { CampaignProvider } from "../../../src/shell/campaign-provider";
import { OfflineFrame } from "../../../src/shell/offline";

export const campaignId = "campaign-1";
export const encounterId = "encounter-1";

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
      hopeAndFear: false,
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

export function encounterSummary(overrides: Record<string, unknown> = {}) {
  return { _id: encounterId, name: "Ambush at the ford", status: "running" as const, pcs: 3, updatedAt: 1, ...overrides };
}

export function encounterList(active: unknown[] = [encounterSummary()]) {
  return { active, ended: [], moreEnded: false };
}

export function bearInstance(overrides: Record<string, unknown> = {}) {
  return {
    _id: "instance-1",
    _creationTime: 1,
    campaignId,
    encounterId,
    source: { kind: "srd" as const, adversaryId: "bear" },
    label: "Bear",
    order: 1,
    summoned: false,
    stats: { difficulty: 14, major: 9, severe: 17, hpMax: 7, stressMax: 2 },
    hp: 0,
    stress: 0,
    defeated: false,
    conditions: [],
    tags: [],
    spotlights: 0,
    spotlightTurn: 1,
    updatedAt: 1,
    name: "Bear",
    type: "Bruiser" as const,
    tier: 1,
    ...overrides,
  };
}

export function encounterView(status: "draft" | "running" | "ended" = "running", instances: unknown[] = [bearInstance()]) {
  return {
    encounter: {
      _id: encounterId,
      _creationTime: 1,
      campaignId,
      name: "Ambush at the ford",
      status,
      pcs: 3,
      adjustments: [],
      gmTurn: 1,
      createdAt: 1,
      updatedAt: 1,
    },
    instances,
  };
}

export function inCampaign(ui: ReactElement, offline = false) {
  return (
    <CampaignProvider campaignId={campaignId}>
      <OfflineFrame offline={offline}>{ui}</OfflineFrame>
    </CampaignProvider>
  );
}

/** Everything the GM screen can subscribe to, so every tab loads. */
export function gmQueries(overrides: Record<string, unknown> = {}) {
  return {
    "campaigns:get": campaignRecord("gm"),
    "encounters:list": encounterList(),
    "customAdversaries:list": [],
    "charactersReads:listByCampaign": [{ _id: "pc-1", status: "active" }, { _id: "pc-2", status: "active" }],
    "campaigns:fear": 4,
    "encounters:get": encounterView(),
    ...overrides,
  };
}
