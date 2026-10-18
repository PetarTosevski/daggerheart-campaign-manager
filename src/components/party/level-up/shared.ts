import { characterSheetSchema, type CharacterSheet } from "@/lib/validation/characters";
import type { AdvancementOption } from "@/lib/validation/characters";
import type { Source, TraitId } from "@/lib/srd/types";

import type { CharacterView } from "../../../../convex/characters";

/** The view's sheet with every D5 default filled in, or null for a placeholder (corrupt) sheet. */
export function fullSheet(view: CharacterView): CharacterSheet | null {
  if (view.corrupt) return null;
  const parsed = characterSheetSchema.safeParse(view.sheet);
  return parsed.success ? parsed.data : null;
}

export const sourcesFor = (hopeAndFear: boolean): Source[] => (hopeAndFear ? ["core", "hope-and-fear"] : ["core"]);

export const traitLabel = (t: TraitId | string) => t.charAt(0).toUpperCase() + t.slice(1);

/** Short option names for buttons and the tier grid. */
export const OPTION_SHORT: Record<AdvancementOption, string> = {
  traits: "+1 to two unmarked traits",
  hp: "+1 Hit Point slot",
  stress: "+1 Stress slot",
  experiences: "+1 to two Experiences",
  domainCard: "Extra domain card",
  evasion: "+1 Evasion",
  subclass: "Upgraded subclass card",
  proficiency: "+1 Proficiency (both picks)",
  multiclass: "Multiclass (both picks)",
  comboDie: "Combo Die one step larger",
};

/** The board's option text in the tier boxes (Party.dc.html baseOpts / highOpts). */
export const OPTION_TEXT: Record<AdvancementOption, string> = {
  traits: "Gain a +1 bonus to two unmarked character traits and mark them.",
  hp: "Permanently gain one Hit Point slot.",
  stress: "Permanently gain one Stress slot.",
  experiences: "Permanently gain a +1 bonus to two Experiences.",
  domainCard: "Choose an additional domain card of your level or lower from a domain you have access to.",
  evasion: "Permanently gain a +1 bonus to your Evasion.",
  subclass: "Take an upgraded subclass card. Then cross out the multiclass option for this tier.",
  proficiency: "Increase your Proficiency by +1.",
  multiclass:
    "Multiclass: Choose an additional class for your character, then cross out an unused “Take an upgraded subclass card” and the other multiclass option on this sheet.",
  comboDie: "Increase your Combo Die by one step.",
};
