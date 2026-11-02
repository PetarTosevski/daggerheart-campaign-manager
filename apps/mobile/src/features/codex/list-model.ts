import type { CodexKind } from "../../../../../src/lib/codex/schema";
import { factionsFor, regionsFor } from "../../../../../src/lib/codex/schema";
import {
  groupOf,
  matchesSearch,
  previewForPlayers,
  unknownGroupLabel,
  type GmEntry,
  type PlayerEntry,
} from "../../../../../src/lib/codex/view";

import type { AnyEntry, CodexList, CodexPin } from "./types";
import { isGmList } from "./types";

export type ListRow = {
  _id: string;
  name: string;
  subtitle: string;
  coverUrl: string | null;
  initial: string;
  group: string;
  groupText: string;
  known: boolean;
  imageText: string;
};

export type GroupTab = { key: string; label: string; count: number };

const KIND_LABEL: Record<CodexKind, string> = { character: "Characters", location: "Locations" };

export function kindLabel(kind: CodexKind): string {
  return KIND_LABEL[kind];
}

export function visibleEntries(
  data: CodexList | undefined,
  frameId: string,
  preview: boolean,
): { entries: AnyEntry[]; pins: CodexPin[]; gm: boolean } {
  if (data === undefined) return { entries: [], pins: [], gm: false };
  if (isGmList(data)) {
    const pins = data.pins;
    if (preview) {
      const entries = data.entries
        .map((entry) => previewForPlayers(frameId, entry, pins))
        .filter((entry): entry is PlayerEntry => entry !== null);
      return { entries, pins, gm: false };
    }
    return { entries: data.entries, pins, gm: true };
  }
  return { entries: data.entries, pins: [], gm: false };
}

export function filterEntries(
  entries: AnyEntry[],
  kind: CodexKind,
  groupKey: string,
  search: string,
  frameId: string,
  gm: boolean,
): { shown: AnyEntry[]; groupTabs: GroupTab[]; baseCount: number } {
  const ofKind = entries.filter((entry) => entry.kind === kind);
  const base = ofKind.filter((entry) => matchesSearch({ name: entry.name, role: "role" in entry ? entry.role : undefined }, search));
  const groupFor = (entry: AnyEntry) =>
    groupOf(
      {
        kind: entry.kind,
        region: entry.region,
        allegiance: "allegiance" in entry ? entry.allegiance : undefined,
        allegianceShown: entry.allegianceShown,
      },
      gm,
    );
  const shown = base.filter((entry) => groupKey === "all" || groupFor(entry) === groupKey);
  const regions = regionsFor(frameId);
  const groupNames = kind === "location" ? regions : factionsFor(frameId);
  const groupTabs =
    kind === "character" || regions.length
      ? [
          { key: "all", label: "All" },
          ...groupNames.map((name) => ({ key: name, label: name })),
          { key: "", label: unknownGroupLabel(kind, gm) },
        ]
          .map((tab) => ({
            ...tab,
            count: tab.key === "all" ? base.length : base.filter((entry) => groupFor(entry) === tab.key).length,
          }))
          .filter((tab) => !(tab.key === "" && tab.count === 0 && groupKey !== ""))
      : [];
  return { shown, groupTabs, baseCount: base.length };
}

export function toListRows(entries: AnyEntry[], gm: boolean): ListRow[] {
  return entries.map((entry) => {
    const group = groupOf(
      {
        kind: entry.kind,
        region: entry.region,
        allegiance: "allegiance" in entry ? entry.allegiance : undefined,
        allegianceShown: entry.allegianceShown,
      },
      gm,
    );
    const cover = entry.images.find((image) => image.key === entry.cover)?.url ?? null;
    const name = entry.name || (entry.kind === "location" ? "Unnamed location" : "Unnamed character");
    return {
      _id: entry._id,
      name,
      subtitle: ("role" in entry && entry.role) || (entry.kind === "location" ? "Location" : "Character"),
      coverUrl: cover,
      initial: (entry.name || "?").charAt(0).toUpperCase(),
      group,
      groupText: group || (entry.kind === "location" ? "" : unknownGroupLabel(entry.kind, gm)),
      known: "known" in entry ? entry.known : true,
      imageText:
        "known" in entry
          ? entry.images.length
            ? `${entry.images.filter((image) => image.shown).length}/${entry.images.length} shown`
            : "No images"
          : "",
    };
  });
}

export function headerLine(data: CodexList | undefined, gm: boolean): string {
  if (!isGmList(data) || !gm) return "What your party knows";
  const knownCount = data.entries.filter((entry) => entry.known).length;
  const characters = data.entries.filter((entry) => entry.kind === "character").length;
  const locations = data.entries.filter((entry) => entry.kind === "location").length;
  return `${characters} characters · ${locations} locations · ${knownCount} known to the players`;
}

export function emptyMessage(kind: CodexKind, gm: boolean, searching: boolean): string {
  if (searching) return "Nothing matches that search.";
  if (gm) {
    return kind === "location"
      ? "No locations yet. Add one, or pull in the pins you placed on the World map."
      : "No characters yet. Add the people your party meets.";
  }
  return "The party has not met anyone here yet.";
}

export function findEntry(entries: AnyEntry[], entryId: string): AnyEntry | undefined {
  return entries.find((entry) => entry._id === entryId);
}

export function gmEntryFrom(data: CodexList | undefined, entryId: string): GmEntry | undefined {
  if (!isGmList(data)) return undefined;
  return data.entries.find((entry) => entry._id === entryId);
}
