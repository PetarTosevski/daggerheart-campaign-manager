// D13 L6: the optimistic updaters of src/lib/optimistic/lorekeeper.ts on a fake local store (no mutation of store
// objects, unloaded queries skipped).
import { describe, expect, it, vi } from "vitest";

vi.mock("convex/react", () => ({
  insertAtTop: ({ localQueryStore, item, argsToMatch }: { localQueryStore: Store; item: unknown; argsToMatch: unknown }) => {
    const key = `messages:${JSON.stringify(argsToMatch)}`;
    const page = localQueryStore.data.get(key) as unknown[] | undefined;
    if (page) localQueryStore.data.set(key, [item, ...page]);
  },
  optimisticallyUpdateValueInPaginatedQuery: (store: Store, _q: unknown, args: unknown, update: (v: unknown) => unknown) => {
    const key = `messages:${JSON.stringify(args)}`;
    const page = store.data.get(key) as unknown[] | undefined;
    if (page) store.data.set(key, page.map(update));
  },
}));

type Store = { data: Map<string, unknown>; getQuery: (ref: unknown, args: unknown) => unknown; setQuery: (ref: unknown, args: unknown, value: unknown) => void };

const functionName = (ref: unknown) => String((ref as Record<symbol, unknown>)[Symbol.for("functionName")] ?? ref);
function makeStore(): Store {
  const data = new Map<string, unknown>();
  return {
    data,
    getQuery: (ref, args) => data.get(`${functionName(ref)}:${JSON.stringify(args)}`),
    setQuery: (ref, args, value) => data.set(`${functionName(ref)}:${JSON.stringify(args)}`, value),
  };
}

const { askLocally, stopLocally, setWebSearchLocally, removeConversationLocally, askGmLocally, isLocalMessage } = await import("@/lib/optimistic/lorekeeper");
import type { Id } from "../../../convex/_generated/dataModel";

const campaignId = "c1" as Id<"campaigns">;
const conversationId = "v1" as Id<"lorekeeperConversations">;
const conv = { _id: conversationId, title: "t", userId: "u1", mine: true, visibility: "campaign", webSearch: true, messageCount: 2, lastAt: 1, createdAt: 1 };

describe("lorekeeper optimistic updaters", () => {
  it("puts the question and a pending answer on top of a loaded conversation", () => {
    const store = makeStore();
    const key = `messages:${JSON.stringify({ campaignId, conversationId })}`;
    const old = [{ _id: "a0", role: "answer", status: "done" }];
    store.data.set(key, old);
    store.setQuery("lorekeeper:listConversations", { campaignId }, { mine: [conv], shared: [] });
    askLocally(store as never, { campaignId, conversationId, question: "  Do crits stack? ", webSearch: false }, 5);
    const page = store.data.get(key) as { _id: string; role: string; status: string; text: string }[];
    expect(page.map((m) => [m.role, m.status, m.text])).toEqual([
      ["answer", "pending", ""],
      ["question", "done", "Do crits stack?"],
      ["answer", "done", undefined],
    ]);
    expect(isLocalMessage(page[0]!._id)).toBe(true);
    expect(old).toHaveLength(1);
    const lists = store.getQuery("lorekeeper:listConversations", { campaignId }) as { mine: (typeof conv)[] };
    expect(lists.mine[0]).toMatchObject({ webSearch: false, messageCount: 4, lastAt: 5 });
  });

  it("does nothing for a new conversation (the chat shows its own pending bubble)", () => {
    const store = makeStore();
    askLocally(store as never, { campaignId, question: "q", webSearch: true });
    expect(store.data.size).toBe(0);
  });

  it("stops only the in-flight answer", () => {
    const store = makeStore();
    const key = `messages:${JSON.stringify({ campaignId, conversationId })}`;
    store.data.set(key, [
      { _id: "a2", status: "streaming" },
      { _id: "a1", status: "done" },
    ]);
    stopLocally(store as never, { campaignId, answerId: "a2" as Id<"lorekeeperMessages"> }, conversationId);
    expect((store.data.get(key) as { status: string }[]).map((m) => m.status)).toEqual(["stopped", "done"]);
  });

  it("flips the toggle and removes a deleted conversation, skipping unloaded queries", () => {
    const store = makeStore();
    setWebSearchLocally(store as never, { campaignId, conversationId, webSearch: false });
    removeConversationLocally(store as never, { campaignId, conversationId });
    expect(store.data.size).toBe(0);
    store.setQuery("lorekeeper:listConversations", { campaignId }, { mine: [conv], shared: [] });
    store.setQuery("lorekeeper:getConversation", { campaignId, conversationId }, conv);
    setWebSearchLocally(store as never, { campaignId, conversationId, webSearch: false });
    expect((store.getQuery("lorekeeper:getConversation", { campaignId, conversationId }) as typeof conv).webSearch).toBe(false);
    expect(conv.webSearch).toBe(true);
    removeConversationLocally(store as never, { campaignId, conversationId });
    expect(store.getQuery("lorekeeper:listConversations", { campaignId })).toEqual({ mine: [], shared: [] });
  });

  it("marks an answer sent to the GM once", () => {
    const store = makeStore();
    store.setQuery("lorekeeperAsks:mine", { campaignId }, []);
    const messageId = "m1" as Id<"lorekeeperMessages">;
    askGmLocally(store as never, { campaignId, messageId }, 7);
    askGmLocally(store as never, { campaignId, messageId }, 8);
    expect(store.getQuery("lorekeeperAsks:mine", { campaignId })).toEqual([{ _id: "optimistic-ask-m1", messageId, askedAt: 7 }]);
  });
});
