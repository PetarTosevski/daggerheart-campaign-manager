import { describe, expect, it } from "vitest";

import {
  HUNT_BEATS,
  MAX_CLUES,
  addClue,
  allCluesRevealed,
  createHunt,
  defaultAndaluriaState,
  patchClue,
  patchHunt,
  playerHuntView,
  removeClue,
  removeHunt,
} from "@/lib/frames/trackers/andaluria";

const base = () => createHunt(defaultAndaluriaState(), "h1", "  The Drowned Bell ", 1);

describe("hunts (HF pp.154-155)", () => {
  it("has the book's five beats in order", () => {
    expect(HUNT_BEATS).toEqual(["arrival", "investigation", "escalation", "confrontation", "epilogue"]);
  });

  it("creates a hunt at Arrival with no clues", () => {
    const [hunt] = base().hunts;
    expect(hunt).toMatchObject({ id: "h1", title: "The Drowned Bell", beat: "arrival", clues: [], archived: false, monsterRevealed: false });
    expect(() => createHunt(defaultAndaluriaState(), "x", "  ", 1)).toThrow();
  });

  it("patches fields and validates the beat", () => {
    const s = patchHunt(base(), "h1", { monster: "Siren", beat: "investigation", underlings: ["Drowned sailors"] });
    expect(s.hunts[0]).toMatchObject({ monster: "Siren", beat: "investigation", underlings: ["Drowned sailors"] });
    expect(() => patchHunt(s, "h1", { beat: "nope" as never })).toThrow();
    expect(() => patchHunt(s, "missing", { monster: "x" })).toThrow();
    expect(removeHunt(s, "h1").hunts).toEqual([]);
  });

  it("adds, reveals and removes clues; the badge needs every clue revealed", () => {
    let s = addClue(base(), "h1", "c1", "Wet footprints lead to the bay");
    s = addClue(s, "h1", "c2", "The children hum her song");
    expect(allCluesRevealed(s.hunts[0])).toBe(false);
    s = patchClue(s, "h1", "c1", { revealed: true, note: "Found at the chapel" });
    expect(allCluesRevealed(s.hunts[0])).toBe(false);
    s = patchClue(s, "h1", "c2", { revealed: true });
    expect(allCluesRevealed(s.hunts[0])).toBe(true);
    s = removeClue(s, "h1", "c2");
    expect(s.hunts[0].clues.map((c) => c.id)).toEqual(["c1"]);
    expect(allCluesRevealed({ clues: [] })).toBe(false);
    expect(() => patchClue(s, "h1", "nope", { revealed: true })).toThrow();
  });

  it("caps clues per hunt", () => {
    let s = base();
    for (let i = 0; i < MAX_CLUES; i++) s = addClue(s, "h1", `c${i}`, `clue ${i}`);
    expect(() => addClue(s, "h1", "extra", "one more")).toThrow();
  });
});

describe("player hunt view", () => {
  it("shows the title, beat and revealed clues only", () => {
    let s = patchHunt(base(), "h1", { monster: "Siren", wants: "Sorrow gone", defeat: "Church bells", beat: "escalation" });
    s = addClue(s, "h1", "c1", "revealed one");
    s = addClue(s, "h1", "c2", "still potential");
    s = patchClue(s, "h1", "c1", { revealed: true, note: "GM-only note" });
    const view = playerHuntView(s.hunts[0]);
    expect(view).toEqual({
      id: "h1",
      title: "The Drowned Bell",
      beat: "escalation",
      archived: false,
      clues: [{ id: "c1", text: "revealed one" }],
      allCluesRevealed: false,
    });
    expect(JSON.stringify(view)).not.toMatch(/Siren|Church|GM-only|still potential/);
  });

  it("includes the monster once the GM reveals it", () => {
    const s = patchHunt(base(), "h1", { monster: "Siren", monsterRevealed: true });
    expect(playerHuntView(s.hunts[0]).monster?.monster).toBe("Siren");
  });
});
