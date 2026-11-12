import type { Id } from "../../../src/convex";
import type { LoadedCampaign } from "../../../src/shell/campaign-provider";
import type { PartyMember } from "../../../src/features/dashboard/party";
import { campaignSummary, partySummaryRow } from "../../harness/records";

export const campaignId = "campaign-1" as Id<"campaigns">;

export function campaign(role: "gm" | "player", frameId: LoadedCampaign["frameId"] = "beast-feast"): LoadedCampaign {
  return campaignSummary({
    _id: campaignId,
    name: "The Table",
    frameId,
    role,
    tier: 2,
    level: 3,
    options: { hopeAndFear: true },
    tome: null,
  }) as unknown as LoadedCampaign;
}

export function sessions(live: { sessionId: string; n: number } | null = null) {
  return {
    dashboardNumber: live ? `Session ${live.n}` : "No sessions yet",
    nextSessionLine: "Next session not scheduled",
    nextDate: null,
    live,
    lastPlayed: live ? { sessionId: live.sessionId, n: live.n, recap: "The party left the caves." } : null,
    lastSessionText: live ? "The party left the caves." : "No session has been played yet.",
  };
}

export function character(overrides: Record<string, unknown> = {}): PartyMember {
  return partySummaryRow({
    _id: "char-1",
    status: "active",
    canEdit: true,
    benched: false,
    sheet: {
      name: "Briar",
      level: 1,
      hp: 4,
      hpMax: 6,
      stress: 6,
      stressMax: 6,
      hope: 2,
      scars: 0,
    },
    ...overrides,
  }) as unknown as PartyMember;
}

export function countdown(overrides: Record<string, unknown> = {}) {
  return {
    _id: "cd-1",
    name: "The Lure",
    status: "active",
    currentValue: 4,
    startingValue: 6,
    description: "",
    steps: null,
    chase: null,
    armed: null,
    visibility: { mode: "public", hidden: [] },
    restMode: null,
    chaseResult: null,
    category: null,
    consequence: null,
    completedAt: null,
    mode: null,
    repeat: null,
    initialValue: null,
    startDice: null,
    triggerCount: null,
    lastTriggeredAt: null,
    onLongRest: null,
    onShortRest: null,
    ...overrides,
  };
}

export function restState(overrides: Record<string, unknown> = {}) {
  return {
    open: null,
    shortRestsSinceLong: 0,
    rules: { fearFromRests: "book", shortRestLimit: "book", interruptedRest: "book", twoDowntimeMoves: "book", downtimeMoveEffects: "book", unconscious: "book" },
    last: {
      _id: "rest-1",
      kind: "long",
      status: "finished",
      finishedAt: 1,
      fearRoll: 4,
      fearGained: 1,
      fearPrompt: null,
      undoable: true,
      dice: [],
      oasisHolders: [],
      oasisClosed: [],
      oasisLeft: 0,
      resultsOpen: false,
    },
    ...overrides,
  };
}

export function actionRoll(overrides: Record<string, unknown> = {}) {
  return {
    _id: "row-1",
    at: 1,
    kind: "roll",
    summary: "Briar rolls",
    actorId: "user-1",
    undone: false,
    canUndo: true,
    visibility: "public",
    roll: {
      kind: "action",
      dice: [
        { value: 8, sides: 12, role: "hope" },
        { value: 3, sides: 12, role: "fear" },
      ],
      modifier: 0,
      total: 11,
      outcome: "successHope",
      manual: false,
    },
    ...overrides,
  };
}

export const ERROR_TEXT = "Something went wrong. Check your connection and try again.";

export function failQuery(): never {
  throw new Error("query failed");
}
