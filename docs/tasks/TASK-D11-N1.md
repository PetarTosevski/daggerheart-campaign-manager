# TASK-D11-N1: Pure domain - bullets and states, quick keys, threads, migration, defaults and titles, visibility rules and labels, action rules, mention tokens, session-log titles, Markdown export, search match, header line

Status: Done. Plan: `.omc/plans/d11-notes.yaml`, tracer N1 (wave 1, no dependencies). Bead: dcm-bxp.10.
Rules implemented: B1 (header), B2 (index counts, empty texts, groups), B3 (meta, tape, migrate tooltips, tear label,
empty lines, KEY), B4 (kinds, tooltips, task cycle, quick keys), B5 (open threads, threads copy), B6 (migration), B7
(default pages, new titles, tapes), B9 (search match); A3, A4, A5, Q3, Q4, Q6, Q7, Q8, Q9, Q10, Q11, Q12, Q14; D1 (the
departed rule's visibility side), D2, D4, D5, D6, D7.

## Goal
A pure, tested TypeScript module answers every derived value the Notes board and its additions show, from plain journal,
page, entry, session and character rows. No React, Next or Convex imports, relative imports only (the eslint
framework-free block covers `src/lib/domain/**`), no new dependency. Functions return booleans / `null` instead of
throwing: the server maps a refusal to the error code N0 defines (`NOTE_*` in `src/lib/errors/notes.ts`), so this module
does not depend on N0's error module.

## Files
- `src/lib/domain/notes/types.ts`: value sets `ENTRY_KINDS`, `ENTRY_STATES`, `PAGE_KINDS`, `VISIBILITIES` and their types.
- `src/lib/domain/notes/limits.ts`: `NOTE_LIMITS`, `BIN_DAYS`, `UNDO_MS`, bin days, title / text checks.
- `src/lib/domain/notes/bullets.ts`: kinds, glyphs, states, tooltips, open threads, KEY legend, add placeholder.
- `src/lib/domain/notes/quick-keys.ts`: `parseQuickKey`, `QUICK_KEYS`, Quick keys card copy.
- `src/lib/domain/notes/migrate.ts`: `openTasks`, `migrationTarget`, `newContinuationTitle`, `migrationTip`, `planMigration`.
- `src/lib/domain/notes/defaults.ts`: tapes, default pages, new page titles, session-log titles, kind words, index groups.
- `src/lib/domain/notes/visibility.ts`: allowed / default visibility, chip labels, `effectiveReaders`, `canReadPage`.
- `src/lib/domain/notes/actions.ts`: the analysis 3.2 action table.
- `src/lib/domain/notes/mentions.ts`: `@[name](id)` tokens.
- `src/lib/domain/notes/authors.ts`: author labels, added entries, journal names.
- `src/lib/domain/notes/export.ts`: `journalToMarkdown`.
- `src/lib/domain/notes/summary.ts`: header line, counts, page meta, empty lines, search match, fixed copy.
- `src/lib/domain/notes/index.ts`: re-exports all of the above. Import from `@/lib/domain/notes` in the app and
  `../../src/lib/domain/notes` (relative) in `convex/`.
- `tests/unit/notes-domain.test.ts`: 60 tests.

## Public API
```ts
// types.ts
const ENTRY_KINDS = ["task", "event", "note", "idea", "hope", "fear"] as const;      type EntryKind
const ENTRY_STATES = ["open", "done", "migrated", "scheduled", "struck"] as const;   type EntryState
const PAGE_KINDS = ["log", "collection", "future"] as const;                         type PageKind
const VISIBILITIES = ["gm", "private", "players", "everyone", "chosen"] as const;    type Visibility
type BulletInput = { kind: EntryKind; state: EntryState };

// limits.ts
const NOTE_LIMITS = { MAX_PAGES: 200, MAX_PAGE_ENTRIES: 300, MAX_JOURNAL_ENTRIES: 5000, TITLE_MAX: 80, TEXT_MAX: 500, MAX_MENTIONS: 10 };
const BIN_DAYS = 30; const UNDO_MS = 10_000;
binCutoff(now: number): number;                          // pages with binnedAt < this are purged (N7)
binDaysLeft(binnedAt: number, now: number): number;      // ceil, >= 0
daysLeftLabel(days: number): string;                     // 'N days left' / '1 day left'
normalizeTitle(title: string): string;                   // trim
isValidTitle(title: string): boolean;                    // 1-80 after trim
isValidEntryText(text: string): boolean;                 // 1-500 after trim, tokens counted as written
clampTitle(base: string, suffix?: string): string;       // <= 80, suffix kept whole

// bullets.ts
type BulletSpec = { glyph; color; label; tip; glow?; textColor? };
const BULLETS: Record<EntryKind, BulletSpec>;
const TASK_CYCLE: readonly EntryState[];  const TASK_STATE_LABEL: Record<EntryState, string>;
glyphFor(entry: BulletInput): string;                    // task: • × > < (struck •); others their glyph
nextState(kind: EntryKind, state: EntryState): EntryState;
isStruck(entry: BulletInput): boolean;                   // struck task, resolved non-task
isDimmed(entry: BulletInput): boolean;                   // non-open task or struck line
bulletTip(entry: BulletInput): string;                   // tooltip and aria label
isOpenThread(entry: BulletInput): boolean;               // open task or unresolved Fear = journalEntries.open
openThreads<T extends BulletInput>(entries: readonly T[]): T[];
addPlaceholder(kind: EntryKind): string;                 // 'Write a task and press Enter… (@ to link)'
const KEY_LEGEND: readonly { text: string; color?: string }[];

// quick-keys.ts
const QUICK_KEYS: Record<string, EntryKind>;             // * . o - ! + ^
parseQuickKey(text: string, selectedKind: EntryKind): { kind: EntryKind; text: string };   // text trimmed, may be ''
const QUICK_KEYS_COPY: { title; keys; mentions };

// migrate.ts
type MigratablePage = { id: string; kind: PageKind; title: string; createdAt: number };
openTasks<T extends BulletInput>(entries: readonly T[]): T[];
migrationTarget<P extends MigratablePage>(page: MigratablePage, pages: readonly P[]): P | null;
newContinuationTitle(page: MigratablePage, pages: readonly { kind: PageKind }[]): string;   // 'Session n' / '<t> (cont.)'
migrationTip(target: { title: string } | null): string;
type MigrationPlan<P, E> = { target: P | null; newPage: { kind; title } | null; copies: E[]; migrate: E[] };
planMigration<P, E>(page, pages: readonly P[], entries: readonly E[]): MigrationPlan<P, E> | null;   // null = NOTE_NOTHING_TO_MIGRATE

// defaults.ts
const TAPES: readonly string[] (6 CSS backgrounds); const TAPE_COUNT = 6; const THREADS_TAPE = 4;
tapeBackground(tape: number): string;  nextTape(tape: number): number;  newPageTape(pages: readonly unknown[]): number;
type PageTemplate = { kind: PageKind; title: string; tape: number };
const GM_DEFAULT_PAGES, PLAYER_DEFAULT_PAGES: readonly PageTemplate[];
defaultPages(isGm: boolean): readonly PageTemplate[];    // template ref { template: i } = defaultPages(isGm)[i]
newPageTitle(kind: PageKind, pages: readonly { kind: PageKind }[]): string;   // unlinked pages
sessionLogTitle(session: { n: number; title?: string | null }): string;       // 'Session N' / 'Session N: <title>'
const PAGE_KIND_LABEL: Record<PageKind, string>;         // session log / collection / future log
const PAGE_GROUPS: readonly { kind; label; addLabel }[];

// visibility.ts
const PLAYER_VISIBILITIES, GM_VISIBILITIES: readonly Visibility[];
allowedVisibilities(isGm: boolean): readonly Visibility[];
isAllowedVisibility(isGm: boolean, visibility: Visibility): boolean;   // false -> NOTE_VISIBILITY_INVALID
defaultVisibility(isGm: boolean): Visibility;                          // GM 'private', player 'gm'
visibilityLabel(visibility: Visibility, ownerIsGm: boolean): string;   // chip / option label (Q14)
type Readers = { visibility: Visibility; gm: "yes" | "no" | "if-recipient"; players: "all" | "none" | "recipients" };
effectiveReaders(visibility, options: { ownerIsGm: boolean; departed: boolean }): Readers;
type ReadInput = { visibility; ownerIsGm; departed; viewer: "owner" | "gm" | "player"; isRecipient: boolean };
canReadPage(input: ReadInput): boolean;                  // the visibility table, bin excluded

// actions.ts
type PageActionInput = { isOwner; canRead; departed; viewerIsGm; visibility; binned?; isBinner? };
type EntryActionInput = { isOwner; isAuthor; canRead; departed };
canEditPage / canAdd / canBin / canRestore(input: PageActionInput): boolean;
canEditEntry / canCycle / canDeleteEntry / canArrangeEntry(input: EntryActionInput): boolean;
pageActions(input): { canEditPage; canMigrate; canAdd; canBin; canRestore };
entryActions(input): { canEditEntry; canCycle; canDeleteEntry; canStar; canMove };

// mentions.ts
const MENTION_TOKEN_RE: RegExp (global);  const MAX_MENTIONS = 10;
type TextPart = { type: "text"; text } | { type: "mention"; id; name };
sanitizeMentionName(name: string): string;   formatToken(name: string, id: string): string;
parseTokens(text: string): TextPart[];       countMentions(text): number;   mentionIds(text): string[];   // distinct
withinMentionLimit(text): boolean;           toPlainText(text): string;     // tokens -> stored names
activeMentionQuery(text: string, caret: number): { start: number; query: string } | null;
insertMention(text, start, end, ref: { id; name }): { text: string; caret: number };
type VisibleRef = { name: string; kind?: "character" | "location"; role?: string | null };
type RenderedPart = { type: "text"; text } | { type: "link"; id; text; tip };
renderParts(parts, visibleRefs: Record<string, VisibleRef> | Map<string, VisibleRef>): RenderedPart[];

// authors.ts
type PersonInput = { isGm: boolean; characterName?: string | null; accountName?: string | null };
authorLabel(person: PersonInput): string;                // 'GM' / character / account / 'Player'
authorSuffix(label: string): string;                     // ' - <label>'
isAddedEntry(entry: { authorId: string }, page: { ownerId: string }): boolean;
journalWho(owner: PersonInput & { className?: string | null }): { whoName: string; whoSub: string };
journalTitle(whoName: string): string;                   // '<whoName>’s Journal'
pastJournalTitle(owner: { characterName?; accountName? }): string;   // '<character>’s journal'

// export.ts
type ExportPage = { id; kind; title; createdAt; session?: { date?: string | null } | null };
type ExportEntry = { pageId; kind; state; star; text; order; addedBy?: string | null };
entryToMarkdown(entry): string;
journalToMarkdown(input: { whoName; pages; entries; options?: { locale?; timeZone? } }): string;

// summary.ts
headerLine(counts: { pageCount; entryCount }): string;  // 'N pages · M entries'
subLine(whoSub, counts): string;                        // '<whoSub> · N pages · M entries'
threadsButtonLabel(openCount): string;                  // '🧵 Open threads · N'
pageCountLabel(page: { openCount; entryCount }): string; // 'N open' / 'M' / ''
formatPageDate(at: number, options?): string;
pageMeta(page: { kind; createdAt }, session?: { date? } | null, options?: { locale?; timeZone? }): string;
emptyLine(kind: PageKind): string;  groupEmptyText(searching: boolean): string;
normalizeQuery(query): string;  matches(text, query): boolean;  pageMatches(page, entries, query): boolean;
tearLabel(pending: boolean): string;
const THREADS_COPY = { title, intro, empty };  threadPageLink(title): string;   // '<title> →'
```

## How later tracers use it
- **N0** (`convex/lib/validators/notes.ts`): build the kind / state / page kind / visibility validators from the value
  lists (`v.union(...ENTRY_KINDS.map(v.literal))`) or keep literal lists equal to them; the caps can come from
  `NOTE_LIMITS`. `permissionFor` on `journalPage` can call `canReadPage` with `viewer` = owner / gm / player,
  `isRecipient` from the `by_page_user` lookup and `departed` from `journalState`; binned pages stay N0's rule.
  `pageAccess` feeds `pageActions` / `entryActions` (`canRead` = the permissionFor result ignoring the bin).
  `ensureJournal` inserts `defaultPages(isGm)` with `defaultVisibility(isGm)`.
- **N2**: `newPageTitle`, `sessionLogTitle`, `newPageTape`, `nextTape`, `isValidTitle`, `journalWho`, `journalTitle`,
  `subLine`, `pageCountLabel`, `pageMeta`, `PAGE_GROUPS`, `tapeBackground`, `groupEmptyText`, `QUICK_KEYS_COPY`.
- **N3**: store `open: isOpenThread(entry)` on every write; `nextState`, `planMigration`, `parseQuickKey`,
  `mentionIds` + `withinMentionLimit`, `isValidEntryText`, `authorLabel` + `isAddedEntry` + `authorSuffix`, `BULLETS`,
  `glyphFor`, `bulletTip`, `isStruck`, `isDimmed`, `addPlaceholder`, `KEY_LEGEND`, `emptyLine`, `migrationTip`, `matches`.
- **N4**: `openThreads`, `THREADS_COPY`, `THREADS_TAPE`, `threadPageLink`, `threadsButtonLabel`, `pageMatches`,
  `journalToMarkdown`. The server's `search_text` index matches raw stored text (tokens include ids), so a title / entry
  hit from the index should be confirmed with `matches` when exact B9 behaviour is wanted.
- **N5**: `activeMentionQuery`, `insertMention`, `parseTokens`, `renderParts`, `MAX_MENTIONS`.
- **N6**: `allowedVisibilities`, `isAllowedVisibility`, `visibilityLabel`, `effectiveReaders`.
- **N7**: `binCutoff`, `binDaysLeft`, `daysLeftLabel`, `UNDO_MS`, `tearLabel`, `canBin`, `canRestore`.
- **N8**: `pastJournalTitle`, `journalWho`, `canReadPage`.

## Decisions and deviations
- Non-task kinds store "resolved" as state `done` (the board's value, l.244); N0's state validator holds the five
  `ENTRY_STATES`.
- `headerLine` writes "1 page · 1 entry" for a count of one; the board always writes the plural (same choice as D10 S1).
- Page counts for `newPageTitle`, `newContinuationTitle` and `newPageTape` are over the pages the caller passes; callers
  pass the journal's non-binned pages (what the index shows). The board counted every page it had.
- `migrationTarget` sorts by `createdAt` (ties by array order) instead of relying on the caller's array order.
- Generated titles are cut to TITLE_MAX (`clampTitle`), keeping " (cont.)" whole.
- Mentions render and export as the bare name without '@', as the board's links do. Names are sanitised (no brackets or
  line breaks) when a token is written.
- `canRestore` needs the caller to pass `canRead` as the binner's access ignoring the bin ("while they still have
  access"); for a GM-binned departed page that is the departed rule, so a rejoin that hides the page from the GM also
  ends the GM's restore.
- Export: struck lines are `~~text~~`; a page without entries writes `_No entries._`; line breaks become spaces.

## Verification
- `pnpm vitest run tests/unit/notes-domain.test.ts --maxWorkers=4 --testTimeout=60000`: 60 passed.
- `pnpm lint`, `pnpm typecheck`: clean.
- `pnpm tracer:guard .omc/plans/d11-notes.yaml N1`: clean.
