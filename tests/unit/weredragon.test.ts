import { describe, expect, it } from "vitest";

import {
  NIGHT_SKY,
  REVELATION_KINDS,
  applyReading,
  assertAssignment,
  defaultWeredragonState,
  nightSkyEntry,
  patchRevelation,
  placeClashes,
  playerWeredragonView,
  showdownReady,
  type WeredragonState,
} from "@/lib/frames/trackers/weredragon";

describe("Night Sky Reading table (HF p.141)", () => {
  it("has six rows in each of the five columns", () => {
    for (const kind of REVELATION_KINDS) expect(NIGHT_SKY[kind]).toHaveLength(6);
  });

  it("matches the book's worked example: two 3s give the Longsword and Nwarlyth", () => {
    expect(nightSkyEntry("key2", 3).text).toBe("Lady Lavender’s Longsword* from Knightstead");
    expect(nightSkyEntry("showdown", 3).text).toBe("Nwarlyth");
  });

  it("rejects dice outside 1 to 6", () => {
    expect(() => nightSkyEntry("ally", 7)).toThrow();
    expect(() => nightSkyEntry("ally", 0)).toThrow();
  });
});

describe("reading assignment", () => {
  const roll = [3, 3, 1, 6, 2];

  it("needs one distinct die per column", () => {
    expect(() => assertAssignment(roll, [0, 1, 2, 3, 4])).not.toThrow();
    expect(() => assertAssignment(roll, [0, 0, 2, 3, 4])).toThrow();
    expect(() => assertAssignment(roll, [0, 1, 2, 3])).toThrow();
    expect(() => assertAssignment(roll, [0, 1, 2, 3, 5])).toThrow();
    expect(() => assertAssignment([1, 2, 3], [0, 1, 2])).toThrow();
  });

  it("seeds each revelation from its column and hides it", () => {
    const state = applyReading({ ...defaultWeredragonState(), pendingRoll: roll }, roll, [2, 4, 3, 0, 1]);
    expect(state.pendingRoll).toBeNull();
    expect(state.revelations.map((r) => [r.kind, r.die, r.status])).toEqual([
      ["secret", 1, "hidden"],
      ["ally", 2, "hidden"],
      ["key1", 6, "hidden"],
      ["key2", 3, "hidden"],
      ["showdown", 3, "hidden"],
    ]);
    expect(state.revelations[0].text).toBe("Nightshade");
    expect(state.revelations[2].text).toContain("Zoetrope");
  });
});

describe("same-place warning", () => {
  it("flags two revelations in Nightshade", () => {
    // Secret 1 = Nightshade, Key 2 die 2 = Legendary Scepter in Nightshade.
    expect(placeClashes([1, 2, 3, 2, 4])).toEqual([{ place: "Nightshade", kinds: ["secret", "key2"] }]);
  });

  it("is silent when the revelations are spread out", () => {
    expect(placeClashes([1, 2, 3, 3, 4])).toEqual([]);
    expect(placeClashes([null, null, null, null, null])).toEqual([]);
  });
});

describe("revelation edits and the showdown", () => {
  it("re-seeds text when only the die changes, keeps GM text otherwise", () => {
    let s = patchRevelation(defaultWeredragonState(), "ally", { die: 4 });
    expect(s.revelations[1].text).toContain("Vexxen");
    s = patchRevelation(s, "ally", { text: "Our own ally" });
    s = patchRevelation(s, "ally", { status: "revealed" });
    expect(s.revelations[1]).toEqual({ kind: "ally", die: 4, text: "Our own ally", status: "revealed" });
    expect(() => patchRevelation(s, "ally", { die: 9 })).toThrow();
  });

  it("is ready once revelations 1–4 are achieved", () => {
    let s = defaultWeredragonState();
    for (const kind of ["secret", "ally", "key1"] as const) s = patchRevelation(s, kind, { status: "achieved" });
    expect(showdownReady(s.revelations)).toBe(false);
    s = patchRevelation(s, "key2", { status: "achieved" });
    expect(showdownReady(s.revelations)).toBe(true);
  });
});

describe("player view", () => {
  it("strips hidden revelations and other players' secrets", () => {
    const state: WeredragonState = {
      ...applyReading(defaultWeredragonState(), [1, 2, 3, 4, 5], [0, 1, 2, 3, 4]),
      secrets: [
        { id: "a", authorId: "me", text: "mine", used: false, createdAt: 1 },
        { id: "b", authorId: "you", text: "theirs", used: false, createdAt: 2 },
      ],
    };
    const revealed = patchRevelation(state, "secret", { status: "revealed" });
    const view = playerWeredragonView(revealed, "me");
    expect(view.revelations[0].text).toBe("Nightshade");
    expect(view.revelations[1]).toEqual({ kind: "ally", die: null, text: "", status: "hidden" });
    expect(view.secrets.map((s) => s.id)).toEqual(["a"]);
  });
});
