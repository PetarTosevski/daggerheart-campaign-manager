// Characters & Locations (the Codex board, D7): stored entry data and the
// limits every write is checked against. Ported from
// reference/designs/project/Codex.dc.html. Pure module: bundled into Convex.

import { z } from "zod";

export const CODEX_KINDS = ["character", "location"] as const;
export type CodexKind = (typeof CODEX_KINDS)[number];

export const MAX_CODEX_ENTRIES = 500;
export const MAX_CODEX_IMAGES = 8;
export const MAX_CODEX_IMAGE_BYTES = 3 * 1024 * 1024;
export const MAX_NAME = 120;
export const MAX_ROLE = 160;
export const MAX_TEXT = 8000;
const MAX_GROUP = 40;

/** "Players see" value when the party doesn't know an allegiance. */
export const ALLEGIANCE_UNKNOWN = "unknown";

export const codexImageSchema = z.object({
  storageId: z.string().min(1).max(64),
  /** Revealed to players. */
  shown: z.boolean(),
});

export const codexEntryDataSchema = z.object({
  name: z.string().max(MAX_NAME),
  /** Role (characters) or kind of place (locations). */
  role: z.string().max(MAX_ROLE),
  /** The party knows of this entry (players see it). */
  known: z.boolean(),
  /** What the players know. */
  pdesc: z.string().max(MAX_TEXT),
  /** GM notes; never sent to players. */
  gmn: z.string().max(MAX_TEXT),
  images: z.array(codexImageSchema).max(MAX_CODEX_IMAGES),
  /** Storage id of the main picture, or null for the first image. */
  cover: z.string().max(64).nullable(),
  /** Characters: true allegiance ("" = unassigned); never sent to players. */
  allegiance: z.string().max(MAX_GROUP),
  /** Characters: the allegiance players see (`ALLEGIANCE_UNKNOWN` or a faction). */
  allegianceShown: z.string().max(MAX_GROUP),
  /** Locations: region picked by hand ("" = unsorted); a map pin overrides it. */
  region: z.string().max(MAX_GROUP),
  /** Linked World map token, or null. */
  tokenId: z.number().int().min(1).nullable(),
});

export type CodexImage = z.infer<typeof codexImageSchema>;
export type CodexEntryData = z.infer<typeof codexEntryDataSchema>;

/** Fields the GM edits directly (images, cover and pin have their own mutations). */
export const codexPatchSchema = codexEntryDataSchema
  .pick({ name: true, role: true, known: true, pdesc: true, gmn: true, allegiance: true, allegianceShown: true, region: true })
  .partial()
  .strict();

export type CodexPatch = z.infer<typeof codexPatchSchema>;

export function emptyEntry(overrides: Partial<CodexEntryData> = {}): CodexEntryData {
  return {
    name: "",
    role: "",
    known: false,
    pdesc: "",
    gmn: "",
    images: [],
    cover: null,
    allegiance: "",
    allegianceShown: ALLEGIANCE_UNKNOWN,
    region: "",
    tokenId: null,
    ...overrides,
  };
}

/** Allegiances per frame (the board's FACTIONS); other frames use the generic three. */
const FACTIONS: Record<string, readonly string[]> = { witherwild: ["Haven", "Fanewick", "Neutral"] };
const DEFAULT_FACTIONS = ["Allies", "Enemies", "Neutral"] as const;

/** Regions per frame (the board's REGIONS); frames without regions hide the field. */
const REGIONS: Record<string, readonly string[]> = { witherwild: ["Haven", "Colonies", "Fanewick"] };

export function factionsFor(frameId: string): readonly string[] {
  return FACTIONS[frameId] ?? DEFAULT_FACTIONS;
}

export function regionsFor(frameId: string): readonly string[] {
  return REGIONS[frameId] ?? [];
}

/** Checks the allegiance and region values against the frame's lists; returns an error message or null. */
export function checkGroups(frameId: string, data: Pick<CodexEntryData, "allegiance" | "allegianceShown" | "region">): string | null {
  const factions = factionsFor(frameId);
  if (data.allegiance !== "" && !factions.includes(data.allegiance)) return "Unknown allegiance.";
  if (data.allegianceShown !== ALLEGIANCE_UNKNOWN && !factions.includes(data.allegianceShown)) return "Unknown allegiance.";
  if (data.region !== "" && !regionsFor(frameId).includes(data.region)) return "Unknown region.";
  return null;
}
