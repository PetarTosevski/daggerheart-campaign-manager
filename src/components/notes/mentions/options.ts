// The @ picker's options and the link targets (D11 N5; Q6, D7). Pure helpers over the viewer's `codex.list` entries.

import type { VisibleRef } from "@/lib/domain/notes";

/** The fields of a `codex.list` entry (GM or player view) the picker and the links read. */
export type CodexRef = { _id: string; kind: "character" | "location"; name: string; role: string };

export type PickerOption = { id: string; name: string; kind: "character" | "location"; tip: string };

/** How many options the picker lists at once. */
export const PICKER_LIMIT = 8;

/** The name shown for an entry; the Codex's own fallback for an unnamed one. */
export function displayName(ref: Pick<CodexRef, "kind" | "name">): string {
  return ref.name.trim() || (ref.kind === "location" ? "Unnamed location" : "Unnamed character");
}

/** The role line (the Codex list's subtitle): the role, else 'Character' / 'Location'. */
export function roleTip(ref: Pick<CodexRef, "kind" | "role">): string {
  return ref.role.trim() || (ref.kind === "location" ? "Location" : "Character");
}

/**
 * The entries whose name starts with the typed prefix (case-insensitive), then those with a later word starting with it,
 * each group by name; at most `limit`. An empty prefix lists every entry. Unnamed entries are never offered.
 */
export function pickerOptions(entries: readonly CodexRef[], query: string, limit = PICKER_LIMIT): PickerOption[] {
  const q = query.trim().toLowerCase();
  const ranked: { rank: number; option: PickerOption }[] = [];
  for (const e of entries) {
    const name = e.name.trim();
    if (!name) continue;
    const lower = name.toLowerCase();
    const rank = lower.startsWith(q) ? 0 : lower.split(/[\s,'’-]+/).some((word) => word.startsWith(q)) ? 1 : -1;
    if (rank < 0) continue;
    ranked.push({ rank, option: { id: e._id, name, kind: e.kind, tip: roleTip(e) } });
  }
  ranked.sort((a, b) => a.rank - b.rank || a.option.name.localeCompare(b.option.name));
  return ranked.slice(0, limit).map((r) => r.option);
}

/** The viewer's visible entries keyed by id, for N1 `renderParts` (only the ids the text mentions). */
export function visibleRefs(entries: readonly CodexRef[], ids: ReadonlySet<string>): Map<string, VisibleRef> {
  const refs = new Map<string, VisibleRef>();
  for (const e of entries) {
    if (ids.has(e._id)) refs.set(e._id, { name: displayName(e), kind: e.kind, role: e.role });
  }
  return refs;
}

/** The Codex page opened on one entry (its `?entry=` read selects it). */
export function codexHref(campaignId: string, entryId: string): string {
  return `/campaigns/${campaignId}/codex?entry=${encodeURIComponent(entryId)}`;
}
