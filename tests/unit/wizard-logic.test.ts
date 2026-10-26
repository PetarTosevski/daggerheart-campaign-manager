import { describe, expect, it } from "vitest";

import {
  assignTrait,
  availableAncestries,
  availableClasses,
  canReach,
  classItemsFor,
  domainCardOptions,
  emptyWizard,
  incompleteSteps,
  missingByStep,
  normalizeWizard,
  portraitAsset,
  primaryWeaponsFor,
  restoreWizard,
  stillNeeded,
  suggestedLoadout,
  suggestedTraits,
  toCharacterDraft,
  toggleCard,
  toggleExperience,
  type WizardState,
} from "@/app/(gm)/campaigns/[campaignId]/party/new/wizard-logic";
import { getClass, PORTRAITS } from "@/lib/srd";
import { characterDraftSchema } from "@/lib/validation/characters";

const CORE = { hopeAndFear: false };
const ALL = { hopeAndFear: true };

function completeGuardian(): WizardState {
  return {
    ...emptyWizard(),
    classId: "guardian",
    subclassId: "stalwart",
    ancestryMode: "single",
    ancestryId: "dwarf",
    communityId: "ridgeborne",
    traits: { agility: 1, strength: 2, finesse: -1, instinct: 0, presence: 1, knowledge: 0 },
    name: "Brakka",
    primaryWeaponId: "battleaxe",
    armorId: "chainmail-armor",
    potion: "Minor Health Potion",
    classItem: classItemsFor(getClass("guardian"))[0],
    experiences: ["Bodyguard", "Stubborn"],
    domainCards: domainCardOptions("guardian", CORE)
      .slice(0, 2)
      .map((c) => c.id),
  };
}

describe("wizard step gating", () => {
  it("lists what each empty step still needs, in the board's words", () => {
    const missing = missingByStep(emptyWizard());
    expect(missing[1]).toEqual(["a class"]);
    expect(missing[2]).toEqual(["an ancestry", "a community"]);
    expect(missing[3]).toEqual(["all six trait modifiers"]);
    expect(missing[4]).toEqual(["a name"]);
    expect(missing[5]).toEqual(["a primary weapon", "armor", "a potion"]);
    expect(missing[6]).toEqual([]);
    expect(missing[7]).toEqual(["a first Experience", "a second Experience"]);
    expect(missing[8]).toEqual(["2 more domain cards"]);
    expect(missing[9]).toEqual([]);
  });

  it("asks for a subclass once a class is chosen, and a class item for classes that have them", () => {
    const s = { ...emptyWizard(), classId: "bard" };
    const missing = missingByStep(s);
    expect(missing[1]).toEqual(["a subclass"]);
    expect(missing[5]).toContain("a class item");
  });

  it("mixed and shapeshifter ancestries need their parts", () => {
    expect(missingByStep({ ...emptyWizard(), ancestryMode: "mixed", mixedFirst: "elf" })[2]).toEqual([
      "a second ancestry",
      "a community",
    ]);
    expect(missingByStep({ ...emptyWizard(), ancestryMode: "shapeshifter", shapeForm: "elf" })[2]).toEqual([
      "a form feature",
      "a community",
    ]);
  });

  it("formats the Still needed line", () => {
    expect(stillNeeded([])).toBe("");
    expect(stillNeeded(["a name"])).toBe("Still needed: a name");
    expect(stillNeeded(["a primary weapon", "armor", "a potion"])).toBe("Still needed: a primary weapon, armor and a potion");
  });

  it("only reaches a step when every earlier step is complete", () => {
    const missing = missingByStep(completeGuardian());
    expect(incompleteSteps(missing)).toEqual([]);
    expect(canReach(10, missing)).toBe(true);
    const partial = missingByStep({ ...completeGuardian(), name: " " });
    expect(canReach(4, partial)).toBe(true);
    expect(canReach(5, partial)).toBe(false);
    expect(incompleteSteps(partial)).toEqual(["Character Info"]);
  });
});

describe("wizard choices", () => {
  it("assigns trait modifiers from the pool, swapping when every copy is used", () => {
    let t = assignTrait({}, "agility", 2);
    t = assignTrait(t, "strength", 2);
    expect(t).toEqual({ strength: 2 });
    t = assignTrait({ agility: 2, strength: 1 }, "strength", 2);
    expect(t).toEqual({ agility: 1, strength: 2 });
    t = assignTrait({ agility: 1, strength: 1 }, "finesse", 1);
    expect(t).toEqual({ strength: 1, finesse: 1 });
  });

  it("toggles Experience examples into the first empty slot", () => {
    expect(toggleExperience(["", ""], "Bodyguard")).toEqual(["Bodyguard", ""]);
    expect(toggleExperience(["Bodyguard", ""], "Thief")).toEqual(["Bodyguard", "Thief"]);
    expect(toggleExperience(["Bodyguard", "Thief"], "Bodyguard")).toEqual(["", "Thief"]);
    expect(toggleExperience(["Bodyguard", "Thief"], "Sailor")).toEqual(["Bodyguard", "Sailor"]);
  });

  it("allows at most two domain cards", () => {
    expect(toggleCard(["a", "b"], "c")).toEqual(["a", "b"]);
    expect(toggleCard(["a", "b"], "a")).toEqual(["b"]);
  });

  it("hides Hope & Fear classes and ancestries when the option is off", () => {
    expect(availableClasses(CORE).map((c) => c.id)).not.toContain("witch");
    expect(availableClasses(ALL).map((c) => c.id)).toContain("witch");
    expect(availableAncestries(CORE).map((a) => a.id)).not.toContain("gnome");
  });

  it("offers magic weapons only with a Spellcast trait, and class weapons only to their class", () => {
    const stalwart = primaryWeaponsFor({ classId: "guardian", subclassId: "stalwart" }, ALL);
    expect(stalwart.some((w) => w.category === "magic")).toBe(false);
    expect(stalwart.some((w) => w.id === "brawler-s-strike")).toBe(false);
    const wizard = primaryWeaponsFor({ classId: "wizard", subclassId: "school-of-knowledge" }, CORE);
    expect(wizard.some((w) => w.category === "magic")).toBe(true);
  });

  it("suggests the class's traits and loadout", () => {
    expect(Object.values(suggestedTraits("bard") ?? {}).sort()).toEqual([-1, 0, 0, 1, 1, 2]);
    const loadout = suggestedLoadout({ ...emptyWizard(), classId: "bard", subclassId: "troubadour" }, CORE);
    expect(loadout).toEqual({ primaryWeaponId: "rapier", secondaryWeaponId: "small-dagger", armorId: "gambeson-armor" });
  });
});

describe("normalizing and submitting", () => {
  it("drops choices that no longer fit after a class change", () => {
    const s = normalizeWizard({ ...completeGuardian(), classId: "bard" }, CORE);
    expect(s.subclassId).toBeNull();
    expect(s.domainCards).toEqual([]);
    expect(s.classItem).toBeNull();
  });

  it("drops a secondary weapon with a two-handed primary", () => {
    const s = normalizeWizard({ ...completeGuardian(), primaryWeaponId: "greatsword", secondaryWeaponId: "round-shield" }, CORE);
    expect(s.secondaryWeaponId).toBeNull();
  });

  it("drops a shapeshifter ancestry when Hope & Fear is off", () => {
    const s = normalizeWizard({ ...completeGuardian(), ancestryMode: "shapeshifter", shapeForm: "elf" }, CORE);
    expect(s.ancestryMode).toBeNull();
  });

  it("builds a draft the server schema accepts", () => {
    const s = normalizeWizard(completeGuardian(), CORE);
    const draft = toCharacterDraft(s, portraitAsset(s));
    expect(characterDraftSchema.safeParse(draft).success).toBe(true);
    expect(draft.portrait).toEqual({ kind: "asset", asset: PORTRAITS["sub-stalwart"].asset });
    expect(draft.secondaryWeaponId).toBeUndefined();
  });

  it("honours a chosen or removed portrait", () => {
    const s = normalizeWizard({ ...completeGuardian(), portrait: "anc-dwarf" }, CORE);
    expect(portraitAsset(s)).toBe(PORTRAITS["anc-dwarf"].asset);
    expect(portraitAsset({ ...s, portrait: "none" })).toBeNull();
    expect(normalizeWizard({ ...s, portrait: "anc-elf" }, CORE).portrait).toBeNull();
  });

  it("restores a stored draft defensively", () => {
    expect(restoreWizard(null)).toEqual(emptyWizard());
    const r = restoreWizard({ step: 42, name: 7, traits: { agility: 2, strength: 9 }, experiences: ["Sailor"] });
    expect(r.step).toBe(9);
    expect(r.name).toBe("");
    expect(r.traits).toEqual({ agility: 2 });
    expect(r.experiences).toEqual(["Sailor", ""]);
  });
});
