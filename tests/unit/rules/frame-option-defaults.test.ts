import { describe, expect, it } from "vitest";

import type { FrameId } from "../../../src/lib/frames/index";
import { CAMPAIGN_OPTIONS, resolveOptions, type CampaignOptionId } from "../../../src/lib/frames/options";

/** Plan rule-switches RD2: the four optional frame rules start off in a new campaign (user 2026-10-30). */

const FRAME_RULES: [CampaignOptionId, FrameId][] = [
  ["lessLethal", "castle-high"],
  ["transformations", "dark-heart-of-andaluria"],
  ["enduranceCountdowns", "journey-to-horizon"],
  ["remnantCorruption", "motherboard"],
];

const option = (id: CampaignOptionId) => CAMPAIGN_OPTIONS.find((o) => o.id === id)!;

describe("frame rule defaults", () => {
  it.each(FRAME_RULES)("%s starts off in %s", (id, frameId) => {
    expect(option(id).defaultFor(frameId)).toBe(false);
    expect(resolveOptions(frameId, undefined)[id]).toBe(false);
    expect(resolveOptions(frameId, {})[id]).toBe(false);
  });

  it.each(FRAME_RULES)("a stored %s in %s keeps its value", (id, frameId) => {
    expect(resolveOptions(frameId, { [id]: true })[id]).toBe(true);
    expect(resolveOptions(frameId, { [id]: false })[id]).toBe(false);
  });

  it.each(FRAME_RULES)("%s stays off outside %s even when stored", (id) => {
    expect(resolveOptions("witherwild", { [id]: true })[id]).toBe(false);
  });

  it("Hope & Fear content and Wither stays keep their defaults", () => {
    expect(option("hopeAndFear").defaultFor("castle-high")).toBe(true);
    expect(option("hopeAndFear").defaultFor("witherwild")).toBe(false);
    expect(option("witherPersists").defaultFor("witherwild")).toBe(false);
  });
});
