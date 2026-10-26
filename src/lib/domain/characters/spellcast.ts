// The Spellcast trait a character rolls with (CB 111). A multiclass whose foundation card has a Spellcast trait lets
// the player choose that trait or the original subclass's (`multiclass.spellcastTrait`); without an original
// Spellcast trait the new one is forced. Older multiclass data without the choice keeps the original trait.
import { SUBCLASSES } from "../../srd/subclasses";
import type { TraitId } from "../../srd/types";
import type { CharacterSheet } from "../../validation/characters";

/** What multiclassing into a subclass means for the Spellcast trait: nothing new, a forced trait, or a choice of two. */
export type SpellcastOption =
  | { kind: "none"; trait: TraitId | null }
  | { kind: "forced"; trait: TraitId }
  | { kind: "choose"; original: TraitId; added: TraitId };

// CL9: the subclasses leaf module, not the srd/index barrel (it closes over every SRD list).
const getSubclass = (id: string) => SUBCLASSES.find((s) => s.id === id);

const traitOf = (subclassId: string | undefined): TraitId | null => (subclassId ? (getSubclass(subclassId)?.spellcastTrait ?? null) : null);

/** The Spellcast trait choice multiclassing into `subclassId` offers a character of subclass `ownSubclassId`. */
export function multiclassSpellcastOption(ownSubclassId: string, subclassId: string): SpellcastOption {
  const original = traitOf(ownSubclassId);
  const added = traitOf(subclassId);
  if (!added || added === original) return { kind: "none", trait: original };
  if (!original) return { kind: "forced", trait: added };
  return { kind: "choose", original, added };
}

/** The trait stored with the multiclass: the player's pick, else the forced one (undefined when nothing new). */
export function resolvedMulticlassSpellcast(ownSubclassId: string, subclassId: string, picked: TraitId | undefined): TraitId | undefined {
  const option = multiclassSpellcastOption(ownSubclassId, subclassId);
  if (option.kind === "forced") return option.trait;
  if (option.kind === "choose") return picked;
  return undefined;
}

/** Why the picked trait doesn't fit the multiclass (null when it does). */
export function multiclassSpellcastProblem(ownSubclassId: string, subclassId: string, picked: TraitId | undefined): string | null {
  const option = multiclassSpellcastOption(ownSubclassId, subclassId);
  if (option.kind === "choose") {
    if (!picked) return "Choose the Spellcast trait for Spellcast Rolls.";
    if (picked !== option.original && picked !== option.added) return "Choose the Spellcast trait of one of your subclasses.";
    return null;
  }
  if (picked === undefined) return null;
  if (option.kind === "forced") return picked === option.trait ? null : "Without a Spellcast trait before, you must use your new subclass's.";
  return picked === option.trait ? null : "Choose the Spellcast trait of one of your subclasses.";
}

/** The effective Spellcast trait: the multiclass choice, else the original subclass's, else the multiclass's; null without one. */
export function spellcastTraitOf(sheet: Pick<CharacterSheet, "subclassId" | "multiclass">): TraitId | null {
  const original = traitOf(sheet.subclassId);
  const mc = sheet.multiclass;
  if (!mc) return original;
  const added = traitOf(mc.subclassId);
  const picked = mc.spellcastTrait;
  if (picked && (picked === original || picked === added)) return picked;
  return original ?? added;
}
