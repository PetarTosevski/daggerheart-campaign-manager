// What the GM and the players see of a codex entry. The server builds both
// views with these functions (players never receive hidden fields); the GM's
// "Player view" preview reuses `toPlayerEntry` on the client. Pure module.

import { ALLEGIANCE_UNKNOWN, regionsFor, type CodexEntryData, type CodexKind } from "./schema";

type Point = readonly [number, number];

// Witherwild map (percent coords of the World map): Haven's city walls and the
// dotted border of the colonies (the board's POLY_HAVEN / POLY_COLONIES).
const POLY_HAVEN: Point[] = [[47, 38], [50, 33], [53.5, 23], [57, 25], [60, 32], [63.5, 38], [62.5, 45.5], [56, 46.5], [48.5, 45.5]];
const POLY_COLONIES: Point[] = [
  [39.5, 0], [39.5, 34], [37, 37.5], [35.2, 41.5], [35.3, 46], [36.8, 50], [39.5, 52.2], [43, 53.6], [50, 55.4], [60, 55.6],
  [70, 55.2], [75, 53.4], [78.5, 50.5], [79.6, 46], [80.5, 44.6], [84.5, 45.3], [88, 47], [91, 48.6], [100, 48.6], [100, 0],
];

function inPolygon(x: number, y: number, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The region a map position falls in, or "" for frames without regions. */
export function regionAt(frameId: string, x: number, y: number): string {
  if (frameId !== "witherwild") return "";
  if (inPolygon(x, y, POLY_HAVEN)) return "Haven";
  if (inPolygon(x, y, POLY_COLONIES)) return "Colonies";
  return "Fanewick";
}

export type PinPosition = { x: number; y: number };

/** A location's region: from its map pin when it has one (and the frame has regions), else the one picked by hand. */
export function regionOf(frameId: string, data: Pick<CodexEntryData, "region">, pin: PinPosition | null): { region: string; auto: boolean } {
  if (pin && regionsFor(frameId).length) {
    const r = regionAt(frameId, pin.x, pin.y);
    if (r) return { region: r, auto: true };
  }
  return { region: data.region, auto: false };
}

/** The storage id of the entry's main picture among `images` (the chosen cover, else the first). */
export function coverOf(cover: string | null, images: readonly { storageId: string }[]): string | null {
  const found = images.find((g) => g.storageId === cover) ?? images[0];
  return found ? found.storageId : null;
}

/** A GM image; `key` identifies it on the page (the GM's key is the storage id). */
export type ImageView = { key: string; storageId: string; shown: boolean; url: string | null };

/** The GM's view of an entry: everything. */
export type GmEntry = {
  _id: string;
  kind: CodexKind;
  name: string;
  role: string;
  known: boolean;
  pdesc: string;
  gmn: string;
  allegiance: string;
  allegianceShown: string;
  region: string;
  regionAuto: boolean;
  /** Linked map token that still exists, else null. */
  tokenId: number | null;
  images: ImageView[];
  cover: string | null;
  createdAt: number;
};

/** A player's view: only what the party may know. */
export type PlayerEntry = {
  _id: string;
  kind: CodexKind;
  name: string;
  pdesc: string;
  /** The allegiance shown to players (characters), or `ALLEGIANCE_UNKNOWN`. */
  allegianceShown: string;
  region: string;
  /** The map pin, only when its token is visible on the map. */
  tokenId: number | null;
  /** Revealed images; `key` is an opaque per-entry index (players never receive storage ids). */
  images: { key: string; url: string | null }[];
  /** The `key` of the main picture. */
  cover: string | null;
  createdAt: number;
};

/**
 * Reduces an entry to what players see, or null when the party doesn't know it.
 * `visiblePin` must be the linked token only if it exists and isn't hidden.
 */
export function toPlayerEntry(
  frameId: string,
  e: {
    _id: string;
    kind: CodexKind;
    createdAt: number;
    data: Pick<CodexEntryData, "name" | "known" | "pdesc" | "allegianceShown" | "region" | "cover">;
    images: readonly { storageId: string; shown: boolean; url: string | null }[];
  },
  visiblePin: (PinPosition & { id: number }) | null,
): PlayerEntry | null {
  if (!e.data.known) return null;
  const shown = e.images.filter((g) => g.shown);
  const coverId = coverOf(e.data.cover, shown);
  const images = shown.map((g, i) => ({ key: String(i), url: g.url }));
  return {
    _id: e._id,
    kind: e.kind,
    name: e.data.name,
    pdesc: e.data.pdesc,
    allegianceShown: e.kind === "character" ? e.data.allegianceShown || ALLEGIANCE_UNKNOWN : ALLEGIANCE_UNKNOWN,
    region: e.kind === "location" ? regionOf(frameId, e.data, visiblePin).region : "",
    tokenId: visiblePin ? visiblePin.id : null,
    images,
    cover: coverId === null ? null : String(shown.findIndex((g) => g.storageId === coverId)),
    createdAt: e.createdAt,
  };
}

/** The GM preview of the player view, built from a GM entry. */
export function previewForPlayers(frameId: string, e: GmEntry, pins: readonly { id: number; x: number; y: number; hidden: boolean }[]): PlayerEntry | null {
  const pin = e.tokenId === null ? undefined : pins.find((p) => p.id === e.tokenId && !p.hidden);
  return toPlayerEntry(
    frameId,
    {
      _id: e._id,
      kind: e.kind,
      createdAt: e.createdAt,
      data: { name: e.name, known: e.known, pdesc: e.pdesc, allegianceShown: e.allegianceShown, region: e.region, cover: e.cover },
      images: e.images,
    },
    pin ?? null,
  );
}

// ---- display helpers (the board's list badges and notes)

/** The group an entry is listed under: region for locations, allegiance for characters (the shown one for players). */
export function groupOf(e: { kind: CodexKind; region: string; allegiance?: string; allegianceShown: string }, gm: boolean): string {
  if (e.kind === "location") return e.region;
  if (gm) return e.allegiance ?? "";
  return e.allegianceShown && e.allegianceShown !== ALLEGIANCE_UNKNOWN ? e.allegianceShown : "";
}

export function unknownGroupLabel(kind: CodexKind, gm: boolean): string {
  if (kind === "location") return "Unsorted";
  return gm ? "Unassigned" : "Allegiance unknown";
}

const GROUP_BG: Record<string, string> = { Haven: "#1d2a3f", Fanewick: "#1f3322", Neutral: "#2b2b2b", Colonies: "#3a2d1a" };
const GROUP_FG: Record<string, string> = { Haven: "#a9c6ff", Fanewick: "#a8e0a0", Neutral: "#d0d0d0", Colonies: "#f0cf8a" };

export function groupBadgeColors(group: string): { background: string; color: string } {
  return { background: GROUP_BG[group] ?? "#2a1f24", color: GROUP_FG[group] ?? "#e0a3b0" };
}

/** The note under the allegiance pickers. */
export function allegianceNote(allegiance: string, shown: string): string {
  if (!allegiance) return "";
  if (shown === allegiance) return "Players know the truth.";
  if ((shown || ALLEGIANCE_UNKNOWN) === ALLEGIANCE_UNKNOWN) return "Players don’t know where their loyalty lies.";
  return "Players believe a cover story.";
}

/** Case-insensitive search on the name (and the role, which only the GM has). */
export function matchesSearch(e: { name: string; role?: string }, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return `${e.name} ${e.role ?? ""}`.toLowerCase().includes(q);
}
