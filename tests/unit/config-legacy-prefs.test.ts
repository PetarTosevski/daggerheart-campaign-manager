import { describe, expect, it } from "vitest";

import { DEAD_KEYS, readLegacyPrefs, type StorageLike } from "../../src/lib/config/legacy-prefs";
import { DRAFT_MAX_BYTES } from "../../src/lib/config/preferences";

function storage(entries: Record<string, string>): StorageLike {
  const keys = Object.keys(entries);
  return {
    get length() {
      return keys.length;
    },
    key: (i) => keys[i] ?? null,
    getItem: (k) => (k in entries ? entries[k]! : null),
  };
}

const CAMPAIGN = "jd7abc123campaign";
const CHARACTER = "k57xyz789character";

describe("readLegacyPrefs (config S0, Q15 b)", () => {
  it("reads every browser-saved value the app writes", () => {
    const prefs = readLegacyPrefs(
      storage({
        "dcm.dice.settings": JSON.stringify({ threeD: false, sound: true }),
        [`dh.combat.handHidden:${CAMPAIGN}:${CHARACTER}`]: "1",
        "dh.combat.names": "1",
        "dh.combat.rings": JSON.stringify(["t1", "t2"]),
        "dcm:adversary-sort": "book",
        "dcm:environment-sort": "name",
        "dcm:roll-feed-collapsed": "1",
        "dcm:gm-roll-form-collapsed": "0",
        "dcm:free-roll-form-open": "1",
        [`dh.characterWizard.${CAMPAIGN}`]: JSON.stringify({ step: 3, name: "Ash" }),
        "dh.customDraft": JSON.stringify({ name: "Moonfall" }),
      }),
    );
    expect(prefs.preferences).toEqual({ dice3d: false, diceSound: true });
    expect(prefs.uiState).toEqual({
      tokenNames: true,
      rangeRings: ["t1", "t2"],
      adversarySort: "book",
      environmentSort: "name",
      rollFeedCollapsed: true,
      gmRollFormCollapsed: false,
      freeRollFormOpen: true,
    });
    expect(prefs.handFolds).toEqual([{ campaignId: CAMPAIGN, characterId: CHARACTER }]);
    expect(prefs.drafts).toEqual([
      { kind: "characterWizard", campaignId: CAMPAIGN, data: JSON.stringify({ step: 3, name: "Ash" }) },
      { kind: "customFrame", data: JSON.stringify({ name: "Moonfall" }) },
    ]);
    expect(prefs.keys).toHaveLength(11);
    expect(prefs.dead).toEqual([]);
  });

  it("an unfolded hand gives no fold but its key is still removed", () => {
    const key = `dh.combat.handHidden:${CAMPAIGN}:${CHARACTER}`;
    const prefs = readLegacyPrefs(storage({ [key]: "0" }));
    expect(prefs.handFolds).toEqual([]);
    expect(prefs.keys).toEqual([key]);
  });

  it("bad JSON and wrong shapes give nothing, but the keys are listed for removal", () => {
    const prefs = readLegacyPrefs(
      storage({
        "dcm.dice.settings": "{not json",
        "dh.combat.rings": JSON.stringify({ a: 1 }),
        "dcm:adversary-sort": "random",
        "dh.combat.names": "yes",
        [`dh.characterWizard.${CAMPAIGN}`]: "[1,2]",
        "dh.customDraft": "null",
      }),
    );
    expect(prefs.preferences).toEqual({});
    expect(prefs.uiState).toEqual({});
    expect(prefs.drafts).toEqual([]);
    expect(prefs.keys).toHaveLength(6);
  });

  it("drops a draft over the size cap", () => {
    const big = JSON.stringify({ text: "x".repeat(DRAFT_MAX_BYTES) });
    expect(readLegacyPrefs(storage({ "dh.customDraft": big })).drafts).toEqual([]);
  });

  it("keeps the newest 50 range circles", () => {
    const ids = Array.from({ length: 200 }, (_, i) => `t${i}`);
    const rings = readLegacyPrefs(storage({ "dh.combat.rings": JSON.stringify(ids) })).uiState.rangeRings;
    expect(rings).toHaveLength(50);
    expect(rings?.[0]).toBe("t150");
  });

  it("ignores foreign keys, Convex Auth's keys and malformed app keys", () => {
    const prefs = readLegacyPrefs(
      storage({
        "__convexAuthJWT_abc": "token",
        "__convexAuthRefreshToken_abc": "token",
        "other.app": "1",
        "dh.combat.handHidden:only-one-part": "1",
        [`dh.combat.handHidden:${CAMPAIGN}:${CHARACTER}:extra`]: "1",
        "dh.characterWizard.": "{}",
        "dh.characterWizard.has space": "{}",
      }),
    );
    expect(prefs).toEqual({ preferences: {}, uiState: {}, handFolds: [], drafts: [], keys: [], dead: [] });
  });

  it("lists the dead HUD key for deletion", () => {
    expect(DEAD_KEYS).toContain("dcm:combat-hud");
    const prefs = readLegacyPrefs(storage({ "dcm:combat-hud": "1" }));
    expect(prefs.dead).toEqual(["dcm:combat-hud"]);
    expect(prefs.keys).toEqual([]);
  });

  it("blocked storage gives nothing and never throws", () => {
    const blocked: StorageLike = {
      get length(): number {
        throw new Error("SecurityError");
      },
      key: () => {
        throw new Error("SecurityError");
      },
      getItem: () => {
        throw new Error("SecurityError");
      },
    };
    expect(readLegacyPrefs(blocked)).toEqual({ preferences: {}, uiState: {}, handFolds: [], drafts: [], keys: [], dead: [] });
    expect(readLegacyPrefs(null).keys).toEqual([]);
    const readsBlocked: StorageLike = { length: 1, key: () => "dh.combat.names", getItem: () => { throw new Error("blocked"); } };
    expect(readLegacyPrefs(readsBlocked).keys).toEqual([]);
  });

  it("works on the real localStorage", () => {
    window.localStorage.clear();
    window.localStorage.setItem("dh.combat.names", "1");
    expect(readLegacyPrefs(window.localStorage).uiState).toEqual({ tokenNames: true });
    window.localStorage.clear();
  });
});
