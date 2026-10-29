import type { OptimisticLocalStore } from "convex/browser";
import { insertAtTop } from "convex/react";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { MessageView } from "../../../../convex/lorekeeper";

/**
 * LK3: the optimistic update of `lorekeeper.editQuestion`. In the loaded pages of the conversation's newest-first
 * message list, every message after the edited question goes, the question shows its new text and a pending answer
 * goes on top (the thinking row), as the server will write them. Never mutates a store object; does nothing when the
 * question is not loaded. The conversation is the loaded question's own (the mutation's args name only the question).
 */
export function editLocally(
  store: OptimisticLocalStore,
  args: { campaignId: Id<"campaigns">; questionId: Id<"lorekeeperMessages">; question: string },
  now = Date.now(),
): void {
  const all = store.getAllQueries(api.lorekeeper.listMessages).filter(({ args: query, value }) => value !== undefined && query.campaignId === args.campaignId);
  const question = all.flatMap(({ value }) => value?.page ?? []).find((m) => m._id === args.questionId);
  if (question === undefined) return;
  const conversationId = question.conversationId;
  const loaded = all.filter(({ args: query }) => query.conversationId === conversationId);
  const text = args.question.trim();
  for (const { args: query, value } of loaded) {
    if (value === undefined) continue;
    const page = value.page
      .filter((m) => m._creationTime <= question._creationTime)
      .map((m) => (m._id === question._id ? { ...m, text, updatedAt: now } : m));
    store.setQuery(api.lorekeeper.listMessages, query, { ...value, page });
  }
  const answer: MessageView = {
    _id: "optimistic-answer" as Id<"lorekeeperMessages">,
    _creationTime: Math.max(now, question._creationTime + 1),
    conversationId,
    role: "answer",
    status: "pending",
    text: "",
    createdAt: now,
    updatedAt: now,
  };
  insertAtTop({ paginatedQuery: api.lorekeeper.listMessages, argsToMatch: { campaignId: args.campaignId, conversationId }, localQueryStore: store, item: answer });
}
