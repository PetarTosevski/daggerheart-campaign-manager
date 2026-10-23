/**
 * The shared fan maths (plan hand-fan HF1, dcm-bxp.99.30): the domains tab's loadout and the Combat Map's Hand both
 * place their cards with `fan` from src/components/cards/fan.ts. 7° per step from the middle, a drop of 7 px times the
 * square of the offset, left cards under right ones; a used card turned 16° further and 14 px lower (CB p.101: "turn it
 * on its side"). The vault deck's backs come from the last vault cards' domains.
 */
import { describe, expect, it } from "vitest";

import { CARD_BACKS, deckBacks, fan, fanPose, GENERIC_BACK } from "@/components/cards/fan";

describe("fanPose", () => {
  it("one card stands straight in the middle", () => {
    expect(fanPose(0, 1)).toEqual({ rot: 0, ty: 0, z: 1 });
  });

  it("five cards turn 7° per step and drop by the square of their offset, the middle one straight", () => {
    const poses = [0, 1, 2, 3, 4].map((i) => fanPose(i, 5));
    expect(poses.map((p) => p.rot)).toEqual([-14, -7, 0, 7, 14]);
    expect(poses.map((p) => p.ty)).toEqual([28, 7, 0, 7, 28]);
    expect(poses.map((p) => p.z)).toEqual([1, 2, 3, 4, 5]);
  });

  it("an even hand has no middle card: two cards sit half a step either side", () => {
    expect(fanPose(0, 2)).toEqual({ rot: -3.5, ty: 1.75, z: 1 });
    expect(fanPose(1, 2)).toEqual({ rot: 3.5, ty: 1.75, z: 2 });
  });

  it("a used card turns 16° further and sinks 14 px", () => {
    expect(fanPose(2, 5, true)).toEqual({ rot: 16, ty: 14, z: 3 });
    expect(fanPose(0, 5, true)).toEqual({ rot: 2, ty: 42, z: 1 });
  });
});

describe("fan (the CSS both fans read)", () => {
  it("sets --rot, --ty and the z-index", () => {
    expect(fan(0, 3)).toEqual({ "--rot": "-7deg", "--ty": "7px", zIndex: 1 });
    expect(fan(1, 3, true)).toEqual({ "--rot": "16deg", "--ty": "14px", zIndex: 2 });
  });
});

describe("deckBacks", () => {
  it("shows the last three vault cards' domains, top first", () => {
    expect(deckBacks(["arcana", "blade", "bone", "codex"])).toEqual([CARD_BACKS.codex, CARD_BACKS.bone, CARD_BACKS.blade]);
  });

  it("fills a short vault with the class's domains in turn, then the generic back", () => {
    expect(deckBacks(["grace"], ["sage", "valor"])).toEqual([CARD_BACKS.grace, CARD_BACKS.valor, CARD_BACKS.sage]);
    expect(deckBacks([])).toEqual([GENERIC_BACK, GENERIC_BACK, GENERIC_BACK]);
    expect(deckBacks(["no-such-domain"])).toEqual([GENERIC_BACK, GENERIC_BACK, GENERIC_BACK]);
  });
});
