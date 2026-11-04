import { describe, expect, it } from "vitest";

import { TABLE_SETTING_DEFAULTS, TABLE_SETTING_KEYS, resolveTableSettings } from "../../src/lib/config/campaign-settings";
import {
  PREFERENCE_DEFAULTS,
  RANGE_RINGS_MAX,
  TEXT_SIZE_ZOOM,
  UI_STATE_DEFAULTS,
  UI_STATE_KEYS,
  capRangeRings,
  clampVolume,
  resolvePreferences,
  resolveUiState,
  uiStateValueFor,
  utf8Bytes,
} from "../../src/lib/config/preferences";
import { configMessages } from "../../src/lib/errors/config";
import { errorMessage } from "../../src/lib/convex-errors";
import { ConvexError } from "convex/values";

describe("table settings (config S0)", () => {
  it("defaults keep today's behaviour", () => {
    expect(TABLE_SETTING_DEFAULTS).toEqual({
      playersSeeFear: true,
      outOfRange: "ask",
      spotlightToPlayers: false,
      lorekeeperWeb: true,
      lorekeeperAsk: "everyone",
      fearAtStart: "carry",
      sessionOpensOn: "journal",
      autoSessionLog: true,
    });
    expect(TABLE_SETTING_KEYS).not.toContain("clock");
  });

  it("resolves nothing stored to the defaults", () => {
    expect(resolveTableSettings(undefined)).toEqual(TABLE_SETTING_DEFAULTS);
    expect(resolveTableSettings(null)).toEqual(TABLE_SETTING_DEFAULTS);
    expect(resolveTableSettings({})).toEqual(TABLE_SETTING_DEFAULTS);
  });

  it("resolves each stored field over its default, false included", () => {
    expect(resolveTableSettings({ playersSeeFear: false, autoSessionLog: false, lorekeeperAsk: "gm" })).toEqual({
      ...TABLE_SETTING_DEFAULTS,
      playersSeeFear: false,
      autoSessionLog: false,
      lorekeeperAsk: "gm",
    });
  });

  it("never mutates the defaults", () => {
    const resolved = resolveTableSettings({ outOfRange: "refuse" });
    resolved.playersSeeFear = false;
    expect(TABLE_SETTING_DEFAULTS.playersSeeFear).toBe(true);
    expect(TABLE_SETTING_DEFAULTS.outOfRange).toBe("ask");
  });
});

describe("preferences (config S0)", () => {
  it("defaults", () => {
    expect(PREFERENCE_DEFAULTS).toEqual({ dice3d: true, diceSound: false, diceVolume: 60, reduceMotion: false, textSize: "medium", spotlightPing: true });
    expect(TEXT_SIZE_ZOOM).toEqual({ small: 0.9, medium: 1, large: 1.15 });
  });

  it("resolves stored fields over the defaults and clamps the volume", () => {
    expect(resolvePreferences(undefined)).toEqual(PREFERENCE_DEFAULTS);
    expect(resolvePreferences({ dice3d: false, textSize: "small", diceVolume: 140 })).toEqual({
      ...PREFERENCE_DEFAULTS,
      dice3d: false,
      textSize: "small",
      diceVolume: 100,
    });
    expect(clampVolume(-5)).toBe(0);
    expect(clampVolume(33.6)).toBe(34);
    expect(clampVolume(Number.NaN)).toBe(60);
  });
});

describe("UI state (config S0)", () => {
  it("has one default per key", () => {
    expect(UI_STATE_KEYS.sort()).toEqual(
      ["adversarySort", "environmentSort", "freeRollFormOpen", "gmRollFormCollapsed", "rangeRings", "rollFeedCollapsed", "tokenNames"].sort(),
    );
    expect(resolveUiState([])).toEqual(UI_STATE_DEFAULTS);
  });

  it("takes values that fit their key and ignores the rest", () => {
    const state = resolveUiState([
      { key: "tokenNames", value: true },
      { key: "adversarySort", value: "book" },
      { key: "environmentSort", value: true },
      { key: "rollFeedCollapsed", value: "name" },
      { key: "rangeRings", value: ["a", "b"] },
    ]);
    expect(state).toEqual({ ...UI_STATE_DEFAULTS, tokenNames: true, adversarySort: "book", rangeRings: ["a", "b"] });
    expect(uiStateValueFor("rangeRings", [1, 2])).toBeUndefined();
    expect(uiStateValueFor("adversarySort", "other")).toBeUndefined();
  });

  it("caps range rings at the newest 50, de-duplicated", () => {
    const ids = Array.from({ length: 80 }, (_, i) => `t${i}`);
    const capped = capRangeRings([...ids, "t0"]);
    expect(capped).toHaveLength(RANGE_RINGS_MAX);
    expect(capped.at(-1)).toBe("t0");
    expect(capped[0]).toBe("t31");
    expect(capRangeRings(["a", "", "a", "b"])).toEqual(["a", "b"]);
  });

  it("counts draft bytes in UTF-8", () => {
    expect(utf8Bytes("abc")).toBe(3);
    expect(utf8Bytes("é")).toBe(2);
  });
});

describe("config error codes (config S0)", () => {
  it("lists the Part A codes, each with a message the client shows", () => {
    expect(Object.keys(configMessages).sort()).toEqual(
      ["CAMPAIGN_ARCHIVED", "COMBAT_TARGET_OUT_OF_RANGE", "CO_GM_CREATOR_ONLY", "CO_GM_NOT_MEMBER", "LOREKEEPER_GM_ONLY", "SETTING_INVALID"].sort(),
    );
    for (const [code, message] of Object.entries(configMessages)) {
      expect(errorMessage(new ConvexError({ code }))).toBe(message);
    }
  });
});
