// Plan rule-switches RU: a Manual rule's note (actionLog kind 'rule', GM-only, RS0's postRuleNote) shows in the feeds
// with a 'Manual' tag and the rule's title from the registry: the dashboard's Roll Feed and the HUD's "Just now".
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Id } from "../../../convex/_generated/dataModel";
import type { CombatPageState } from "@/components/combat-map/slots";

const functionName = (ref: unknown) => String((ref as Record<symbol, unknown>)[Symbol.for("functionName")] ?? ref);
const queries: Record<string, unknown> = {};
let paginated: unknown[] = [];

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown, args: unknown) => (args === "skip" ? undefined : queries[functionName(ref)]),
  usePaginatedQuery: () => ({ results: paginated, status: "Exhausted", loadMore: () => undefined }),
  useMutation: () => Object.assign(async () => null, { withOptimisticUpdate: () => async () => null }),
}));
vi.mock("@/components/party/dice/dice3d", () => ({ play3d: async () => false }));
vi.mock("@/components/party/dice/sound", () => ({ playRollSound: () => undefined }));

const { RollFeedPanel } = await import("@/components/party/dice/roll-feed");
const { HudFeed } = await import("@/components/combat-map/hud/feed");
const { MANUAL_TAG, ruleNoteTag, feedIcon } = await import("@/components/combat-map/hud/feed/model");

const note = (over: Record<string, unknown> = {}) => ({
  _id: "n1",
  at: 1,
  kind: "rule",
  summary: "Mira rolled with Fear: gain 1 Fear?",
  actorId: "u",
  undone: false,
  canUndo: false,
  visibility: "gm",
  revealable: false,
  ruleId: "hopeFearFromRolls",
  ...over,
});
const roll = { _id: "r1", at: 2, kind: "roll", summary: "Mira rolled", actorId: "u", undone: false, canUndo: false, visibility: "public", revealable: false };

describe("Manual notes in the feed", () => {
  it("ruleNoteTag: the tag and the registry's title, only for kind 'rule'", () => {
    expect(ruleNoteTag({ kind: "rule", ruleId: "hopeFearFromRolls" })).toEqual({ tag: "Manual", title: "Hope and Fear from rolls" });
    expect(ruleNoteTag({ kind: "rule", ruleId: "noSuchRule" })).toEqual({ tag: MANUAL_TAG, title: null });
    expect(ruleNoteTag({ kind: "rule" })).toEqual({ tag: MANUAL_TAG, title: null });
    expect(ruleNoteTag({ kind: "roll" })).toBeNull();
    expect(feedIcon({ kind: "rule" })).toBe("note");
  });

  it("the GM's Roll Feed tags the note 'Manual' with the rule's title; other rows have no tag", () => {
    paginated = [note(), roll];
    render(<RollFeedPanel campaignId={"k1" as Id<"campaigns">} isGm />);
    const list = screen.getByRole("list", { name: "Rolls" });
    const item = within(list).getByRole("listitem", { name: "Mira rolled with Fear: gain 1 Fear?" });
    expect(within(item).getByText(MANUAL_TAG)).toBeInTheDocument();
    expect(within(item).getByText("Hope and Fear from rolls")).toBeInTheDocument();
    expect(within(within(list).getByRole("listitem", { name: "Mira rolled" })).queryByText(MANUAL_TAG)).toBeNull();
  });

  it("the HUD's Just now tags a note the same way", () => {
    queries["feed:list"] = { page: [note({ _id: "n2", ruleId: "fearFromRests", summary: "Long rest: roll the GM's Fear?" })], isDone: true, continueCursor: "" };
    const state = { campaignId: "camp", role: "player", mode: "play", map: null, selectedTokenId: null, onSelectToken: () => {}, previewCharacterId: null, onPreview: () => {} } as unknown as CombatPageState;
    render(<HudFeed state={state} />);
    const feed = screen.getByRole("region", { name: "Just now" });
    expect(within(feed).getByRole("listitem")).toHaveTextContent("Manual Fear from rests Long rest: roll the GM's Fear?");
  });
});
