import type { ReactElement } from "react";

import { resolveTableSettings } from "../../../../../src/lib/config/campaign-settings";
import { api, type Id } from "../../../src/convex";
import { CampaignProvider, CampaignScreen } from "../../../src/shell/campaign-provider";
import { OfflineFrame } from "../../../src/shell/offline";
import { fn } from "../../harness";
import { campaignSummary } from "../../harness/records";

export const campaignId = "campaign-1" as Id<"campaigns">;

export function campaignRecord(role: "gm" | "player", settings: Partial<ReturnType<typeof resolveTableSettings>> = {}) {
  return campaignSummary({
    _id: campaignId,
    frameId: "custom",
    name: "The Ford",
    role,
    tier: 2,
    level: 3,
    custom: null,
    tome: null,
    settings: { ...resolveTableSettings(undefined), ...settings },
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

export const planned = { _id: "session-2" as Id<"sessions">, n: 2, title: "The Chapel", date: "2026-03-08", status: "planned" as const };
export const played = { _id: "session-1" as Id<"sessions">, n: 1, title: "The Bridge", date: "2026-03-01", status: "played" as const };
export const playedForPlayer = { ...played, recap: "They held the ford." };
export const live = { ...planned, status: "live" as const, startedAt: Date.UTC(2026, 2, 8, 19, 10) };

export function inCampaign(ui: ReactElement) {
  return (
    <CampaignProvider campaignId={campaignId}>
      <CampaignScreen>
        <OfflineFrame offline={false}>{ui}</OfflineFrame>
      </CampaignScreen>
    </CampaignProvider>
  );
}

const notesJournal = {
  isGm: false,
  whoName: "Ash",
  whoSub: "Player journal",
  journal: null,
  templates: [
    { template: 0, kind: "log", title: "Session log", tape: 0, visibility: "private" },
    { template: 1, kind: "collection", title: "People", tape: 1, visibility: "private" },
  ],
};

/** What every Journal screen reads, per role (GM: a played and a planned session; player: the played one only). */
export function baseQueries(role: "gm" | "player", sessions?: unknown[], settings: Parameters<typeof campaignRecord>[1] = {}) {
  return {
    [fn(api.campaigns.get)]: campaignRecord(role, settings),
    [fn(api.sessionRecords.list)]: sessions ?? (role === "gm" ? [planned, played] : [playedForPlayer]),
    [fn(api.notesThreads.threads)]: [],
    [fn(api.notes.journal)]: notesJournal,
    [fn(api.sessions.current)]: { startedAt: null, extraCharacters: false },
    [fn(api.sessionRecords.summary)]: { sessionsPlayed: 1, hoursAtTable: 3.6, asOf: 1, live: false, partyLevel: 3 },
  };
}

export const logLines = {
  lines: [
    { key: "feed:a1", source: "feed", sourceId: "a1", at: Date.UTC(2026, 2, 1, 19, 5), title: "Vex rolled 14 with Hope", icon: "roll", hidden: false, edited: false, removable: false },
    { key: "gm:g1", source: "gm", sourceId: "g1", at: Date.UTC(2026, 2, 1, 19, 20), title: "The bridge burns", icon: "note", hidden: false, edited: false, removable: true },
    { key: "fear:f1", source: "fear", sourceId: "f1", at: Date.UTC(2026, 2, 1, 19, 30), title: "Fear +1", icon: "fear", hidden: true, edited: false, removable: false },
  ],
  truncated: false,
};

export const tally = { fearGained: 3, fearSpent: 2, hopeSpent: 4, hpMarked: 5, adversariesDefeated: 1, criticals: 0, live: false, truncated: false, fearHidden: false };

export const spotlight = [
  { characterId: "c1" as Id<"characters">, name: "Vex", count: 3, due: false },
  { characterId: "c2" as Id<"characters">, name: "Ash", count: 1, due: true },
];

export const raised = [
  { entryId: "e1", pageId: "p1", pageTitle: "Session 1: The Bridge", kind: "task", state: "open", text: "Find the ferryman" },
];

export function gmLogQueries() {
  return {
    ...baseQueries("gm"),
    [fn(api.journalLog.list)]: logLines,
    [fn(api.sessionWrap.get)]: { sessionId: played._id, n: 1, recap: "They held the ford.", loot: "", threads: "" },
    [fn(api.journalTally.tally)]: tally,
    [fn(api.journalTally.spotlight)]: spotlight,
    [fn(api.journalThreads.raised)]: raised,
    [fn(api.sessionWrap.after)]: { sessionId: played._id, levelUps: [{ characterId: "c1", summary: "Vex reached level 4.", at: 1 }], milestoneAt: null, loot: null, truncated: false },
    [fn(api.charactersReads.partySummary)]: [],
  };
}

export function playerLogQueries(spotlightValue: unknown = null) {
  return {
    ...baseQueries("player"),
    [fn(api.journalLog.list)]: { lines: logLines.lines.filter((l) => !l.hidden), truncated: false },
    [fn(api.journalTally.spotlight)]: spotlightValue,
    [fn(api.journalThreads.raised)]: raised,
  };
}

const encounter = {
  _id: "enc-1" as Id<"encounters">,
  name: "Bridge ambush",
  status: "draft",
  pcs: 4,
  adversaries: 2,
  budget: 14,
  spent: 6,
  verdict: "8 Battle Points left.",
  instances: [
    { _id: "i1", label: "Bandit 1", type: "Standard", count: 1, bp: 2, defeated: false, onMap: false },
    { _id: "i2", label: "Bandit Leader", type: "Leader", count: 1, bp: 3, defeated: false, onMap: false },
  ],
  onMap: false,
};

export function gmPlanQueries() {
  return {
    ...baseQueries("gm"),
    [fn(api.sessionPrep.get)]: {
      scenes: [
        { id: "s1", type: "social", title: "The ferryman", text: "He wants coin.", state: "done" },
        { id: "s2", type: "combat", title: "Ambush", text: "Bandits on the bridge.", encounter },
        { id: "s3", type: "exploration", text: "", encounter: null },
      ],
      hooks: "- A rumour to drop\nThe chapel bell",
      encounter: null,
    },
  };
}
