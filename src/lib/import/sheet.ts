// Builds the stored sheet from a reviewed photo-import draft, with the rules
// checks the server applies (the review screen runs the same checks to keep
// Save disabled). Pure: no framework imports, relative imports only.

import { tierForLevel } from "../domain/characters/index";
import { RuleError } from "../errors/app-error";
import { getAncestry, getArmor, getClass, getCommunity, getDomainCard, getSubclass, getWeapon, type Source } from "../srd/index";
import type { CharacterSheetInput } from "../validation/characters";
import { importDraftSchema, type ImportDraft } from "./draft";

/** The most domain cards in a loadout (CB 101: "a maximum of five active domain cards"). */
const LOADOUT_MAX = 5;

function refuse(message: string): never {
  throw new RuleError("PHOTO_IMPORT_RULE", message);
}

function assertSource(source: Source, allowExpansion: boolean, what: string) {
  if (source === "hope-and-fear" && !allowExpansion) refuse(`${what} is Hope & Fear content, which this campaign doesn't use.`);
}

/**
 * The sheet for a reviewed draft at any level. Checks the class, subclass,
 * heritage and domain cards (from the class's domains, at or below the level),
 * equipment at or below the character's tier (tiers by level, CB 109) with the
 * same hand, class and Spellcast rules as the wizard, and marked HP and Stress
 * within their maximums. Throws a `ZodError` for a malformed draft and a
 * `RuleError` (PHOTO_IMPORT_RULE) for a rules problem.
 */
export function sheetFromImport(input: ImportDraft, allowExpansion: boolean, newId: () => string = () => crypto.randomUUID()): CharacterSheetInput {
  const draft = importDraftSchema.parse(input);
  const cls = getClass(draft.classId);
  if (!cls) refuse("Choose a class.");
  assertSource(cls.source, allowExpansion, cls.name);
  const sub = getSubclass(draft.subclassId);
  if (!sub || sub.classId !== cls.id) refuse("Choose a subclass of the class.");

  const ancestryIds =
    draft.ancestry.kind === "single"
      ? [draft.ancestry.id]
      : draft.ancestry.kind === "mixed"
        ? [draft.ancestry.first, draft.ancestry.second]
        : [draft.ancestry.form];
  for (const id of ancestryIds) {
    const a = getAncestry(id);
    if (!a) refuse("Choose an ancestry.");
    assertSource(a.source, allowExpansion, a.name);
  }
  if (draft.ancestry.kind === "shapeshifter") assertSource("hope-and-fear", allowExpansion, "Shapeshifter");
  if (draft.ancestry.kind === "mixed" && draft.ancestry.first === draft.ancestry.second) refuse("A mixed ancestry needs two different ancestries.");
  const community = getCommunity(draft.communityId);
  if (!community) refuse("Choose a community.");
  assertSource(community.source, allowExpansion, community.name);

  const tier = tierForLevel(draft.level);
  const weapon = (id: string, slot: "primary" | "secondary") => {
    const w = getWeapon(id);
    if (!w || w.slot !== slot) refuse(`Choose a ${slot} weapon.`);
    if (w.tier > tier) refuse(`${w.name} is Tier ${w.tier}; a level ${draft.level} character is Tier ${tier}.`);
    assertSource(w.source, allowExpansion, w.name);
    if (w.classId && w.classId !== cls.id) refuse(`${w.name} belongs to another class.`);
    if (w.category === "magic" && !sub.spellcastTrait) refuse("Magic weapons need a Spellcast trait from the subclass.");
    return w;
  };
  const primary = weapon(draft.primaryWeaponId, "primary");
  if (draft.secondaryWeaponId) {
    weapon(draft.secondaryWeaponId, "secondary");
    if (primary.burden === "two-handed") refuse("A two-handed primary weapon leaves no hand for a secondary.");
    if (primary.burden === "barehanded") refuse(`${primary.name} can't be used with other weapons.`);
  }
  if (draft.armorId) {
    const a = getArmor(draft.armorId);
    if (!a) refuse("Choose armor.");
    if (a.tier > tier) refuse(`${a.name} is Tier ${a.tier}; a level ${draft.level} character is Tier ${tier}.`);
    assertSource(a.source, allowExpansion, a.name);
  }

  const domains = new Set<string>(cls.domains);
  for (const id of draft.domainCards) {
    const card = getDomainCard(id);
    if (!card || !domains.has(card.domain)) refuse("Domain cards must come from the class's domains.");
    if (card.level > draft.level) refuse(`${card.name} is a level ${card.level} card.`);
    assertSource(card.source, allowExpansion, card.name);
  }
  if (new Set(draft.domainCards).size !== draft.domainCards.length) refuse("Each domain card can be taken once.");
  if (draft.hp > draft.hpMax) refuse("Marked Hit Points can't exceed the maximum.");
  if (draft.stress > draft.stressMax) refuse("Marked Stress can't exceed the maximum.");

  return {
    name: draft.name,
    pronouns: draft.pronouns,
    description: draft.description,
    level: draft.level,
    classId: cls.id,
    subclassId: sub.id,
    ancestry: draft.ancestry,
    communityId: community.id,
    ...(draft.ancestry.kind === "shapeshifter" ? { transformationId: "shapeshifter" } : {}),
    traits: draft.traits,
    traitMarks: {},
    evasion: draft.evasion,
    hpMax: draft.hpMax,
    hp: draft.hp,
    stressMax: draft.stressMax,
    stress: draft.stress,
    hope: draft.hope,
    scars: 0,
    armorMarked: draft.armorMarked,
    proficiency: draft.proficiency,
    primaryWeaponId: primary.id,
    ...(draft.secondaryWeaponId ? { secondaryWeaponId: draft.secondaryWeaponId } : {}),
    ...(draft.armorId ? { armorId: draft.armorId } : {}),
    inventory: draft.inventory.map((name) => ({ id: newId(), name })),
    gold: draft.gold,
    experiences: draft.experiences.map((e) => ({ id: newId(), ...e })),
    domainCards: { owned: [...draft.domainCards], loadout: draft.domainCards.slice(0, LOADOUT_MAX) },
    background: [],
    connections: [],
    notes: "",
  };
}

/** The first problem with a draft as a message, or null when it would save. For the review screen. */
export function importProblem(draft: ImportDraft, allowExpansion: boolean): string | null {
  try {
    sheetFromImport(draft, allowExpansion, () => "check");
    return null;
  } catch (error) {
    if (error instanceof RuleError) return error.message;
    if (error instanceof Error && error.name === "ZodError") {
      const issue = (error as Error & { issues?: { path: PropertyKey[]; message: string }[] }).issues?.[0];
      return issue ? `${issue.path.map(String).join(".") || "draft"}: ${issue.message}` : "Check the sheet.";
    }
    throw error;
  }
}
