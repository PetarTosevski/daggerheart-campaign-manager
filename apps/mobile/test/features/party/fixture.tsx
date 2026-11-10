import type { ReactElement } from "react";

import { characterSheetSchema } from "../../../../../src/lib/validation/characters";
import type { SheetCharacter } from "../../../src/features/sheet/types";

import { CampaignProvider, CampaignScreen } from "../../../src/shell/campaign-provider";
import { OfflineFrame } from "../../../src/shell/offline";
import { campaignSummary } from "../../harness/records";

export const campaignId = "campaign-1";

export function campaignRecord(role: "gm" | "player") {
  return campaignSummary({
    _id: campaignId,
    frameId: "witherwild",
    name: "The Table",
    role,
    tier: 1,
    level: 1,
    custom: null,
    tome: null,
    options: {
      hopeAndFear: true,
      lessLethal: false,
      transformations: false,
      enduranceCountdowns: false,
      remnantCorruption: false,
      witherPersists: false,
    },
    createdAt: 1,
    lastOpenedAt: 1,
    players: 2,
  });
}

export function characterRecord(overrides: { canEdit: boolean; mine?: boolean; status?: string; name?: string }) {
  return {
    _id: "char-1",
    ownerId: overrides.mine === false ? "player-2" : "player-1",
    status: overrides.status ?? "active",
    mine: overrides.mine ?? overrides.canEdit,
    canEdit: overrides.canEdit,
    portraitUrl: null,
    updatedAt: 1,
    sheet: {
      name: overrides.name ?? "Mira",
      pronouns: "she/her",
      description: "A blade at the gate.",
      level: 1,
      classId: "warrior",
      subclassId: "call-of-the-brave",
      ancestry: { kind: "single", id: "human" },
      communityId: "ridgeborne",
      traits: { agility: 2, strength: 1, finesse: 1, instinct: 0, presence: 0, knowledge: -1 },
      traitMarks: {},
      evasion: 11,
      hp: 2,
      hpMax: 6,
      stress: 1,
      stressMax: 6,
      hope: 2,
      scars: 0,
      hopeSlotBonus: 0,
      armorMarked: 0,
      proficiency: 1,
      primaryWeaponId: "broadsword",
      armorId: "leather-armor",
      inventory: [{ id: "torch", name: "Torch" }],
      gold: { handfuls: 1, bags: 0, chest: false },
      experiences: [{ id: "exp-1", name: "Watch", value: 2 }],
      domainCards: { owned: ["get-back-up"], loadout: ["get-back-up"] },
      background: ["Left the ridge."],
      connections: ["I owe you a debt."],
      notes: "Keep the sword close.",
    },
  };
}

/**
 * `characterRecord` as the typed `charactersReads.get` view the sheet reads: the sheet goes through the website's
 * `characterSheetSchema`, so every defaulted field is filled like a stored sheet.
 */
export function sheetCharacter(
  overrides: Parameters<typeof characterRecord>[0],
  sheet: Record<string, unknown> = {},
  extra: Record<string, unknown> = {},
): SheetCharacter {
  const record = characterRecord(overrides);
  return asSheetCharacter({ ...record, ...extra, sheet: { ...record.sheet, ...sheet } });
}

/** Any character-like record as the typed view (the sheet through `characterSheetSchema`, so defaults are filled). */
export function asSheetCharacter(record: { sheet: Record<string, unknown> } & Record<string, unknown>): SheetCharacter {
  const parsed = characterSheetSchema.parse({ secondaryWeaponId: "", ...record.sheet });
  return { updatedAt: 1, ...record, sheet: parsed } as unknown as SheetCharacter;
}

export const tableRecord = {
  viewer: "player",
  gm: { userId: "gm-1", name: "Ash" },
  players: [{ userId: "player-1", name: "Nikola", joinedAt: 1, coGm: false }],
};

export function inCampaign(role: "gm" | "player", ui: ReactElement, offline = false) {
  return (
    <CampaignProvider campaignId={campaignId}>
      <CampaignScreen>
        <OfflineFrame offline={offline}>{ui}</OfflineFrame>
      </CampaignScreen>
    </CampaignProvider>
  );
}

export function queriesFor(role: "gm" | "player", characters: unknown) {
  return {
    "campaigns:get": campaignRecord(role),
    "charactersReads:listByCampaign": characters,
    "members:roster": tableRecord,
  };
}
