/**
 * The spotlight ping (plan config U6d, user answer Q14 a): a mocked `combatSpotlight.state` holder sequence. The chime
 * and the toast "You have the spotlight" come only on a change to a PC the viewer owns: never on first load, never for
 * the GM, the whole party or someone else's PC; the toast without the chime while dice sound is off; the pref off
 * shows nothing; the toast hides after its time and when the spotlight moves on.
 */
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PING_TEXT, PING_TOAST_MS, SpotlightPing, spotlightKey } from "@/components/config/spotlight-ping";

import type { Id } from "../../convex/_generated/dataModel";

const queries: Record<string, unknown> = {};
const asked: { name: string; args: unknown }[] = [];
const functionName = (ref: unknown) => String((ref as Record<symbol, unknown>)[Symbol.for("functionName")] ?? ref);

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown, args: unknown) => {
    const name = functionName(ref);
    asked.push({ name, args });
    if (args === "skip") return undefined;
    const value = queries[name];
    return typeof value === "function" ? (value as (a: unknown) => unknown)(args) : value;
  },
}));

const plays: { volume: number }[] = [];
class FakeAudio {
  volume = 1;
  currentTime = 0;
  constructor(public src: string) {}
  play() {
    plays.push({ volume: this.volume });
    return Promise.resolve();
  }
}

const CAMPAIGN = "camp" as Id<"campaigns">;
const MIRA = "c-mira" as Id<"characters">;
const TABBY = "c-tabby" as Id<"characters">;
const MINE = new Set<string>([MIRA]);

const PREFS = { dice3d: true, diceSound: true, diceVolume: 40, reduceMotion: false, textSize: "medium", spotlightPing: true, legacyImported: true };
const base = { reason: null, rollBy: null, reactionsOnly: false, canMove: false, adversaryTokenId: null, adversaryName: null, adversaryPortrait: null };
const party = { ...base, holder: null, since: null };
const gm = (since: number) => ({ ...base, holder: { kind: "gm" as const }, since, reason: "gmTook" });
const pc = (characterId: Id<"characters">, since: number) => ({ ...base, holder: { kind: "pc" as const, characterId, name: characterId }, since, reason: "gmHanded" });

function setState(value: unknown) {
  queries["combatSpotlight:state"] = value;
}

function ui(isGm = false) {
  const view = render(<SpotlightPing campaignId={CAMPAIGN} isGm={isGm} />);
  return { rerender: () => view.rerender(<SpotlightPing campaignId={CAMPAIGN} isGm={isGm} />) };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("Audio", FakeAudio);
  queries["preferences:get"] = PREFS;
  queries["charactersReads:get"] = (args: { characterId: string }) => ({ _id: args.characterId, mine: MINE.has(args.characterId) });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  plays.length = 0;
  asked.length = 0;
  for (const k of Object.keys(queries)) delete queries[k];
});

describe("spotlightKey", () => {
  it("names the holder and since", () => {
    expect(spotlightKey(party)).toBe("party");
    expect(spotlightKey(gm(5))).toBe("gm:5");
    expect(spotlightKey(pc(MIRA, 7))).toBe(`pc:${MIRA}:7`);
  });
});

describe("SpotlightPing", () => {
  it("does not ping on first load, even when your PC already holds it", () => {
    setState(pc(MIRA, 1));
    ui();
    expect(screen.queryByRole("status")).toBeNull();
    expect(plays).toHaveLength(0);
  });

  it("chimes at the dice volume and shows the toast when the spotlight moves to your PC", () => {
    setState(gm(1));
    const { rerender } = ui();
    setState(pc(MIRA, 2));
    rerender();
    expect(screen.getByRole("status")).toHaveTextContent(PING_TEXT);
    expect(plays).toEqual([{ volume: 0.4 }]);
    rerender();
    expect(plays).toHaveLength(1);
    act(() => vi.advanceTimersByTime(PING_TOAST_MS));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("ignores the GM, the whole party and someone else's PC", () => {
    setState(pc(MIRA, 1));
    const { rerender } = ui();
    for (const next of [gm(2), party, pc(TABBY, 3)]) {
      setState(next);
      rerender();
      expect(screen.queryByRole("status")).toBeNull();
    }
    expect(plays).toHaveLength(0);
  });

  it("pings again when your PC gets it back, not on an unchanged repeat", () => {
    setState(party);
    const { rerender } = ui();
    setState(pc(MIRA, 2));
    rerender();
    rerender();
    expect(plays).toHaveLength(1);
    setState(gm(3));
    rerender();
    expect(screen.queryByRole("status")).toBeNull();
    setState(pc(MIRA, 4));
    rerender();
    expect(screen.getByRole("status")).toHaveTextContent(PING_TEXT);
    expect(plays).toHaveLength(2);
  });

  it("shows the toast without the chime while dice sound is off", () => {
    queries["preferences:get"] = { ...PREFS, diceSound: false };
    setState(gm(1));
    const { rerender } = ui();
    setState(pc(MIRA, 2));
    rerender();
    expect(screen.getByRole("status")).toHaveTextContent(PING_TEXT);
    expect(plays).toHaveLength(0);
  });

  it("does nothing with the pref off, and never subscribes for the GM", () => {
    queries["preferences:get"] = { ...PREFS, spotlightPing: false };
    setState(gm(1));
    const { rerender } = ui();
    setState(pc(MIRA, 2));
    rerender();
    expect(screen.queryByRole("status")).toBeNull();
    expect(asked.filter((q) => q.name === "combatSpotlight:state").every((q) => q.args === "skip")).toBe(true);

    asked.length = 0;
    const gmView = ui(true);
    setState(pc(MIRA, 3));
    gmView.rerender();
    expect(asked.filter((q) => q.name !== "charactersReads:get").every((q) => q.args === "skip")).toBe(true);
    expect(plays).toHaveLength(0);
  });

  it("waits for the character before deciding, and drops the fade under the account's Reduce motion", () => {
    queries["preferences:get"] = { ...PREFS, reduceMotion: true };
    const character = queries["charactersReads:get"];
    queries["charactersReads:get"] = undefined;
    setState(gm(1));
    const { rerender } = ui();
    setState(pc(MIRA, 2));
    rerender();
    expect(screen.queryByRole("status")).toBeNull();
    queries["charactersReads:get"] = character;
    rerender();
    const toast = screen.getByRole("status");
    expect(toast.className).not.toContain("animate-in");
    expect(plays).toHaveLength(1);
  });
});
