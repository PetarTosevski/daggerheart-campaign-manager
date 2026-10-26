// Page visibility: allowed values, defaults, chip labels, readers and the departed rule (D11 N1; A3, A4, A5, Q2, Q4, Q12,
// Q14, D1, D4). Pure module; N0's permissionFor ('journalPage' resource) may call canReadPage so the table lives once.
//
// Plan, visibility table: "player 'gm' (default) | 'private' | 'players' | 'everyone' | 'chosen'; GM 'private' (default)
// | 'everyone' | 'chosen'. Readers besides the owner, journal present: gm -> GM; private -> nobody; players -> other
// players, not the GM; everyone -> every member; chosen -> recipients (D4). Departed journal (D1): private stays
// owner-only, every other value -> every member. The GM journal never departs."
//
// ```ts
// allowedVisibilities(false);                        // ["gm", "private", "players", "everyone", "chosen"]
// visibilityLabel("players", false);                 // "Players only (hidden from the GM)"
// effectiveReaders("players", { ownerIsGm: false, departed: true }).visibility;   // "everyone"
// canReadPage({ visibility: "chosen", ownerIsGm: false, departed: false, viewer: "gm", isRecipient: false });  // false
// ```

import type { Visibility } from "./types";

export const PLAYER_VISIBILITIES: readonly Visibility[] = ["gm", "private", "players", "everyone", "chosen"];
export const GM_VISIBILITIES: readonly Visibility[] = ["private", "everyone", "chosen"];

/** The values an owner may set: a player all five, the GM private / everyone / chosen (Q4, A4, A5). */
export function allowedVisibilities(isGm: boolean): readonly Visibility[] {
  return isGm ? GM_VISIBILITIES : PLAYER_VISIBILITIES;
}

/** False for 'gm' or 'players' on a GM page (the server answers NOTE_VISIBILITY_INVALID). */
export function isAllowedVisibility(isGm: boolean, visibility: Visibility): boolean {
  return allowedVisibilities(isGm).includes(visibility);
}

/** A new page's visibility: 'private' for the GM, 'gm' (the GM can read) for a player (A4). */
export function defaultVisibility(isGm: boolean): Visibility {
  return isGm ? "private" : "gm";
}

const PLAYER_LABEL: Record<Visibility, string> = {
  gm: "Private · GM can read",
  private: "Private · hidden from everyone",
  players: "Players only (hidden from the GM)",
  everyone: "Everyone",
  chosen: "Chosen players",
};

const GM_LABEL: Partial<Record<Visibility, string>> = {
  private: "Private",
  everyone: "Everyone",
  chosen: "Chosen players",
};

/** The sharing chip's and the dialog option's label for the owner type (Q14). */
export function visibilityLabel(visibility: Visibility, ownerIsGm: boolean): string {
  return (ownerIsGm ? GM_LABEL[visibility] : undefined) ?? PLAYER_LABEL[visibility];
}

/** Who reads a page besides its owner. */
export type Readers = {
  /** The value that applies now: the stored one, or 'everyone' for a non-private page of a departed journal (Q12). */
  visibility: Visibility;
  /** The GM: always, never, or only when ticked as a recipient (D4). Meaningless for the GM's own pages. */
  gm: "yes" | "no" | "if-recipient";
  /** The players other than the owner: all, none, or the chosen recipients. */
  players: "all" | "none" | "recipients";
};

/**
 * The readers of a page besides its owner, after the departed rule: a departed player journal's private page stays
 * owner-only, every other value reads as 'everyone' (Q12, D1). The GM journal never departs (`departed` is ignored).
 */
export function effectiveReaders(
  visibility: Visibility,
  options: { ownerIsGm: boolean; departed: boolean },
): Readers {
  const departed = options.departed && !options.ownerIsGm;
  const v: Visibility = departed && visibility !== "private" ? "everyone" : visibility;
  switch (v) {
    case "gm":
      return { visibility: v, gm: "yes", players: "none" };
    case "private":
      return { visibility: v, gm: "no", players: "none" };
    case "players":
      return { visibility: v, gm: "no", players: "all" };
    case "everyone":
      return { visibility: v, gm: "yes", players: "all" };
    case "chosen":
      return { visibility: v, gm: "if-recipient", players: "recipients" };
  }
}

export type ReadInput = {
  visibility: Visibility;
  ownerIsGm: boolean;
  departed: boolean;
  /** The viewer relative to the page: its owner, the campaign's GM (not the owner), or another player. */
  viewer: "owner" | "gm" | "player";
  /** The viewer has a `journalPageRecipients` row for the page (only counts while the page is 'chosen'). */
  isRecipient: boolean;
};

/**
 * True when the viewer may read a (non-binned) page of a member journal. Outsiders never reach this (the campaign
 * wrapper answers NOT_FOUND first); binned pages are the caller's rule (owner, or the GM who binned a departed page).
 */
export function canReadPage(input: ReadInput): boolean {
  if (input.viewer === "owner") return true;
  const r = effectiveReaders(input.visibility, input);
  if (input.viewer === "gm") return r.gm === "yes" || (r.gm === "if-recipient" && input.isRecipient);
  return r.players === "all" || (r.players === "recipients" && input.isRecipient);
}
