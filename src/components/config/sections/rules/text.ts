import { lorekeeperMessages } from "@/lib/errors/lorekeeper";

/** The board's text for House rules (reference/designs/config/Settings.dc.html, `.s-rules`). */
export const RULES_TEXT = {
  hint: "The Lorekeeper quotes these as table rulings before it searches anywhere else.",
  optionsLabel: "Campaign options",
  optionTag: "Campaign option",
  rulingsLabel: "Table rulings",
  empty: "No table rulings yet. Pin one from a Lorekeeper answer, or add a house rule here.",
  add: "Add a house rule",
  /** The server's LOREKEEPER_RULING_LIMIT text, shown before the GM tries a 51st. */
  limit: lorekeeperMessages.LOREKEEPER_RULING_LIMIT,
  fromLorekeeper: "Pinned from the Lorekeeper",
  addedHere: "Added here",
} as const;

/**
 * Where a ruling came from (the board's `em` line): pinned from a Lorekeeper answer ('Pinned from the Lorekeeper',
 * plus ' · Session N' when it was pinned in a session), or written by hand ('Added here').
 */
export function rulingOrigin(ruling: { fromMessageId: string | null; sessionN: number | null }): string {
  if (ruling.fromMessageId === null) return ruling.sessionN === null ? RULES_TEXT.addedHere : `${RULES_TEXT.addedHere} · Session ${ruling.sessionN}`;
  return ruling.sessionN === null ? RULES_TEXT.fromLorekeeper : `${RULES_TEXT.fromLorekeeper} · Session ${ruling.sessionN}`;
}
