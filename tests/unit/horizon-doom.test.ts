import { describe, expect, it } from "vitest";

import { DOOM_BOXES } from "@/lib/frames/doom-track";
import {
  fearForMark,
  horizonStateSchema,
  INITIAL_HORIZON_STATE,
  markedInTier,
  markRefusal,
  occurredEvents,
  parseHorizonState,
  tierRuleActive,
  unmarkRefusal,
  withMark,
  withoutMark,
  type HorizonState,
} from "@/lib/frames/trackers/horizon";

const markAll = (ids: string[], state: HorizonState = INITIAL_HORIZON_STATE) =>
  ids.reduce((s, id) => withMark(s, id, 1), state);

describe("Doom Track rules", () => {
  it("starts empty with one Soul Echo", () => {
    expect(parseHorizonState(null)).toEqual({ boxes: {}, echoesCollected: 1 });
    expect(() => parseHorizonState({ boxes: {}, echoesCollected: 11 })).toThrow();
  });

  it("marks only in the party's tier or below", () => {
    expect(markRefusal(INITIAL_HORIZON_STATE, "1a", 1)).toBeNull();
    expect(markRefusal(INITIAL_HORIZON_STATE, "2a", 1)).toBe("TIER_TOO_HIGH");
    expect(markRefusal(INITIAL_HORIZON_STATE, "2a", 2)).toBeNull();
    expect(markRefusal(INITIAL_HORIZON_STATE, "4a", 3)).toBe("TIER_TOO_HIGH");
  });

  it("marks a nested box only after its parent", () => {
    expect(markRefusal(INITIAL_HORIZON_STATE, "1a1", 1)).toBe("PARENT_UNMARKED");
    const s = markAll(["1a"]);
    expect(markRefusal(s, "1a1", 1)).toBeNull();
    expect(markRefusal(s, "1a", 1)).toBe("ALREADY_MARKED");
    expect(markRefusal(markAll(["4j"]), "4j1a", 4)).toBe("PARENT_UNMARKED");
    expect(markRefusal(INITIAL_HORIZON_STATE, "nope", 4)).toBe("UNKNOWN_BOX");
  });

  it("unmarks only boxes with nothing marked under them", () => {
    const s = markAll(["1a", "1a1"]);
    expect(unmarkRefusal(s, "1a")).toBe("CHILD_MARKED");
    expect(unmarkRefusal(s, "1a1")).toBeNull();
    expect(unmarkRefusal(withoutMark(s, "1a1"), "1a")).toBeNull();
    expect(unmarkRefusal(s, "1b")).toBe("NOT_MARKED");
  });

  it("activates a tier's rule at 5 marked boxes (tiers 1–3)", () => {
    const four = markAll(["1a", "1b", "1c", "1d"]);
    expect(tierRuleActive(four, 1)).toBe(false);
    const five = markAll(["1a1"], four);
    expect(markedInTier(five, 1)).toBe(5);
    expect(tierRuleActive(five, 1)).toBe(true);
    expect(tierRuleActive(markAll(["4a", "4b", "4c", "4d", "4e"]), 4)).toBe(false);
  });

  it("a Tier 4 mark gains Fear equal to the marked Tier 4 boxes", () => {
    const one = markAll(["4a"]);
    expect(fearForMark(one, "4a")).toBe(1);
    const three = markAll(["4b", "4c"], one);
    expect(fearForMark(three, "4c")).toBe(3);
    expect(fearForMark(markAll(["1a"]), "1a")).toBe(0);
  });

  it("shows players only occurred events", () => {
    let s = markAll(["1a", "1b"]);
    s = { ...s, boxes: { ...s.boxes, "1b": { ...s.boxes["1b"], occurred: true } } };
    expect(occurredEvents(s)).toEqual([{ id: "1b", tier: 1, text: DOOM_BOXES.find((b) => b.id === "1b")!.text }]);
    expect(horizonStateSchema.parse(s)).toEqual(s);
  });
});
