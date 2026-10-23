import { describe, expect, it } from "vitest";

import { activeBeastformId, holdingsFor, owned } from "@/lib/domain/feature-effects/owned";
import { CLASSES } from "@/lib/srd/classes";
import { FEATURE_CLASSIFICATION } from "@/lib/srd/feature-effects/classification";
import { SUBCLASSES } from "@/lib/srd/subclasses";
import { sheetOf } from "./fixtures";

// Plan sheet-drawer, SD1: which features a sheet holds. Book: CB p.110-111 (subclass cards by rank; multiclass: "gain
// access to their class feature … choose a foundation card from a subclass of your choice"; no second Hope feature),
// CB p.71 (mixed ancestry: "the first feature from one ancestry and the second from another"), HF p.38 (Only Skin Deep:
// "only one of your chosen ancestry's features"), Q10 (Beastform features while transformed), Q11 (transformations),
// Q5 (known stances), the campaign's Hope & Fear option.

const ids = (list: ReturnType<typeof owned>) => list.map((f) => f.featureId);

describe("class, Hope feature and subclass cards", () => {
  it("a Stalwart Guardian at foundation: the Hope feature, the class feature, the foundation card only", () => {
    const list = owned(sheetOf("guardian", "stalwart", { communityId: "orderborne" }));
    expect(ids(list)).toEqual([
      "hope:guardian",
      "class:guardian:unstoppable",
      "subclass:stalwart:unwavering",
      "subclass:stalwart:iron-will",
      "ancestry:elf:quick-reactions",
      "ancestry:elf:celestial-trance",
      "community:orderborne:dedicated",
    ]);
    expect(list[0]).toMatchObject({ source: "hope", owner: "guardian", name: "Frontline Tank", usage: "combat" });
    expect(list[2]).toMatchObject({ card: "foundation", usage: "passive" });
  });

  it("specialization adds its card; mastery adds both upgraded cards (CB p.110)", () => {
    const spec = ids(owned(sheetOf("guardian", "stalwart", { subclassRank: "specialization" })));
    expect(spec).toContain("subclass:stalwart:unrelenting");
    expect(spec).not.toContain("subclass:stalwart:undaunted");
    const mastery = ids(owned(sheetOf("guardian", "stalwart", { subclassRank: "mastery" })));
    expect(mastery).toEqual(expect.arrayContaining(["subclass:stalwart:unrelenting", "subclass:stalwart:partners-in-arms", "subclass:stalwart:undaunted", "subclass:stalwart:loyal-protector"]));
  });

  it("a multiclass gives its class features and its subclass foundation, never its Hope feature (CB p.111)", () => {
    const sheet = sheetOf("guardian", "stalwart", { level: 5, subclassRank: "mastery", multiclass: { classId: "bard", subclassId: "troubadour", domainId: "grace" } });
    const list = owned(sheet);
    expect(ids(list)).toContain("class:bard:rally");
    expect(ids(list)).not.toContain("hope:bard");
    expect(ids(list)).toContain("subclass:troubadour:gifted-performer");
    expect(ids(list)).not.toContain("subclass:troubadour:maestro");
    expect(ids(list)).not.toContain("subclass:troubadour:virtuoso");
    expect(list.find((f) => f.featureId === "class:bard:rally")).toMatchObject({ multiclass: true });
    expect(list.find((f) => f.featureId === "subclass:troubadour:gifted-performer")).toMatchObject({ multiclass: true, card: "foundation" });
  });

  it("every class and subclass, at every rank, yields only classified features", () => {
    for (const c of CLASSES) {
      for (const subclassId of c.subclasses) {
        for (const subclassRank of ["foundation", "specialization", "mastery"] as const) {
          for (const f of owned(sheetOf(c.id, subclassId, { subclassRank }))) expect(FEATURE_CLASSIFICATION[f.featureId], f.featureId).toBeDefined();
        }
        const sub = SUBCLASSES.find((s) => s.id === subclassId)!;
        const held = owned(sheetOf(c.id, subclassId, { subclassRank: "mastery" })).filter((f) => f.source === "subclass");
        expect(held).toHaveLength(sub.foundation.length + sub.specialization.length + sub.mastery.length);
      }
    }
  });
});

describe("heritage", () => {
  it("a single ancestry has both features; a mixed one the first of `first` and the second of `second` (CB p.71)", () => {
    const mixed = ids(owned(sheetOf("guardian", "stalwart", { ancestry: { kind: "mixed", first: "elf", second: "dwarf", name: "Elf-dwarf" } })));
    expect(mixed).toContain("ancestry:elf:quick-reactions");
    expect(mixed).toContain("ancestry:dwarf:increased-fortitude");
    expect(mixed).not.toContain("ancestry:elf:celestial-trance");
    expect(mixed).not.toContain("ancestry:dwarf:thick-skin");
  });

  it("a shapeshifter holds only the chosen form feature (HF p.38), plus the transformation's features (Q11)", () => {
    const sheet = sheetOf("guardian", "stalwart", { ancestry: { kind: "shapeshifter", form: "dwarf", feature: "Thick Skin" }, transformationId: "shapeshifter" });
    const list = ids(owned(sheet));
    expect(list.filter((id) => id.startsWith("ancestry:"))).toEqual(["ancestry:dwarf:thick-skin"]);
    expect(list).toEqual(expect.arrayContaining(["transformation:shapeshifter:change-shape", "transformation:shapeshifter:only-skin-deep"]));
  });

  it("a vampire's transformation features (Q11)", () => {
    expect(ids(owned(sheetOf("guardian", "stalwart", { transformationId: "vampire" })))).toEqual(expect.arrayContaining(["transformation:vampire:fangs", "transformation:vampire:feed"]));
  });

  it("Dedicated comes only with the Orderborne community (Q13 note)", () => {
    expect(ids(owned(sheetOf("guardian", "stalwart")))).not.toContain("community:orderborne:dedicated");
    expect(ids(owned(sheetOf("guardian", "stalwart", { communityId: "orderborne" })))).toContain("community:orderborne:dedicated");
  });
});

describe("Beastform (Q10) and stances (Q5)", () => {
  const transformed = sheetOf("druid", "warden-of-the-elements", {
    effects: [{ id: "beastform", source: "Beastform", text: "Agile Scout: +2 Evasion, +1 agility. Can't use weapons …", until: "manual" }],
  });

  it("while transformed the form's features are held; the effect names the form", () => {
    expect(activeBeastformId(transformed)).toBe("agile-scout");
    expect(ids(owned(transformed))).toEqual(expect.arrayContaining(["beastform:agile-scout:agile", "beastform:agile-scout:fragile"]));
    expect(activeBeastformId(sheetOf("druid", "warden-of-the-elements"))).toBeNull();
    // The scope overrides the sheet.
    expect(ids(owned(transformed, { beastformId: null })).some((id) => id.startsWith("beastform:"))).toBe(false);
    expect(ids(owned(sheetOf("druid", "warden-of-the-elements"), { beastformId: "household-friend" }))).toContain("beastform:household-friend:companion");
  });

  it("the known stances, as stance features (HF p.12)", () => {
    const sheet = sheetOf("brawler", "martial-artist", { classState: { martial: { known: ["quick", "honed"], focus: 2 } } });
    const list = owned(sheet).filter((f) => f.source === "stance");
    expect(list.map((f) => f.featureId)).toEqual(["stance:martial-artist:quick", "stance:martial-artist:honed"]);
    expect(list[0]).toMatchObject({ owner: "martial-artist", name: "Quick", usage: "combat" });
  });
});

describe("Hope & Fear content only with the campaign's option", () => {
  it("drops Hope & Fear classes, subclasses, heritage, transformations and stances when the option is off", () => {
    const sheet = sheetOf("brawler", "martial-artist", {
      ancestry: { kind: "single", id: "aetheris" },
      communityId: "duneborne",
      transformationId: "vampire",
      classState: { martial: { known: ["quick"], focus: 0 } },
    });
    expect(owned(sheet, { hopeAndFear: false })).toEqual([]);
    expect(owned(sheet).length).toBeGreaterThan(5);
    // Core content stays.
    expect(ids(owned(sheetOf("guardian", "stalwart"), { hopeAndFear: false }))).toContain("hope:guardian");
  });
});

describe("holdingsFor", () => {
  it("the primary subclass reads its rank; any other owner (a multiclass) holds only the foundation", () => {
    const sheet = sheetOf("guardian", "stalwart", { subclassRank: "mastery", level: 7 });
    const held = owned(sheet);
    expect(holdingsFor(sheet, held, "stalwart")).toMatchObject({ rank: "mastery", level: 7 });
    expect(holdingsFor(sheet, held, "troubadour").rank).toBe("foundation");
    expect(holdingsFor(sheet, held).featureIds.has("subclass:stalwart:undaunted")).toBe(true);
  });
});
