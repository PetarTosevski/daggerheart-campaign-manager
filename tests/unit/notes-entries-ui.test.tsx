// D11 N3: the entries slot (src/components/notes/entries) with its optimistic updates (src/lib/optimistic/notes-entries.ts).
// convex/react is replaced by a tiny local store that runs each mutation's optimistic updater the way the Convex
// client does (synchronously, on the cached query), so the tests see what a user sees before the server answers.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../../convex/_generated/dataModel";
import type { EntryRow, PageEntries } from "../../convex/notesEntries";
import type { NotesSlotProps } from "../../src/components/notes/slots";

const calls: { name: string; args: Record<string, unknown> }[] = [];
const functionName = (ref: unknown) => String((ref as Record<symbol, unknown>)[Symbol.for("functionName")] ?? ref);

const cache = {
  value: undefined as PageEntries | undefined,
  args: {} as Record<string, unknown>,
  listeners: new Set<() => void>(),
  set(next: PageEntries | undefined) {
    cache.value = next;
    for (const listener of cache.listeners) listener();
  },
};

const store = {
  getQuery: () => cache.value,
  getAllQueries: () => [{ args: cache.args, value: cache.value }],
  setQuery: (_ref: unknown, _args: unknown, value: PageEntries | undefined) => cache.set(value),
};

type Updater = (s: typeof store, args: Record<string, unknown>) => void;

vi.mock("convex/react", () => ({
  useQuery: (_ref: unknown, args: Record<string, unknown>) => {
    cache.args = args;
    return useSyncExternalStore(
      (listener) => {
        cache.listeners.add(listener);
        return () => cache.listeners.delete(listener);
      },
      () => cache.value,
    );
  },
  useMutation: (ref: unknown) => {
    const name = functionName(ref);
    const make = (updater?: Updater) => {
      const run = async (args: Record<string, unknown>) => {
        updater?.(store, args);
        calls.push({ name, args });
        return name.endsWith("migrateOpen") ? { pageId: "p2", created: true } : null;
      };
      return Object.assign(run, { withOptimisticUpdate: (u: Updater) => make(u) });
    };
    return make();
  },
}));

const { Entries, MigrateButton } = await import("@/components/notes/entries");

/**
 * Replaces the text of the rich entry editor (a contenteditable since dcm-bxp.106; jsdom has no editing) and puts the
 * caret at its end, then fires `input` as typing would.
 */
function write(editor: HTMLElement, text: string) {
  act(() => {
    const node = document.createTextNode(text);
    editor.replaceChildren(node);
    const range = document.createRange();
    range.setStart(node, node.length);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(range);
    fireEvent.input(editor);
  });
}

const CAMPAIGN = "c1" as Id<"campaigns">;

function row(id: string, patch: Partial<EntryRow> = {}): EntryRow {
  return {
    _id: id as EntryRow["_id"],
    kind: "task",
    state: "open",
    star: false,
    text: `entry ${id}`,
    order: Number(id.replace(/\D/g, "")) || 0,
    open: true,
    added: false,
    authorLabel: "Ash",
    canEdit: true,
    canCycle: true,
    canDelete: true,
    canStar: true,
    canMove: true,
    ...patch,
  };
}

function page(entries: EntryRow[], patch: Partial<PageEntries> = {}): PageEntries {
  return { kind: "log", canAdd: true, canArrange: true, migrateTarget: null, entries, ...patch };
}

function props(patch: Partial<NotesSlotProps> = {}): NotesSlotProps {
  return {
    campaignId: CAMPAIGN,
    access: { isGm: false },
    journalId: null,
    pageId: "page1",
    view: "page",
    search: "",
    matchingPageIds: null,
    onPage: vi.fn(),
    onView: vi.fn(),
    onSearch: vi.fn(),
    ...patch,
  };
}

const named = (name: string) => calls.filter((c) => c.name.endsWith(`:${name}`));

beforeEach(() => {
  calls.length = 0;
  cache.set(undefined);
});

describe("Entries (D11 N3)", () => {
  it("shows the loading line, then the kind's empty line, the add row and the KEY", () => {
    render(<Entries {...props()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading entries…");
    act(() => cache.set(page([], { kind: "future" })));
    expect(screen.getByText("Plans, festivals, deadlines, things coming due…")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "New entry" })).toHaveAttribute("placeholder", "Write a task and press Enter… (@ to link)");
    expect(screen.getByText("KEY")).toBeInTheDocument();
    expect(screen.getByText("☠ Fear · a threat")).toBeInTheDocument();
  });

  it("two quick clicks on a task bullet advance two states (CL4): two intents, the bullet shows > at once", () => {
    cache.set(page([row("e1")]));
    render(<Entries {...props()} />);
    const bullet = screen.getByRole("button", { name: "Task: open. Click to change." });
    fireEvent.click(bullet);
    fireEvent.click(screen.getByRole("button", { name: /^Task: / }));
    expect(named("cycle")).toHaveLength(2);
    expect(named("cycle").map((c) => c.args)).toEqual([
      { campaignId: CAMPAIGN, entryId: "e1" },
      { campaignId: CAMPAIGN, entryId: "e1" },
    ]);
    const now = screen.getByRole("button", { name: "Task: migrated. Click to change." });
    expect(now).toHaveTextContent(">");
    expect(cache.value?.entries[0]).toMatchObject({ state: "migrated", open: false });
  });

  it("'^ ambush' adds a Fear: the quick key picks the kind and is dropped, the row shows ☠ before the server answers", () => {
    cache.set(page([]));
    render(<Entries {...props({ pageId: "template-0" })} />);
    const input = screen.getByRole("textbox", { name: "New entry" });
    write(input, "^ ambush");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(named("add").map((c) => c.args)).toEqual([{ campaignId: CAMPAIGN, page: { template: 0 }, kind: "fear", text: "ambush" }]);
    const list = screen.getByRole("list", { name: "Entries" });
    expect(within(list).getByRole("button", { name: "Fear. Click to mark resolved." })).toHaveTextContent("☠");
    expect(within(list).getByText("ambush")).toBeInTheDocument();
  });

  it("the first write on a default page keeps the add row mounted while the new page loads (dcm-bxp.102)", () => {
    cache.set(page([]));
    const { rerender } = render(<Entries {...props({ pageId: "template-0" })} />);
    const group = screen.getByRole("radiogroup", { name: "Bullet type" });
    fireEvent.click(within(group).getByRole("radio", { name: /Hope/ }));
    const input = screen.getByRole("textbox", { name: "New entry" });
    expect(input).toHaveFocus();
    write(input, "Old Mag runs the ferry");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(named("add").map((c) => c.args)).toEqual([{ campaignId: CAMPAIGN, page: { template: 0 }, kind: "hope", text: "Old Mag runs the ferry" }]);

    // The journal now exists: the page gets its id and its subscription has no answer yet.
    act(() => {
      cache.set(undefined);
      rerender(<Entries {...props({ pageId: "page9" })} />);
    });
    expect(screen.queryByText("Loading entries…")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "New entry" })).toBe(input);
    expect(input).toHaveFocus();
    expect(within(group).getByRole("radio", { name: /Hope/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("Old Mag runs the ferry")).toBeInTheDocument();
    write(input, "typed while loading");

    act(() => cache.set(page([row("e1", { kind: "hope", text: "Old Mag runs the ferry" })])));
    expect(screen.getByRole("textbox", { name: "New entry" })).toBe(input);
    expect(input).toHaveFocus();
    expect(input).toHaveTextContent("typed while loading");
    expect(within(group).getByRole("radio", { name: /Hope/ })).toHaveAttribute("aria-checked", "true");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(named("add")[1]!.args).toEqual({ campaignId: CAMPAIGN, page: "page9", kind: "hope", text: "typed while loading" });
  });

  it("opening another written page still shows the loading line (no stale rows)", () => {
    cache.set(page([row("e1", { text: "on page one" })]));
    const { rerender } = render(<Entries {...props({ pageId: "page1" })} />);
    act(() => {
      cache.set(undefined);
      rerender(<Entries {...props({ pageId: "page2" })} />);
    });
    expect(screen.getByRole("status")).toHaveTextContent("Loading entries…");
    expect(screen.queryByText("on page one")).not.toBeInTheDocument();
  });

  it("the Bullet type chips are a radiogroup with aria-checked only; arrows move the choice and the placeholder follows", () => {
    cache.set(page([]));
    render(<Entries {...props()} />);
    const group = screen.getByRole("radiogroup", { name: "Bullet type" });
    const task = within(group).getByRole("radio", { name: /Task/ });
    expect(task).toHaveAttribute("aria-checked", "true");
    expect(task).not.toHaveAttribute("aria-pressed");
    fireEvent.keyDown(task, { key: "ArrowRight" });
    expect(within(group).getByRole("radio", { name: /Event/ })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(within(group).getByRole("radio", { name: /Hope/ }));
    expect(screen.getByRole("textbox", { name: "New entry" })).toHaveAttribute("placeholder", "Write a hope and press Enter… (@ to link)");
  });

  it("an added entry renders in the added colour ending ' - GM'; the owner's own entry has no suffix", () => {
    cache.set(page([row("e1", { text: "find the ferryman" }), row("e2", { text: "the ferryman lies", added: true, authorLabel: "GM", canEdit: false })]));
    render(<Entries {...props()} />);
    const added = screen.getByText("the ferryman lies").closest(".bj-text");
    expect(added).toHaveClass("bj-added");
    expect(added).toHaveTextContent("the ferryman lies - GM");
    const own = screen.getByText("find the ferryman").closest(".bj-text");
    expect(own).not.toHaveClass("bj-added");
    expect(own).toHaveTextContent(/^find the ferryman$/);
  });

  it("a reader sees the add row and no owner controls (no star, edit, move, delete, migrate; the bullet does nothing)", () => {
    cache.set(
      page([row("e1", { canEdit: false, canCycle: false, canDelete: false, canStar: false, canMove: false })], { canArrange: false, canAdd: true }),
    );
    render(
      <>
        <MigrateButton {...props()} />
        <Entries {...props()} />
      </>,
    );
    expect(screen.getByRole("textbox", { name: "New entry" })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Bullet type" })).toBeInTheDocument();
    for (const name of ["Toggle priority", "Edit entry", "Move up", "Delete entry", "➜ Migrate open tasks"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    const bullet = screen.getByRole("button", { name: "Task: open. Click to change." });
    expect(bullet).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(bullet);
    expect(calls).toHaveLength(0);
  });

  it("star, move up, delete and edit are one intent each and show at once; Escape cancels an edit", () => {
    cache.set(page([row("e1", { text: "first" }), row("e2", { text: "second" })]));
    render(<Entries {...props()} />);
    const second = screen.getByText("second").closest("li")!;
    fireEvent.click(within(second).getByRole("button", { name: "Toggle priority" }));
    expect(within(screen.getByText("second").closest("li")!).getByRole("img", { name: "Priority" })).toBeInTheDocument();
    fireEvent.click(within(screen.getByText("second").closest("li")!).getByRole("button", { name: "Move up" }));
    expect(cache.value?.entries.map((e) => e.text)).toEqual(["second", "first"]);
    expect(within(screen.getByText("second").closest("li")!).getByRole("button", { name: "Move up" })).toBeDisabled();

    fireEvent.doubleClick(screen.getByText("first"));
    const edit = screen.getByRole("textbox", { name: "Edit entry" });
    expect(edit).toHaveFocus();
    fireEvent.keyDown(edit, { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "Edit entry" })).toBeNull();
    fireEvent.click(within(screen.getByText("first").closest("li")!).getByRole("button", { name: "Edit entry" }));
    const again = screen.getByRole("textbox", { name: "Edit entry" });
    write(again, "first, revised");
    fireEvent.keyDown(again, { key: "Enter" });
    expect(screen.getByText("first, revised")).toBeInTheDocument();
    fireEvent.click(within(screen.getByText("first, revised").closest("li")!).getByRole("button", { name: "Delete entry" }));
    expect(screen.queryByText("first, revised")).toBeNull();
    expect(calls.map((c) => c.name.split(":")[1])).toEqual(["toggleStar", "moveUp", "setText", "remove"]);
    expect(named("setText")[0]!.args).toEqual({ campaignId: CAMPAIGN, entryId: "e1", text: "first, revised" });
  });

  it("editing an entry with a mention shows a name chip, not the token, and blur saves the token text once (dcm-bxp.106)", () => {
    cache.set(page([row("e1", { text: "met @[Marlow](k1) at dusk" })]));
    render(<Entries {...props()} />);
    fireEvent.click(within(screen.getByRole("list", { name: "Entries" })).getByRole("button", { name: "Edit entry" }));
    const edit = screen.getByRole("textbox", { name: "Edit entry" });
    expect(edit).toHaveFocus();
    expect(edit).toHaveTextContent("met Marlow at dusk");
    expect(edit.textContent).not.toContain("k1");
    expect(edit.querySelector(".bj-mi-chip")).toHaveTextContent("Marlow");
    act(() => {
      edit.append(document.createTextNode(" by the ford"));
      fireEvent.input(edit);
    });
    act(() => edit.blur());
    expect(named("setText").map((c) => c.args.text)).toEqual(["met @[Marlow](k1) at dusk by the ford"]);
    expect(screen.queryByRole("textbox", { name: "Edit entry" })).toBeNull();
  });

  it("search highlights matching rows by their text, mention names included", () => {
    cache.set(page([row("e1", { text: "met @[Old Mag](k1) at the ford" }), row("e2", { text: "bought rope" })]));
    render(<Entries {...props({ search: "old mag" })} />);
    expect(screen.getByText(/met/).closest("li")).toHaveClass("bj-hit");
    expect(screen.getByText("bought rope").closest("li")).not.toHaveClass("bj-hit");
  });

  it("Migrate: disabled without open tasks; the tooltip names the target; a click opens the target page", async () => {
    const onPage = vi.fn();
    cache.set(page([row("e1", { state: "done", open: false })]));
    const { rerender } = render(<MigrateButton {...props({ onPage })} />);
    const button = screen.getByRole("button", { name: "➜ Migrate open tasks" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "Copy open tasks to a new page and mark them > here");
    act(() => cache.set(page([row("e1")], { migrateTarget: { title: "Session 2" } })));
    rerender(<MigrateButton {...props({ onPage })} />);
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute("title", "Copy open tasks to “Session 2” and mark them > here");
    await act(async () => {
      fireEvent.click(button);
    });
    expect(named("migrateOpen").map((c) => c.args)).toEqual([{ campaignId: CAMPAIGN, page: "page1" }]);
    expect(onPage).toHaveBeenCalledWith("p2", "page");
  });
});
