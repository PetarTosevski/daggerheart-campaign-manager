import type { OptimisticLocalStore } from "convex/browser";
import { insertAtTop, optimisticallyUpdateValueInPaginatedQuery } from "convex/react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { ConversationView, MessageView } from "../../../convex/lorekeeper";
import type { ConversationVisibility } from "../../../convex/lib/validators/lorekeeper";

/**
 * Optimistic updaters for the Lorekeeper's chat (D13 L6, CL4): the question bubble and the thinking row appear the
 * moment the member asks, Stop ends the answer at once, the toggles flip and a deleted conversation leaves the menu
 * before the server answers. Each mirrors one intent of convex/lorekeeper.ts (or lorekeeperAsks.send); none mutates a
 * store object, and each skips a query that is not loaded.
 */

type Campaign = { campaignId: Id<"campaigns"> };

/** A placeholder id for a row the server has not written yet (never sent back to the server). */
function localId<T extends "lorekeeperMessages">(label: string): Id<T> {
  return `optimistic-${label}` as Id<T>;
}

/** True for a message the optimistic update made up (no actions on it). */
export function isLocalMessage(id: string): boolean {
  return id.startsWith("optimistic-");
}

/**
 * `lorekeeper.ask` in an existing conversation: the question and a pending answer go on top of the newest-first
 * message list (the answer above the question, as the server orders them).
 */
export function askLocally(
  store: OptimisticLocalStore,
  args: Campaign & { conversationId?: Id<"lorekeeperConversations">; question: string; webSearch: boolean },
  now = Date.now(),
): void {
  const conversationId = args.conversationId;
  if (conversationId === undefined) return;
  const base = { conversationId, createdAt: now, updatedAt: now };
  const question: MessageView = {
    ...base,
    _id: localId("question"),
    _creationTime: now,
    role: "question",
    status: "done",
    text: args.question.trim(),
  };
  const answer: MessageView = { ...base, _id: localId("answer"), _creationTime: now + 1, role: "answer", status: "pending", text: "" };
  const argsToMatch = { campaignId: args.campaignId, conversationId };
  insertAtTop({ paginatedQuery: api.lorekeeper.listMessages, argsToMatch, localQueryStore: store, item: question });
  insertAtTop({ paginatedQuery: api.lorekeeper.listMessages, argsToMatch, localQueryStore: store, item: answer });
  patchConversation(store, args.campaignId, conversationId, (row) => ({ webSearch: args.webSearch, messageCount: row.messageCount + 2, lastAt: now }));
}

/** `lorekeeper.stop`: the answer shows as stopped with the text it has. */
export function stopLocally(
  store: OptimisticLocalStore,
  args: Campaign & { answerId: Id<"lorekeeperMessages"> },
  conversationId: Id<"lorekeeperConversations">,
): void {
  optimisticallyUpdateValueInPaginatedQuery(store, api.lorekeeper.listMessages, { campaignId: args.campaignId, conversationId }, (row) =>
    row._id === args.answerId && (row.status === "pending" || row.status === "streaming") ? { ...row, status: "stopped" as const } : row,
  );
}

/** Applies `patch` to one conversation in `getConversation` and in both lists of `listConversations`. */
function patchConversation(
  store: OptimisticLocalStore,
  campaignId: Id<"campaigns">,
  conversationId: Id<"lorekeeperConversations">,
  patch: (row: ConversationView) => Partial<ConversationView>,
): void {
  const one = store.getQuery(api.lorekeeper.getConversation, { campaignId, conversationId });
  if (one !== undefined) store.setQuery(api.lorekeeper.getConversation, { campaignId, conversationId }, { ...one, ...patch(one) });
  const lists = store.getQuery(api.lorekeeper.listConversations, { campaignId });
  if (lists === undefined) return;
  const apply = (rows: ConversationView[]) => rows.map((row) => (row._id === conversationId ? { ...row, ...patch(row) } : row));
  store.setQuery(api.lorekeeper.listConversations, { campaignId }, { mine: apply(lists.mine), shared: apply(lists.shared) });
}

/** `lorekeeper.setWebSearch`: the conversation's 'If the books don’t say' toggle. */
export function setWebSearchLocally(store: OptimisticLocalStore, args: Campaign & { conversationId: Id<"lorekeeperConversations">; webSearch: boolean }): void {
  patchConversation(store, args.campaignId, args.conversationId, () => ({ webSearch: args.webSearch }));
}

/** `lorekeeper.setVisibility`: public to the campaign or private (Q3). */
export function setVisibilityLocally(
  store: OptimisticLocalStore,
  args: Campaign & { conversationId: Id<"lorekeeperConversations">; visibility: ConversationVisibility },
): void {
  patchConversation(store, args.campaignId, args.conversationId, () => ({ visibility: args.visibility }));
}

/** `lorekeeper.removeConversation`: the conversation leaves the menu. */
export function removeConversationLocally(store: OptimisticLocalStore, args: Campaign & { conversationId: Id<"lorekeeperConversations"> }): void {
  const lists = store.getQuery(api.lorekeeper.listConversations, { campaignId: args.campaignId });
  if (lists === undefined) return;
  const keep = (rows: ConversationView[]) => rows.filter((row) => row._id !== args.conversationId);
  store.setQuery(api.lorekeeper.listConversations, { campaignId: args.campaignId }, { mine: keep(lists.mine), shared: keep(lists.shared) });
}

/** `lorekeeperAsks.send`: the answer counts as sent to the GM ('Sent to the GM'). */
export function askGmLocally(store: OptimisticLocalStore, args: Campaign & { messageId: Id<"lorekeeperMessages"> }, now = Date.now()): void {
  const mine = store.getQuery(api.lorekeeperAsks.mine, { campaignId: args.campaignId });
  if (mine === undefined || mine.some((row) => row.messageId === args.messageId)) return;
  store.setQuery(api.lorekeeperAsks.mine, { campaignId: args.campaignId }, [
    ...mine,
    { _id: `optimistic-ask-${args.messageId}` as Id<"lorekeeperAsks">, messageId: args.messageId, askedAt: now },
  ]);
}
