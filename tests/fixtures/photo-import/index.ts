// Photo-import fixtures (D5 T7): what Claude returns for a photographed level 5
// Warrior sheet with a few typos, an unreadable trait and an unknown card, and
// a valid reviewed draft. No real API calls: tests stub `fetch` with these.

import type { ImportDraft } from "../../../src/lib/import/draft";
import type { SheetReading } from "../../../src/lib/import/sheet-photo";

export const warriorReading: SheetReading = {
  name: "Brenna Ashfall",
  pronouns: "she/her",
  description: "Scarred veteran with a red cloak.",
  level: 5,
  className: "Warior",
  subclassName: "Call of the Brav",
  ancestry: "Dwarf / Elf",
  community: "Ridgeborne",
  traits: { agility: 2, strength: 2, finesse: 1, instinct: null, presence: 0, knowledge: -1 },
  evasion: 11,
  hpMax: 7,
  hpMarked: 2,
  stressMax: 6,
  stressMarked: 1,
  hope: 3,
  armorMarked: 1,
  proficiency: 2,
  primaryWeapon: "Advnced Broadsword",
  secondaryWeapon: "Improved Round Shield",
  armor: "Improved Gambeson",
  experiences: [
    { name: "Sellsword", value: 2 },
    { name: "Mountain Guide", value: null },
  ],
  domainCards: ["Get Back Up", "Whirlwind", "Reckles", "Sword Dance", "Vitality"],
  inventory: ["Torch", "50 feet of rope", "Minor Health Potion"],
  gold: { handfuls: 3, bags: 1, chest: false },
};

/** A Messages API response whose text block is the JSON of `reading`. */
export function messagesResponse(reading: unknown, stopReason = "end_turn") {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5-5",
    stop_reason: stopReason,
    content: [{ type: "text", text: JSON.stringify(reading) }],
    usage: { input_tokens: 1000, output_tokens: 300 },
  };
}

/** A reviewed level 5 Warrior draft that passes `sheetFromImport` in a core campaign. */
export function validDraft(overrides: Partial<ImportDraft> = {}): ImportDraft {
  return {
    name: "Brenna Ashfall",
    pronouns: "she/her",
    description: "",
    level: 5,
    classId: "warrior",
    subclassId: "call-of-the-brave",
    ancestry: { kind: "single", id: "dwarf" },
    communityId: "ridgeborne",
    traits: { agility: 2, strength: 2, finesse: 1, instinct: 1, presence: 0, knowledge: -1 },
    evasion: 11,
    hpMax: 7,
    hp: 2,
    stressMax: 6,
    stress: 1,
    hope: 3,
    armorMarked: 1,
    proficiency: 2,
    primaryWeaponId: "advanced-broadsword",
    secondaryWeaponId: "improved-round-shield",
    armorId: "improved-gambeson-armor",
    gold: { handfuls: 3, bags: 1, chest: false },
    experiences: [
      { name: "Sellsword", value: 2 },
      { name: "Mountain Guide", value: 2 },
    ],
    domainCards: ["get-back-up", "whirlwind", "reckless", "vitality"],
    inventory: ["Torch", "Minor Health Potion"],
    ...overrides,
  };
}
