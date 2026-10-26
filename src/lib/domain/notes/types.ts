// The value sets of the Notes journal (D11 N1). Pure module: bundled into Convex (N0's validators may import these
// lists) and used by the UI.
//
// Board (Notes.dc.html l.214-216): kinds task / event / note / idea / hope / fear; task states open -> done -> migrated ->
// scheduled -> struck; other kinds open <-> done (shown as "resolved"). Page kinds log / collection / future (l.276).
// Visibility values come from the plan's visibility table (A3, A4, A5, Q4, D4).

/** The six bullet kinds, in the board's chip order. */
export const ENTRY_KINDS = ["task", "event", "note", "idea", "hope", "fear"] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

/**
 * The stored entry states. A task uses all five; every other kind uses only "open" and "done" ("done" is shown as
 * resolved, l.244).
 */
export const ENTRY_STATES = ["open", "done", "migrated", "scheduled", "struck"] as const;
export type EntryState = (typeof ENTRY_STATES)[number];

/** The three page kinds (the index groups, l.282). */
export const PAGE_KINDS = ["log", "collection", "future"] as const;
export type PageKind = (typeof PAGE_KINDS)[number];

/**
 * A page's sharing value. Player pages: gm (default) | private | players | everyone | chosen. GM pages: private
 * (default) | everyone | chosen.
 */
export const VISIBILITIES = ["gm", "private", "players", "everyone", "chosen"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

/** The fields of an entry the bullet rules read (`journalEntries` row: `kind`, `state`). */
export type BulletInput = { kind: EntryKind; state: EntryState };
