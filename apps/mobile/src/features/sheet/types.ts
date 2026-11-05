import {
  characterSheetSchema,
  type CharacterSheet,
} from "../../../../../src/lib/validation/characters";

import type { Id } from "../../convex";

export type TraitScores = {
  agility: number;
  strength: number;
  finesse: number;
  instinct: number;
  presence: number;
  knowledge: number;
};

export type Resource = "hp" | "stress" | "hope" | "armor" | "scars";

export type Ancestry =
  | { kind: "single"; id: string }
  | { kind: "mixed"; first: string; second: string; name: string }
  | { kind: "shapeshifter"; form: string; feature: string };

export type SheetStatus = "active" | "dead" | "retired" | "away";

export type SheetData = {
  name: string;
  pronouns: string;
  pronounsLabel?: "pronouns" | "gender";
  description: string;
  level: number;
  classId: string;
  subclassId: string;
  subclassRank?: "foundation" | "specialization" | "mastery";
  ancestry: Ancestry;
  communityId: string;
  traits: TraitScores;
  traitMarks: Record<string, number>;
  evasion: number;
  hp: number;
  hpMax: number;
  stress: number;
  stressMax: number;
  hope: number;
  scars: number;
  hopeSlotBonus: number;
  armorMarked: number;
  proficiency: number;
  primaryWeaponId: string;
  secondaryWeaponId?: string;
  armorId?: string;
  inventory: { id: string; name: string }[];
  gold: { handfuls: number; bags: number; chest: boolean };
  experiences: { id: string; name: string; value: number }[];
  domainCards: { owned: string[]; loadout: string[] };
  background: string[];
  connections: string[];
  notes: string;
  levelUpPending?: boolean;
  multiclass?: { classId: string; domainId: string; subclassId: string; spellcastTrait?: string };
} & Partial<
  Pick<
    CharacterSheet,
    | "conditions"
    | "effects"
    | "heldDice"
    | "featureUses"
    | "classState"
    | "sessionFeatures"
    | "advancements"
    | "wither"
    | "journeyEnds"
    | "slotBonuses"
    | "cardTokens"
  >
>;

/** The fields the roster and the sheet read from `characters.listByCampaign` and `characters.get`. */
export type SheetCharacter = {
  _id: Id<"characters">;
  ownerId: string;
  status: SheetStatus;
  away?: { reason: string; note?: string };
  benched?: boolean;
  mine: boolean;
  canEdit: boolean;
  portraitUrl: string | null;
  corrupt?: boolean;
  sheet: SheetData;
};

export type PartyTable = {
  gm: { userId: string; name: string };
  players: { userId: string; name: string }[];
};

export type OpenRest = { kind: "short" | "long"; moves: readonly string[] } | null;

function record(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function whole(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function ancestry(value: unknown): Ancestry | null {
  const row = record(value);
  if (!row) return null;
  if (row.kind === "single" && typeof row.id === "string") return { kind: "single", id: row.id };
  if (row.kind === "mixed" && typeof row.first === "string" && typeof row.second === "string") {
    return {
      kind: "mixed",
      first: row.first,
      second: row.second,
      name: text(row.name),
    };
  }
  if (row.kind === "shapeshifter" && typeof row.form === "string") {
    return { kind: "shapeshifter", form: row.form, feature: text(row.feature) };
  }
  return null;
}

function inventory(value: unknown): { id: string; name: string }[] {
  if (!Array.isArray(value)) return [];
  const items: { id: string; name: string }[] = [];
  for (const [index, item] of value.entries()) {
    if (typeof item === "string" && item.length > 0) {
      items.push({ id: `item-${index}`, name: item });
      continue;
    }
    const row = record(item);
    if (!row || typeof row.name !== "string" || row.name.length === 0) continue;
    items.push({ id: typeof row.id === "string" ? row.id : `item-${index}`, name: row.name });
  }
  return items;
}

function experiences(value: unknown): SheetData["experiences"] {
  if (!Array.isArray(value)) return [];
  const rows: SheetData["experiences"] = [];
  for (const [index, item] of value.entries()) {
    const row = record(item);
    if (!row || typeof row.name !== "string") continue;
    rows.push({
      id: typeof row.id === "string" ? row.id : `experience-${index}`,
      name: row.name,
      value: whole(row.value, 2),
    });
  }
  return rows;
}

function numbers(value: unknown): Record<string, number> {
  const row = record(value);
  if (!row) return {};
  const out: Record<string, number> = {};
  for (const [key, item] of Object.entries(row)) {
    if (typeof item === "number") out[key] = item;
  }
  return out;
}

function traitScores(value: unknown): TraitScores {
  const source = numbers(value);
  return {
    agility: source.agility ?? 0,
    strength: source.strength ?? 0,
    finesse: source.finesse ?? 0,
    instinct: source.instinct ?? 0,
    presence: source.presence ?? 0,
    knowledge: source.knowledge ?? 0,
  };
}

const STATUSES = new Set<SheetStatus>(["active", "dead", "retired", "away"]);

function rank(value: unknown): SheetData["subclassRank"] {
  if (value === "foundation" || value === "specialization" || value === "mastery") return value;
  return undefined;
}

/** Dice, lunar, and class-feature panels parse through `characterSheetSchema`; keep those fields from the stored sheet. */
function withPlayFields(core: SheetData, raw: Record<string, unknown>): SheetData {
  const parsed = characterSheetSchema.safeParse({
    ...core,
    secondaryWeaponId: core.secondaryWeaponId ?? "",
    conditions: raw.conditions,
    effects: raw.effects,
    heldDice: raw.heldDice,
    featureUses: raw.featureUses,
    classState: raw.classState,
    sessionFeatures: raw.sessionFeatures,
    advancements: raw.advancements,
    wither: raw.wither,
    journeyEnds: raw.journeyEnds,
    slotBonuses: raw.slotBonuses,
    cardTokens: raw.cardTokens,
  });
  if (!parsed.success) return core;
  const sheet = parsed.data;
  return {
    ...core,
    conditions: sheet.conditions,
    effects: sheet.effects,
    heldDice: sheet.heldDice,
    featureUses: sheet.featureUses,
    classState: sheet.classState,
    advancements: sheet.advancements,
    wither: sheet.wither,
    journeyEnds: sheet.journeyEnds,
    ...(sheet.sessionFeatures !== undefined ? { sessionFeatures: sheet.sessionFeatures } : {}),
    ...(sheet.slotBonuses !== undefined ? { slotBonuses: sheet.slotBonuses } : {}),
    ...(sheet.cardTokens !== undefined ? { cardTokens: sheet.cardTokens } : {}),
  };
}

/** A character row, or null when the value is not one. */
export function readCharacter(value: unknown): SheetCharacter | null {
  const row = record(value);
  const sheet = row ? record(row.sheet) : null;
  const choice = sheet ? ancestry(sheet.ancestry) : null;
  if (!row || !sheet || !choice || typeof row._id !== "string" || typeof sheet.name !== "string") return null;
  const status = row.status;
  if (typeof status !== "string" || !STATUSES.has(status as SheetStatus)) return null;
  const gold = record(sheet.gold);
  const cards = record(sheet.domainCards);
  const away = record(row.away);
  const multiclass = record(sheet.multiclass);
  return {
    _id: row._id as Id<"characters">,
    ownerId: text(row.ownerId),
    status: status as SheetStatus,
    ...(away && typeof away.reason === "string"
      ? { away: { reason: away.reason, ...(typeof away.note === "string" ? { note: away.note } : {}) } }
      : {}),
    ...(row.benched === true ? { benched: true } : {}),
    mine: row.mine === true,
    canEdit: row.canEdit === true,
    portraitUrl: typeof row.portraitUrl === "string" ? row.portraitUrl : null,
    ...(row.corrupt === true ? { corrupt: true } : {}),
    sheet: withPlayFields(
      {
        name: sheet.name,
        pronouns: text(sheet.pronouns),
        ...(sheet.pronounsLabel === "pronouns" || sheet.pronounsLabel === "gender"
          ? { pronounsLabel: sheet.pronounsLabel }
          : {}),
        description: text(sheet.description),
        level: whole(sheet.level, 1),
        classId: text(sheet.classId),
        subclassId: text(sheet.subclassId),
        ...(rank(sheet.subclassRank) ? { subclassRank: rank(sheet.subclassRank) } : {}),
        ancestry: choice,
        communityId: text(sheet.communityId),
        traits: traitScores(sheet.traits),
        traitMarks: numbers(sheet.traitMarks),
        evasion: whole(sheet.evasion),
        hp: whole(sheet.hp),
        hpMax: Math.max(1, whole(sheet.hpMax, 1)),
        stress: whole(sheet.stress),
        stressMax: Math.max(1, whole(sheet.stressMax, 1)),
        hope: whole(sheet.hope),
        scars: whole(sheet.scars),
        hopeSlotBonus: whole(sheet.hopeSlotBonus),
        armorMarked: whole(sheet.armorMarked),
        proficiency: Math.max(1, whole(sheet.proficiency, 1)),
        primaryWeaponId: text(sheet.primaryWeaponId),
        ...(typeof sheet.secondaryWeaponId === "string" ? { secondaryWeaponId: sheet.secondaryWeaponId } : {}),
        ...(typeof sheet.armorId === "string" ? { armorId: sheet.armorId } : {}),
        inventory: inventory(sheet.inventory),
        gold: {
          handfuls: whole(gold?.handfuls),
          bags: whole(gold?.bags),
          chest: gold?.chest === true,
        },
        experiences: experiences(sheet.experiences),
        domainCards: {
          owned: strings(cards?.owned),
          loadout: strings(cards?.loadout),
        },
        background: strings(sheet.background),
        connections: strings(sheet.connections),
        notes: text(sheet.notes),
        ...(sheet.levelUpPending === true ? { levelUpPending: true } : {}),
        ...(multiclass &&
        typeof multiclass.classId === "string" &&
        typeof multiclass.domainId === "string" &&
        typeof multiclass.subclassId === "string"
          ? {
              multiclass: {
                classId: multiclass.classId,
                domainId: multiclass.domainId,
                subclassId: multiclass.subclassId,
                ...(typeof multiclass.spellcastTrait === "string" ? { spellcastTrait: multiclass.spellcastTrait } : {}),
              },
            }
          : {}),
      },
      sheet,
    ),
  };
}

export function readParty(value: unknown): SheetCharacter[] | null | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return null;
  const rows: SheetCharacter[] = [];
  for (const item of value) {
    const character = readCharacter(item);
    if (!character) return null;
    rows.push(character);
  }
  return rows;
}

export function readTable(value: unknown): PartyTable | null | undefined {
  if (value === undefined) return undefined;
  const row = record(value);
  const gm = row ? record(row.gm) : null;
  if (!row || !gm || typeof gm.userId !== "string") return null;
  const players = Array.isArray(row.players) ? row.players : [];
  const listed: PartyTable["players"] = [];
  for (const player of players) {
    const member = record(player);
    if (!member || typeof member.userId !== "string") continue;
    listed.push({ userId: member.userId, name: text(member.name, "Player") });
  }
  return { gm: { userId: gm.userId, name: text(gm.name, "GM") }, players: listed };
}

/** This character's picks on the open rest, from `rests.current`. */
export function readOpenRest(value: unknown, characterId: string): OpenRest {
  const row = record(value);
  const open = row ? record(row.open) : null;
  if (!open || (open.kind !== "short" && open.kind !== "long")) return null;
  const choices = Array.isArray(open.choices) ? open.choices : [];
  const choice = choices
    .map(record)
    .find((item) => item?.characterId === characterId);
  const moves = Array.isArray(choice?.moves) ? choice.moves : [];
  return {
    kind: open.kind,
    moves: moves
      .map(record)
      .map((item) => item?.move)
      .filter((move): move is string => typeof move === "string"),
  };
}
