// LK3: editing a sent question. The bubble's Edit / Save / Cancel (nothing is sent until Save) and the optimistic
// update of lorekeeper.editQuestion on a fake local store.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("convex/react", () => ({
  insertAtTop: ({ localQueryStore, item, argsToMatch }: { localQueryStore: Store; item: unknown; argsToMatch: Record<string, unknown> }) => {
    const first = localQueryStore.queries.find((q) => q.args.conversationId === argsToMatch.conversationId && q.args.paginationOpts.cursor === null);
    if (first) first.value = { ...first.value, page: [item as Row, ...first.value.page] };
  },
}));

type Row = { _id: string; _creationTime: number; conversationId: string; role: string; text: string; status: string };
type Query = { args: { campaignId: string; conversationId: string; paginationOpts: { cursor: string | null } }; value: { page: Row[]; isDone: boolean } };
type Store = { queries: Query[]; getAllQueries: () => Query[]; setQuery: (ref: unknown, args: Query["args"], value: Query["value"]) => void };

function makeStore(queries: Query[]): Store {
  return {
    queries,
    getAllQueries: () => queries.map((q) => ({ ...q })),
    setQuery: (_ref, args, value) => {
      const found = queries.find((q) => q.args === args);
      if (found) found.value = value;
    },
  };
}

const { QuestionBubble } = await import("@/components/lorekeeper/chat/question");
const { editLocally } = await import("@/components/lorekeeper/chat/edit");
import type { Id } from "../../../convex/_generated/dataModel";

describe("QuestionBubble (LK3)", () => {
  it("opens the question in place, sends nothing while editing, and saves the edited text once", async () => {
    const onEdit = vi.fn(async () => true);
    render(<QuestionBubble asker="You" text="Do Hexes stack?" onEdit={onEdit} waiting={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit question" }));
    const box = screen.getByRole("textbox", { name: "Edit your question" });
    expect(box).toHaveProperty("value", "Do Hexes stack?");
    fireEvent.change(box, { target: { value: "Do two Hexes stack on one target?" } });
    expect(onEdit).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save" })));
    expect(onEdit).toHaveBeenCalledExactlyOnceWith("Do two Hexes stack on one target?");
    expect(screen.queryByRole("textbox", { name: "Edit your question" })).toBeNull();
  });

  it("Cancel and Escape leave the question as it was; unchanged text asks nothing", async () => {
    const onEdit = vi.fn(async () => true);
    render(<QuestionBubble asker="You" text="Do Hexes stack?" onEdit={onEdit} waiting={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit question" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Changed" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Do Hexes stack?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit question" }));
    expect(screen.getByRole("textbox")).toHaveProperty("value", "Do Hexes stack?");
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit question" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save" })));
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("Save waits while an answer is on its way, and a failed save keeps the draft", async () => {
    const onEdit = vi.fn(async () => false);
    const { rerender } = render(<QuestionBubble asker="You" text="Q" onEdit={onEdit} waiting="Wait for it." />);
    fireEvent.click(screen.getByRole("button", { name: "Edit question" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Q2" } });
    expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);
    expect(screen.getByText("Wait for it.")).toBeTruthy();
    rerender(<QuestionBubble asker="You" text="Q" onEdit={onEdit} waiting={null} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save" })));
    expect(onEdit).toHaveBeenCalledOnce();
    expect(screen.getByRole("textbox")).toHaveProperty("value", "Q2");
  });

  it("has no Edit action without onEdit (another member's question)", () => {
    render(<QuestionBubble asker="Moss" text="Q" waiting={null} />);
    expect(screen.queryByRole("button", { name: "Edit question" })).toBeNull();
  });
});

describe("editLocally (LK3)", () => {
  const campaignId = "c1" as Id<"campaigns">;
  const row = (id: string, t: number, role: string, text = id): Row => ({ _id: id, _creationTime: t, conversationId: "v1", role, text, status: "done" });

  it("drops every message after the edited question, shows its new text and a pending answer on top", () => {
    const first: Query = {
      args: { campaignId, conversationId: "v1", paginationOpts: { cursor: null } },
      value: { page: [row("a3", 6, "answer"), row("q3", 5, "question"), row("a2", 4, "answer"), row("q2", 3, "question")], isDone: false },
    };
    const older: Query = { args: { campaignId, conversationId: "v1", paginationOpts: { cursor: "x" } }, value: { page: [row("a1", 2, "answer"), row("q1", 1, "question")], isDone: true } };
    const other: Query = { args: { campaignId, conversationId: "v2", paginationOpts: { cursor: null } }, value: { page: [row("z", 9, "answer")], isDone: true } };
    const before = first.value;
    const store = makeStore([first, older, other]);
    editLocally(store as never, { campaignId, questionId: "q2" as Id<"lorekeeperMessages">, question: "  Edited?  " }, 10);
    expect(first.value.page.map((m) => [m._id, m.role, m.status, m.text])).toEqual([
      ["optimistic-answer", "answer", "pending", ""],
      ["q2", "question", "done", "Edited?"],
    ]);
    expect(older.value.page.map((m) => m._id)).toEqual(["a1", "q1"]);
    expect(other.value.page.map((m) => m._id)).toEqual(["z"]);
    expect(before.page).toHaveLength(4);
  });

  it("does nothing when the question is not loaded", () => {
    const only: Query = { args: { campaignId, conversationId: "v1", paginationOpts: { cursor: null } }, value: { page: [row("a1", 2, "answer")], isDone: true } };
    editLocally(makeStore([only]) as never, { campaignId, questionId: "q9" as Id<"lorekeeperMessages">, question: "x" });
    expect(only.value.page.map((m) => m._id)).toEqual(["a1"]);
  });
});
