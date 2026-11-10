/**
 * Complete query records for fixtures: every field the Convex `returns` validator requires, with neutral values, so
 * a test states only the fields it is about (`campaignSummary({ role: "gm" })`). Nested `options`, `settings` and
 * `sheet` merge field by field. These keep fixtures matching the server (`known-stale-fixtures.ts` may only shrink).
 */
import { resolveTableSettings } from "../../../../src/lib/config/campaign-settings";
import { resolveRuleModes } from "../../../../src/lib/rules/resolve";

type Fields = Record<string, unknown>;

const CAMPAIGN_OPTIONS = {
  hopeAndFear: true,
  lessLethal: false,
  transformations: false,
  enduranceCountdowns: false,
  remnantCorruption: false,
  witherPersists: false,
};

/** `campaigns:get` (and, with `fear`, a `campaigns:list` row). */
export function campaignSummary<T extends Fields>(fields: T) {
  const { options, settings, ...rest } = fields as Fields & { options?: Fields; settings?: Fields };
  return {
    _id: "campaign-1",
    frameId: "witherwild",
    name: "The Table",
    tier: 1,
    level: 1,
    custom: null,
    tome: null,
    createdAt: 1,
    lastOpenedAt: 1,
    players: 2,
    role: "gm",
    archived: false,
    isCreator: (fields as Fields).role !== "player",
    ownerView: false,
    ...rest,
    options: { ...CAMPAIGN_OPTIONS, ...(options ?? {}) },
    settings: { ...resolveTableSettings(undefined), ...(settings ?? {}) },
  } as unknown as Omit<T, "options" | "settings"> & Fields;
}

/** A `campaigns:list` row: the summary without `ownerView`, plus the card's Fear. */
export function campaignListRow<T extends Fields>(fields: T) {
  const { ownerView: _ownerView, ...row } = campaignSummary({ fear: 0, ...fields }) as Fields;
  return row as unknown as T & Fields;
}

/** `ruleSettings:get`: the frame's resolved modes (every rule), with `modes` overriding. */
export function ruleSettingsRecord(modes: Fields = {}, extra: { locked?: boolean; canEdit?: boolean } = {}) {
  return {
    modes: { ...resolveRuleModes("witherwild", null), ...modes },
    locked: false,
    canEdit: false,
    ...extra,
  };
}

/** A character sheet with every required field. */
export function sheetRecord(fields: Fields = {}) {
  return {
    name: "Mira",
    pronouns: "",
    description: "",
    level: 1,
    classId: "guardian",
    subclassId: "stalwart",
    ancestry: { kind: "single", id: "human" },
    communityId: "highborne",
    traits: { agility: 0, strength: 0, finesse: 0, instinct: 0, presence: 0, knowledge: 0 },
    traitMarks: {},
    evasion: 10,
    hpMax: 6,
    hp: 0,
    stressMax: 6,
    stress: 0,
    hope: 2,
    scars: 0,
    armorMarked: 0,
    proficiency: 1,
    primaryWeaponId: "",
    inventory: [],
    gold: { handfuls: 0, bags: 0, chest: false },
    experiences: [],
    domainCards: { owned: [], loadout: [] },
    background: [],
    connections: [],
    notes: "",
    ...fields,
  };
}

/** A `charactersReads:listByCampaign` row (and `charactersReads:get`). */
export function characterRow<T extends Fields>(fields: T) {
  const { sheet, ...rest } = fields as Fields & { sheet?: Fields };
  return {
    _id: "char-1",
    ownerId: "user-1",
    status: "active",
    portraitUrl: null,
    canEdit: false,
    mine: false,
    updatedAt: 1,
    ...rest,
    sheet: sheetRecord(sheet ?? {}),
  } as unknown as T & Fields;
}

const SUMMARY_SHEET_KEYS = [
  "name",
  "level",
  "classId",
  "subclassId",
  "ancestry",
  "communityId",
  "portrait",
  "hp",
  "hpMax",
  "stress",
  "stressMax",
  "hope",
  "scars",
  "armorMarked",
  "hopeSlotBonus",
  "levelUpPending",
  "conditions",
  "wither",
  "journeyEnds",
] as const;

/** A `charactersReads:partySummary` row: the summary's slice of the sheet. */
export function partySummaryRow<T extends Fields>(fields: T) {
  const { sheet, benched, corrupt, ...rest } = fields as Fields & { sheet?: Fields; benched?: boolean; corrupt?: boolean };
  const full = sheetRecord(sheet ?? {}) as Fields;
  const slice: Fields = {};
  for (const key of SUMMARY_SHEET_KEYS) if (full[key] !== undefined) slice[key] = full[key];
  return {
    _id: "char-1",
    status: "active",
    portraitUrl: null,
    canEdit: false,
    ...(benched ? { benched: true } : {}),
    ...(corrupt ? { corrupt: true } : {}),
    ...rest,
    sheet: slice,
  } as unknown as T & Fields;
}
