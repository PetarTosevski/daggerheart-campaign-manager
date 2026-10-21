/**
 * Notes domain (D11 N1): bullet kinds and states, quick keys, open threads, migration, default pages and titles, tapes,
 * visibility rules and labels, the action table, mention tokens, authors and journal names, the Markdown export, the
 * header line, page meta and search matching. Pure TypeScript with structural input types, shared by Convex and the
 * browser; relative imports only, no framework. The API is listed in docs/tasks/TASK-D11-N1.md.
 *
 * Server (N0 convex/lib/notes.ts pageAccess, N2, N3, N6, N7): canReadPage, pageActions, entryActions,
 *   isAllowedVisibility, defaultVisibility, defaultPages, newPageTitle, sessionLogTitle, newPageTape, nextTape,
 *   nextState, isOpenThread, planMigration, mentionIds, withinMentionLimit, isValidTitle, isValidEntryText, NOTE_LIMITS,
 *   binCutoff, authorLabel.
 * Client (N2-N8): BULLETS, glyphFor, bulletTip, isStruck, isDimmed, parseQuickKey, addPlaceholder, KEY_LEGEND, TAPES,
 *   tapeBackground, PAGE_GROUPS, visibilityLabel, effectiveReaders, parseTokens, renderParts, activeMentionQuery,
 *   insertMention, journalWho, journalTitle, subLine, threadsButtonLabel, pageCountLabel, pageMeta, emptyLine, matches,
 *   pageMatches, journalToMarkdown, binDaysLeft, daysLeftLabel.
 */

export * from "./types";
export * from "./limits";
export * from "./bullets";
export * from "./quick-keys";
export * from "./migrate";
export * from "./defaults";
export * from "./visibility";
export * from "./actions";
export * from "./mentions";
export * from "./authors";
export * from "./export";
export * from "./summary";
