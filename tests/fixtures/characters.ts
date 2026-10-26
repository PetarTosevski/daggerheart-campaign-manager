import { ANCESTRIES, ARMOR, COMMUNITIES, cardsForDomains, getClass, subclassesForClass, WEAPONS } from "../../src/lib/srd/index";
import type { CharacterDraft } from "../../src/lib/validation/characters";

/**
 * A valid level-1 creation-wizard draft (TE3: shared character drafts live in tests/fixtures): the class's first
 * subclass, a core ancestry and community, a tier-1 core physical primary weapon and armor, and the class's first two
 * level-1 domain cards. The same draft most tests/convex files build locally; new tests import it from here.
 */
export function characterDraft(name: string, classId = "warrior"): CharacterDraft {
  const cls = getClass(classId);
  if (cls === undefined) throw new Error(`Unknown class ${classId}.`);
  return {
    classId: cls.id,
    subclassId: subclassesForClass(classId)[0]!.id,
    ancestry: { kind: "single", id: ANCESTRIES.find((a) => a.source === "core")!.id },
    communityId: COMMUNITIES.find((c) => c.source === "core")!.id,
    traits: { agility: 2, strength: 1, finesse: 1, instinct: 0, presence: 0, knowledge: -1 },
    name,
    pronouns: "",
    description: "",
    primaryWeaponId: WEAPONS.find((w) => w.slot === "primary" && w.tier === 1 && w.source === "core" && w.category === "physical" && !w.classId)!.id,
    armorId: ARMOR.find((a) => a.source === "core" && a.tier === 1)!.id,
    potion: "Minor Health Potion",
    classItem: "",
    background: [],
    experiences: ["Sellsword", "Lockpick"],
    domainCards: cardsForDomains(cls.domains, 1)
      .filter((c) => c.level === 1)
      .slice(0, 2)
      .map((c) => c.id),
    connections: [],
  };
}
