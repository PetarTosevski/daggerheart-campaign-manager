import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";

import { sheetCharacterId, sheetHref, type SheetTokenRef } from "@/components/combat-map/slots";
import {
  beastformAttackId,
  FEATURE_TOKEN_KEY_MAX,
  FEATURE_USE_KEY_MAX,
  featureId,
  featureKey,
  featureSlug,
  isFeatureKey,
  parseFeatureId,
} from "@/lib/domain/feature-effects/ids";
import { FEATURE_SOURCES, type FeatureEffect } from "@/lib/domain/feature-effects/types";
import { errorMessage } from "@/lib/convex-errors";
import { combatFeatureMessages } from "@/lib/errors/combatFeatures";
import { BEASTFORMS } from "@/lib/srd/beastforms";
import { CLASSES } from "@/lib/srd/classes";
import { FEATURE_CLASSIFICATION, MARTIAL_STANCE_SLUGS, featureClass, featureUsage } from "@/lib/srd/feature-effects/classification";
import { FEATURE_EFFECT_TABLES, FEATURE_EFFECTS, featureEffect, mergeFeatureTables } from "@/lib/srd/feature-effects/index";
import { ANCESTRIES, COMMUNITIES, TRANSFORMATIONS } from "@/lib/srd/heritage";
import { SUBCLASSES } from "@/lib/srd/subclasses";
import {
  cardTokensSchema,
  characterSheetSchema,
  classStateSchema,
  FEATURE_USE_UNTIL,
  FEATURE_USES_MAX,
  featureUseSchema,
  type CharacterSheet,
} from "@/lib/validation/characters";
import type { Id, TableNames } from "../../convex/_generated/dataModel";

// Plan sheet-drawer, tracer SD0: the feature classification, the ids and keys, the empty registry, the sheet widening,
// the error codes and the Sheet button's pick.

/** The 217 features of the data (analysis section 0), by source. */
function dataFeatureIds(): { core: string[]; beastform: string[]; transformation: string[] } {
  const core: string[] = [];
  for (const c of CLASSES) {
    core.push(featureId("hope", c.id));
    for (const f of c.classFeatures) core.push(featureId("class", c.id, f.name));
  }
  for (const s of SUBCLASSES) for (const f of [...s.foundation, ...s.specialization, ...s.mastery]) core.push(featureId("subclass", s.id, f.name));
  for (const a of ANCESTRIES) for (const f of a.features) core.push(featureId("ancestry", a.id, f.name));
  for (const c of COMMUNITIES) core.push(featureId("community", c.id, c.feature.name));
  const beastform = BEASTFORMS.flatMap((b) => b.features.map((f) => featureId("beastform", b.id, f.name)));
  const transformation = TRANSFORMATIONS.flatMap((t) => t.features.map((f) => featureId("transformation", t.id, f.name)));
  return { core, beastform, transformation };
}

const stanceIds = MARTIAL_STANCE_SLUGS.flat().map((slug) => featureId("stance", "martial-artist", slug));
const rows = Object.entries(FEATURE_CLASSIFICATION).map(([id, row]) => ({ id, ...row }));
const count = (ids: readonly string[], usage: string) => ids.filter((id) => FEATURE_CLASSIFICATION[id]?.usage === usage).length;

describe("feature classification (SD0, analysis section 2)", () => {
  const data = dataFeatureIds();
  const expected = [...data.core, ...data.beastform, ...data.transformation, ...stanceIds];

  it("has one row per feature of the data and no row without a feature", () => {
    expect(data.core).toHaveLength(217);
    expect(data.beastform).toHaveLength(45);
    expect(data.transformation).toHaveLength(12);
    expect(stanceIds).toHaveLength(16);
    expect(new Set(expected).size).toBe(expected.length);
    expect(expected.filter((id) => !(id in FEATURE_CLASSIFICATION))).toEqual([]);
    expect(Object.keys(FEATURE_CLASSIFICATION).filter((id) => !expected.includes(id))).toEqual([]);
  });

  it("matches the analysis counts of the 217: 131 combat, 50 passive, 24 out of combat, 12 narrative", () => {
    expect([count(data.core, "combat"), count(data.core, "passive"), count(data.core, "outOfCombat"), count(data.core, "narrative")]).toEqual([131, 50, 24, 12]);
  });

  it("matches the analysis counts by card (section 0)", () => {
    const byPrefix = (prefix: string, card?: "foundation" | "specialization" | "mastery") => {
      const ids =
        card === undefined
          ? data.core.filter((id) => id.startsWith(prefix))
          : SUBCLASSES.flatMap((s) => s[card].map((f) => featureId("subclass", s.id, f.name)));
      return ["combat", "passive", "outOfCombat", "narrative"].map((u) => count(ids, u));
    };
    expect(byPrefix("hope:")).toEqual([13, 0, 0, 0]);
    expect(byPrefix("class:")).toEqual([14, 3, 2, 4]);
    expect(byPrefix("", "foundation")).toEqual([29, 6, 3, 2]);
    expect(byPrefix("", "specialization")).toEqual([24, 14, 2, 0]);
    expect(byPrefix("", "mastery")).toEqual([18, 16, 3, 1]);
    expect(byPrefix("ancestry:")).toEqual([27, 11, 5, 5]);
    expect(byPrefix("community:")).toEqual([6, 0, 9, 0]);
  });

  it("lists the 16 martial stances of HF p.12, four per tier, without repeats", () => {
    expect(MARTIAL_STANCE_SLUGS.map((tier) => tier.length)).toEqual([4, 4, 4, 4]);
    expect(new Set(MARTIAL_STANCE_SLUGS.flat()).size).toBe(16);
    expect(MARTIAL_STANCE_SLUGS[0]).toEqual(["favored", "invigorating", "quick", "reliable"]);
  });

  it("keeps how and usage consistent, with a reading for every row", () => {
    for (const r of rows) {
      if (r.usage === "combat") expect([r.id, ["action", "reaction", "rider", "auto"].includes(r.how)]).toEqual([r.id, true]);
      if (r.usage === "passive") expect([r.id, ["passive", "auto"].includes(r.how)]).toEqual([r.id, true]);
      expect([r.id, r.why.length > 0]).toEqual([r.id, true]);
    }
  });

  it("answers featureUsage; an unknown feature is out of combat", () => {
    expect(featureUsage("hope:guardian")).toBe("combat");
    expect(featureUsage("subclass:stalwart:unwavering")).toBe("passive");
    expect(featureUsage("community:highborne:privilege")).toBe("outOfCombat");
    expect(featureUsage("class:druid:wildtouch")).toBe("narrative");
    expect(featureUsage("ancestry:nobody:nothing")).toBe("outOfCombat");
    expect(featureClass("beastform:agile-scout:fragile")?.how).toBe("auto");
  });

  it("classifies the user's readings: Dedicated is Orderborne's (Q13), the rest-time features are out of combat (Q15 b)", () => {
    expect(featureClass("community:orderborne:dedicated")).toMatchObject({ usage: "combat", how: "rider" });
    for (const id of ["community:frostborne:hardy", "ancestry:clank:efficient", "ancestry:elf:celestial-trance", "community:duneborne:oasis"]) {
      expect([id, featureUsage(id)]).toEqual([id, "outOfCombat"]);
    }
  });
});

describe("feature ids and keys (SD0)", () => {
  it("slugs printed names", () => {
    expect(featureSlug("Ranger’s Focus")).toBe("rangers-focus");
    expect(featureSlug("Get In & Get Out")).toBe("get-in-get-out");
    expect(featureSlug("Partners-in-Arms")).toBe("partners-in-arms");
    expect(featureSlug("Bird's-Eye View")).toBe("birds-eye-view");
  });

  it("builds '<source>:<owner>:<slug>' ids, and a class's Hope feature takes no slug", () => {
    expect(featureId("subclass", "stalwart", "Iron Will")).toBe("subclass:stalwart:iron-will");
    expect(featureId("ancestry", "dwarf", "Thick Skin")).toBe("ancestry:dwarf:thick-skin");
    expect(featureId("hope", "guardian")).toBe("hope:guardian");
    expect(beastformAttackId("agile-scout")).toBe("beastform:agile-scout:attack");
    expect(() => featureId("class", "bard")).toThrow();
    expect(() => featureId("class", "bard", "’")).toThrow();
  });

  it("parses every classified id back, and refuses other strings", () => {
    for (const id of Object.keys(FEATURE_CLASSIFICATION)) {
      const parsed = parseFeatureId(id);
      expect([id, parsed !== null && FEATURE_SOURCES.includes(parsed.source)]).toEqual([id, true]);
    }
    expect(parseFeatureId("hope:bard")).toEqual({ source: "hope", owner: "bard", slug: null });
    expect(parseFeatureId("subclass:stalwart:iron-will")).toEqual({ source: "subclass", owner: "stalwart", slug: "iron-will" });
    for (const bad of ["", "card:bolt-beacon", "hope:bard:extra", "class:bard", "class::rally", "subclass:a:b:c", "rally"]) {
      expect([bad, parseFeatureId(bad)]).toEqual([bad, null]);
    }
  });

  it("keeps every 'feat:<featureId>' key within the 60 characters of cardTokens (the longest is checked)", () => {
    const ids = [...Object.keys(FEATURE_CLASSIFICATION), ...BEASTFORMS.map((b) => beastformAttackId(b.id))];
    const longest = ids.map((id) => featureKey(id)).reduce((a, b) => (b.length > a.length ? b : a));
    expect(longest).toBe("feat:subclass:warden-of-the-elements:elemental-incarnation");
    expect(longest.length).toBeLessThanOrEqual(FEATURE_TOKEN_KEY_MAX);
    expect(cardTokensSchema.safeParse({ cardId: longest, count: 3 }).success).toBe(true);
    expect(featureUseSchema.safeParse({ key: featureKey(longest.slice(5), "a-twenty-char-use-id"), until: "scene" }).success).toBe(true);
    expect(isFeatureKey(longest)).toBe(true);
    expect(isFeatureKey("card:bolt-beacon")).toBe(false);
    expect(isFeatureKey("rally")).toBe(false);
  });

  it("refuses keys over the sheet's caps", () => {
    expect(() => featureKey(`subclass:${"x".repeat(60)}:y`)).toThrow();
    expect(() => featureKey("hope:bard", "u".repeat(FEATURE_USE_KEY_MAX))).toThrow();
    expect(featureKey("hope:bard", "main")).toBe("feat:hope:bard:main");
  });
});

describe("feature-effect registry (SD0)", () => {
  it("has the twelve group tables, empty until their FE tracers fill them", () => {
    expect(Object.keys(FEATURE_EFFECT_TABLES)).toEqual([
      "bard-wizard",
      "druid-sorcerer",
      "guardian-warrior",
      "ranger-rogue",
      "seraph-witch",
      "assassin-brawler",
      "warlock",
      "ancestry-core",
      "heritage-hf",
      "beastforms",
      "transformations",
      "stances",
    ]);
    for (const table of Object.values(FEATURE_EFFECT_TABLES)) expect(table).toEqual([]);
    expect(FEATURE_EFFECTS.size).toBe(0);
    expect(featureEffect("hope:guardian")).toBeUndefined();
  });

  it("merges tables by feature id and throws on an id listed twice", () => {
    const entry = (id: string): FeatureEffect => ({ featureId: id, source: "hope", owner: "guardian", uses: [] });
    expect([...mergeFeatureTables([[entry("hope:guardian")], [entry("hope:bard")]]).keys()]).toEqual(["hope:guardian", "hope:bard"]);
    expect(() => mergeFeatureTables([[entry("hope:guardian")], [entry("hope:guardian")]])).toThrow(/two effect entries/);
  });
});

/** A stored version 2 sheet before SD0 (no `martial`, no `scene` uses). */
function oldSheet(overrides: Record<string, unknown> = {}) {
  return {
    name: "Ash",
    pronouns: "",
    description: "",
    level: 3,
    classId: "brawler",
    subclassId: "martial-artist",
    ancestry: { kind: "single", id: "human" },
    communityId: "orderborne",
    traits: { agility: 2, strength: 1, finesse: 1, instinct: 0, presence: 0, knowledge: -1 },
    traitMarks: {},
    evasion: 11,
    hpMax: 6,
    hp: 0,
    stressMax: 6,
    stress: 2,
    hope: 2,
    scars: 0,
    armorMarked: 0,
    proficiency: 1,
    primaryWeaponId: "broadsword",
    inventory: [],
    gold: { handfuls: 1, bags: 0, chest: false },
    experiences: [{ id: "e1", name: "Sellsword", value: 2 }],
    domainCards: { owned: [], loadout: [] },
    background: [],
    connections: [],
    notes: "",
    featureUses: [{ key: "card:bolt-beacon", until: "rest" }],
    classState: { comboDie: 4 },
    ...overrides,
  };
}

describe("sheet validators, widened (SD0, rule 7)", () => {
  it("adds 'scene' to the feature-use resets (Q7)", () => {
    expect(FEATURE_USE_UNTIL).toEqual(["rest", "longRest", "session", "scene"]);
    expect(featureUseSchema.parse({ key: "feat:ancestry:gnome:flicker-step", until: "scene" }).until).toBe("scene");
  });

  it("reads an old sheet back unchanged", () => {
    const parsed: CharacterSheet = characterSheetSchema.parse(oldSheet());
    expect(parsed.featureUses).toEqual([{ key: "card:bolt-beacon", until: "rest" }]);
    expect(parsed.classState).toEqual({ comboDie: 4 });
    expect(parsed.classState.martial).toBeUndefined();
  });

  it("holds the Martial Artist's stances and Focus (Q5, HF p.12: at most 6 Focus)", () => {
    const martial = { known: ["quick", "reliable"], active: "quick", focus: 6 };
    expect(characterSheetSchema.parse(oldSheet({ classState: { comboDie: 4, martial } })).classState.martial).toEqual(martial);
    expect(classStateSchema.safeParse({ martial: { known: [], focus: 0 } }).success).toBe(true);
    for (const bad of [
      { known: [], focus: 7 },
      { known: [], focus: -1 },
      { known: Array.from({ length: 17 }, (_, i) => `s${"x".repeat(i % 3)}`), focus: 0 },
      { known: ["Quick!"], focus: 1 },
      { known: [], focus: 1.5 },
    ]) {
      expect(classStateSchema.safeParse({ martial: bad }).success).toBe(false);
    }
  });

  it("fits a worst-case sheet's feature uses (FEATURE_USES_MAX, widened from 40)", () => {
    // 13 once-per features of class, subclass, multiclass, heritage and transformation; Gifted Performer's three songs
    // twice each with Virtuoso (CB p.28); five loadout cards with three per-use entries each; a per-target card on six
    // allies (Healing Hands); and D5's own keys.
    const keys = [
      ...Array.from({ length: 13 }, (_, i) => `feat:f${i}`),
      ...["a", "a", "b", "b", "c", "c"].map((song) => `feat:subclass:troubadour:gifted-performer:${song}`),
      ...Array.from({ length: 15 }, (_, i) => `card:c${Math.floor(i / 3)}:u${i % 3}`),
      ...Array.from({ length: 6 }, (_, i) => `card:healing-hands:t${i}`),
      "rally",
      "unstoppable",
      "tagTeam",
      "commune",
      "channelRawPower",
    ];
    expect(keys.length).toBeGreaterThan(40);
    expect(keys.length).toBeLessThanOrEqual(FEATURE_USES_MAX);
    const parsed = characterSheetSchema.parse(oldSheet({ featureUses: keys.map((key) => ({ key, until: "longRest" })) }));
    expect(parsed.featureUses).toHaveLength(keys.length);
    expect(characterSheetSchema.safeParse(oldSheet({ featureUses: Array.from({ length: FEATURE_USES_MAX + 1 }, (_, i) => ({ key: `k${i}`, until: "rest" })) })).success).toBe(false);
  });
});

describe("combat-feature error codes (SD0)", () => {
  it("defines the six codes and maps each to its client message", () => {
    expect(Object.keys(combatFeatureMessages).sort()).toEqual(
      ["FEATURE_COST_UNPAID", "FEATURE_EXHAUSTED", "FEATURE_NEEDS_MAP", "FEATURE_NOT_COMBAT", "FEATURE_NOT_OWNED", "FEATURE_STATE_MISSING"].sort(),
    );
    for (const [code, message] of Object.entries(combatFeatureMessages)) {
      expect(errorMessage(new ConvexError({ code }))).toBe(message);
    }
  });
});

describe("the Sheet button's character (SD0)", () => {
  const id = <T extends TableNames>(s: string) => s as unknown as Id<T>;
  const tokens: SheetTokenRef[] = [
    { _id: id("t1"), kind: "pc", characterId: id("ash"), mine: true },
    { _id: id("t2"), kind: "pc", characterId: id("mira"), mine: false },
  ];

  it("opens a player's own PC, whatever is selected", () => {
    expect(sheetCharacterId("player", tokens, id("t2"))).toBe("ash");
    expect(sheetCharacterId("player", tokens.slice(1), null)).toBeNull();
    expect(sheetCharacterId("player", [], null)).toBeNull();
  });

  it("opens the GM's selected PC token, and nothing for no selection or another token", () => {
    expect(sheetCharacterId("gm", tokens, id("t2"))).toBe("mira");
    expect(sheetCharacterId("gm", tokens, null)).toBeNull();
    expect(sheetCharacterId("gm", tokens, id("adversary-token"))).toBeNull();
    expect(sheetCharacterId("gm", [{ _id: id("t3"), kind: "adversary", mine: false }], id("t3"))).toBeNull();
  });

  it("links the full sheet on the Party page", () => {
    expect(sheetHref(id("c1"), id("ash"))).toBe("/campaigns/c1/party/ash");
  });
});
