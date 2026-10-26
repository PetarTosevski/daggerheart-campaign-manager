import { describe, expect, it } from "vitest";

import { addCard, cardsAllowed, cardTakeProblem, deckDomains, sourcesFor, unlockLevel } from "../../src/lib/domain/level-up/index";
import { DOMAIN_CARDS } from "../../src/lib/srd/domain-cards";

// The Domain Deck rules (DD1) shared by convex/characters.ts takeCard and the sheet's deck.

const card = (domain: string, level: number) => DOMAIN_CARDS.find((c) => c.domain === domain && c.level === level)!;
const CORE = sourcesFor({ allowExpansion: false });
const ALL = sourcesFor({ allowExpansion: true });

function sheet(level: number, owned: string[], extra: Partial<Parameters<typeof cardTakeProblem>[0]> = {}) {
  return { classId: "warrior", level, domainCards: { owned, loadout: owned.slice(0, 5) }, advancements: [], ...extra };
}

describe("domain deck rules", () => {
  it("allows level + 1 cards plus one per additional domain card advancement", () => {
    expect(cardsAllowed({ level: 1 })).toBe(2);
    expect(cardsAllowed({ level: 4, advancements: [{ level: 2, cardId: "x", picks: [{ option: "domainCard", tier: 2, slot: 0 }] }] })).toBe(6);
  });

  it("lists the class domains, then the multiclass domain", () => {
    expect(deckDomains({ classId: "warrior" })).toEqual(["blade", "bone"]);
    expect(deckDomains({ classId: "warrior", multiclass: { classId: "wizard", domainId: "codex", subclassId: "school-of-knowledge" } })).toEqual(["blade", "bone", "codex"]);
  });

  it("unlocks class cards at their level and multiclass cards at twice their level minus one", () => {
    const mc = { classId: "warrior", multiclass: { classId: "wizard", domainId: "codex", subclassId: "school-of-knowledge" } };
    expect(unlockLevel(mc, card("blade", 4))).toBe(4);
    expect(unlockLevel(mc, card("codex", 3))).toBe(5);
    expect(unlockLevel(mc, card("grace", 1))).toBeNull();
  });

  it("gives one reason per refusal, and null for a takeable card", () => {
    const owned = [card("blade", 1).id, card("bone", 1).id];
    expect(cardTakeProblem(sheet(1, owned), card("blade", 2).id, CORE)?.reason).toBe("locked");
    expect(cardTakeProblem(sheet(1, owned), owned[0]!, CORE)?.reason).toBe("owned");
    expect(cardTakeProblem(sheet(1, owned), "nope", CORE)?.reason).toBe("unknown");
    expect(cardTakeProblem(sheet(1, owned), DOMAIN_CARDS.find((c) => c.level === 1 && c.domain === "blade" && c.id !== owned[0])!.id, CORE)?.reason).toBe("full");
    expect(cardTakeProblem(sheet(2, owned), card("blade", 2).id, CORE)).toBeNull();
    expect(cardTakeProblem(sheet(2, owned), card("grace", 1).id, CORE)?.reason).toBe("locked");
  });

  it("treats a card from a source the campaign doesn't use as unknown", () => {
    const dread = DOMAIN_CARDS.find((c) => c.domain === "dread" && c.level === 1)!;
    const mc = sheet(5, [], { multiclass: { classId: "x", domainId: "dread", subclassId: "y" } });
    expect(cardTakeProblem(mc, dread.id, CORE)?.reason).toBe("unknown");
    expect(cardTakeProblem(mc, dread.id, ALL)).toBeNull();
  });

  it("adds into the loadout while it has room, else into the vault", () => {
    expect(addCard({ owned: ["a"], loadout: ["a"] }, "b")).toEqual({ owned: ["a", "b"], loadout: ["a", "b"] });
    const five = ["a", "b", "c", "d", "e"];
    expect(addCard({ owned: five, loadout: five }, "f")).toEqual({ owned: [...five, "f"], loadout: five });
  });
});
