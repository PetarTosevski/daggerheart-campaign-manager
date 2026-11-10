import type { FunctionReturnType } from "convex/server";

import type { api } from "../../convex";

/** One character as `charactersReads.get` and `charactersReads.listByCampaign` return it (dcm-gdzi.25: typed, real ids). */
export type SheetCharacter = NonNullable<FunctionReturnType<typeof api.charactersReads.get>>;

export type SheetData = SheetCharacter["sheet"];

export type TraitScores = SheetData["traits"];

export type Ancestry = SheetData["ancestry"];

export type SheetStatus = SheetCharacter["status"];

export type Resource = "hp" | "stress" | "hope" | "armor" | "scars";

export type PartyTable = FunctionReturnType<typeof api.members.roster>;

export type RestState = FunctionReturnType<typeof api.restsReads.current>;

export type OpenRest = { kind: RestKind; extended: boolean; moves: readonly string[] } | null;

type RestKind = NonNullable<RestState["open"]>["kind"];

/** This character's picks on the open rest, from `restsReads.current`. */
export function openRestFor(rest: RestState | undefined, characterId: string): OpenRest {
  const open = rest?.open;
  if (!open) return null;
  const choice = open.choices.find((item) => item.characterId === characterId);
  return { kind: open.kind, extended: open.extended, moves: (choice?.moves ?? []).map((item) => item.move) };
}
