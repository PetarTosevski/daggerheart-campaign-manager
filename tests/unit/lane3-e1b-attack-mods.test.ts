/**
 * Plan lanes-2 wave 9, E1.3b (dcm-jkhp, dcm-xbtw): what the Attack bar reads from the sheet. Versatile Fighter (CB p.330):
 * "You can use a different character trait for an equipped weapon". Parallela (CB p.332): "they can hit an additional
 * target". Spirit Weapon (CB p.44): "an equipped weapon with a range of Melee or Very Close".
 */
import { describe, expect, it } from "vitest";

import { extraTargets, offersSpiritWeapon, picksTrait, sheetMods } from "@/components/combat-map/actions/attack/mods";
import { getWeapon } from "@/lib/srd/index";

const sheet = (patch: Record<string, unknown> = {}) =>
  ({ classId: "warrior", subclassId: "call-of-the-brave", subclassRank: "foundation", ancestry: { kind: "single", id: "human" }, communityId: "highborne", classState: {}, domainCards: { owned: [], loadout: [] }, effects: [], ...patch }) as never;

describe("Attack bar mods", () => {
  it("Versatile Fighter in the loadout lets the player pick the trait for either weapon", () => {
    expect(picksTrait(sheetMods(sheet()), "primary")).toBe(false);
    const mods = sheetMods(sheet({ domainCards: { owned: ["versatile-fighter"], loadout: ["versatile-fighter"] } }));
    expect(picksTrait(mods, "primary")).toBe(true);
    expect(picksTrait(mods, "secondary")).toBe(true);
  });

  it("Parallela on the sheet gives one extra target", () => {
    expect(extraTargets(sheetMods(sheet()))).toBe(0);
    // Parallela is a spell of the Book of Sitil (Codex); its effect on the bearer's sheet is `card:book-of-sitil:n`.
    const mods = sheetMods(sheet({ effects: [{ id: "card:book-of-sitil:1", source: "Book of Sitil", text: "Parallela", until: "manual" }] }));
    expect(extraTargets(mods)).toBe(1);
  });

  it("the Spirit Weapon box shows for a Divine Wielder with a Melee / Very Close weapon only", () => {
    const wielder = sheet({ classId: "seraph", subclassId: "divine-wielder" });
    expect(offersSpiritWeapon(wielder, getWeapon("broadsword")!)).toBe(true);
    expect(offersSpiritWeapon(wielder, getWeapon("longbow")!)).toBe(false);
    expect(offersSpiritWeapon(sheet(), getWeapon("broadsword")!)).toBe(false);
  });
});
