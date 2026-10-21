// Entry authors and journal names (D11 N1; Q3, Q8, Q12). Pure module.
//
// Q3: "An added entry has a different colour and ends with '- <author>': the author's character name for a player
// (fallback account name), 'GM' for the GM."
// Q8: "'<active character>’s Journal' / 'Player journal · <class>' (fallback account name / 'Player'); GM 'Game Master’s
// Journal' / 'GM journal · private to the GM'."
// Q12: "a 'Past journals' list in the Shared section names them after the character" (plan N8: '<character>’s journal').
//
// ```ts
// authorLabel({ isGm: false, characterName: "Ash", accountName: "petar" });   // "Ash"
// authorLabel({ isGm: true, characterName: "Ash" });                          // "GM"
// authorSuffix("GM");                                                         // " - GM"
// journalWho({ isGm: false, characterName: "Ash", className: "Ranger" });    // { whoName: "Ash", whoSub: "Player journal · Ranger" }
// journalTitle("Ash");                                                        // "Ash’s Journal"
// ```

/** Who wrote an entry or owns a journal. */
export type PersonInput = {
  /** The person is the campaign's GM (owner). */
  isGm: boolean;
  /** Their character's name (the entry's `authorCharacterId`, the journal's character). */
  characterName?: string | null;
  /** Their account name. */
  accountName?: string | null;
};

function nonBlank(s: string | null | undefined): string | undefined {
  const t = s?.trim();
  return t ? t : undefined;
}

/** The author shown after an added entry: 'GM' for the GM, else the character name, the account name, or 'Player'. */
export function authorLabel(person: PersonInput): string {
  if (person.isGm) return "GM";
  return nonBlank(person.characterName) ?? nonBlank(person.accountName) ?? "Player";
}

/** The ' - <author>' an added entry ends with (Q3). */
export function authorSuffix(label: string): string {
  return ` - ${label}`;
}

/** An entry is 'added' (shown in the added colour with the suffix) when its author is not the page owner. */
export function isAddedEntry(entry: { authorId: string }, page: { ownerId: string }): boolean {
  return entry.authorId !== page.ownerId;
}

/** The hero's name and sub line for a journal (Q8). */
export function journalWho(owner: PersonInput & { className?: string | null }): { whoName: string; whoSub: string } {
  if (owner.isGm) return { whoName: "Game Master", whoSub: "GM journal · private to the GM" };
  return {
    whoName: nonBlank(owner.characterName) ?? nonBlank(owner.accountName) ?? "Player",
    whoSub: `Player journal · ${nonBlank(owner.className) ?? "Player"}`,
  };
}

/** The hero title: '<whoName>’s Journal' (B1). */
export function journalTitle(whoName: string): string {
  return `${whoName}’s Journal`;
}

/** A past journal's name in the Shared section: '<character>’s journal' (account name for an unattached journal). */
export function pastJournalTitle(owner: { characterName?: string | null; accountName?: string | null }): string {
  return `${nonBlank(owner.characterName) ?? nonBlank(owner.accountName) ?? "Player"}’s journal`;
}
