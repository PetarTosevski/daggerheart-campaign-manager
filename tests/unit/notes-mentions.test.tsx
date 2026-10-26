// D11 N5: the mentions slot (src/components/notes/mentions): the @ picker in MentionInput (a rich editor with name
// chips since dcm-bxp.106) and the links in EntryText.
// convex/react's useQuery is replaced by the viewer's `codex.list` result held here (GM: every entry; a player: only
// the entries the party knows, as the server returns them).
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../../convex/_generated/dataModel";
import { placeCaret, serializeEditor } from "../../src/components/notes/mentions/editor-dom";
import { codexHref, pickerOptions, type CodexRef } from "../../src/components/notes/mentions/options";

type Entry = CodexRef & { known?: boolean };
let codex: { role: "gm" | "player"; entries: Entry[] } | undefined;
const queried: unknown[] = [];

vi.mock("convex/react", () => ({
  useQuery: (_ref: unknown, args: unknown) => {
    queried.push(args);
    return args === "skip" ? undefined : codex;
  },
}));

const { EntryText, MentionInput } = await import("@/components/notes/mentions");

const CAMPAIGN = "c1" as Id<"campaigns">;
const ENTRIES: Entry[] = [
  { _id: "k1", kind: "character", name: "Marlow", role: "Ferryman" },
  { _id: "k2", kind: "character", name: "Old Mag", role: "" },
  { _id: "k3", kind: "location", name: "Mabry Ford", role: "" },
  { _id: "k4", kind: "character", name: "Sable", role: "Smuggler" },
  { _id: "k5", kind: "character", name: "", role: "" },
];

beforeEach(() => {
  codex = { role: "gm", entries: ENTRIES };
  queried.length = 0;
});

function setup(props: { defaultValue?: string; onCancel?: () => void; onBlurText?: (text: string) => void } = {}) {
  const onSubmit = vi.fn();
  render(<MentionInput campaignId={CAMPAIGN} label="New entry" placeholder="Write…" onSubmit={onSubmit} {...props} />);
  const editor = screen.getByRole("textbox", { name: "New entry" });
  /** Types at the end of the editor (jsdom has no editing: the text goes into the last text node, then `input`). */
  const type = (text: string) =>
    act(() => {
      let last = editor.lastChild;
      if (last === null || last.nodeType !== Node.TEXT_NODE) {
        last = document.createTextNode("");
        editor.append(last);
      }
      (last as Text).data += text;
      placeCaret(editor, last, (last as Text).length);
      fireEvent.input(editor);
    });
  const focus = () => act(() => editor.focus());
  /** What the editor would save: chips as tokens. */
  const stored = () => serializeEditor(editor);
  const chips = () => Array.from(editor.querySelectorAll(".bj-mi-chip")).map((c) => c.textContent);
  return { editor, type, focus, stored, chips, onSubmit, combobox: screen.getByRole("combobox", { name: "New entry" }) };
}

const optionNames = () => screen.queryAllByRole("option").map((o) => o.textContent);

describe("pickerOptions", () => {
  it("name prefix first, then a later word's prefix; unnamed entries never; case-insensitive; capped", () => {
    expect(pickerOptions(ENTRIES, "ma").map((o) => o.name)).toEqual(["Mabry Ford", "Marlow", "Old Mag"]);
    expect(pickerOptions(ENTRIES, "").map((o) => o.id)).toEqual(["k3", "k1", "k2", "k4"]);
    expect(pickerOptions(ENTRIES, "MAG")[0]).toEqual({ id: "k2", name: "Old Mag", kind: "character", tip: "Character" });
    expect(pickerOptions(ENTRIES, "ford")[0]!.tip).toBe("Location");
    expect(pickerOptions(ENTRIES, "", 2)).toHaveLength(2);
    expect(codexHref("c1", "k1")).toBe("/campaigns/c1/codex?entry=k1");
  });
});

describe("MentionInput (rich editor, dcm-bxp.106)", () => {
  it("typing @ opens the combobox listbox filtered by the prefix; arrows move; Enter puts a name chip; Enter again submits the token text", () => {
    const { editor, type, focus, stored, chips, onSubmit, combobox } = setup();
    expect(editor).toHaveAttribute("contenteditable", "true");
    expect(editor).toHaveAttribute("aria-placeholder", "Write…");
    expect(editor).toHaveAttribute("data-empty", "true");
    focus();
    type("met ");
    expect(editor).not.toHaveAttribute("data-empty");
    expect(combobox).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("listbox")).toBeNull();
    // Nothing in the codex is read until the list opens.
    expect(queried).toEqual([]);

    type("@ma");
    expect(combobox).toHaveAttribute("aria-expanded", "true");
    const listbox = screen.getByRole("listbox", { name: "Characters & Locations" });
    expect(editor).toHaveAttribute("aria-controls", listbox.id);
    expect(optionNames()).toEqual(["Mabry FordLocation", "MarlowFerryman", "Old MagCharacter"]);
    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");
    expect(editor).toHaveAttribute("aria-activedescendant", screen.getAllByRole("option")[0]!.id);

    fireEvent.keyDown(editor, { key: "ArrowDown" });
    fireEvent.keyDown(editor, { key: "ArrowDown" });
    expect(within(listbox).getByRole("option", { name: /Old Mag/ })).toHaveAttribute("aria-selected", "true");
    expect(editor).toHaveAttribute("aria-activedescendant", within(listbox).getByRole("option", { name: /Old Mag/ }).id);
    fireEvent.keyDown(editor, { key: "ArrowUp" });
    fireEvent.keyDown(editor, { key: "ArrowUp" });
    fireEvent.keyDown(editor, { key: "ArrowUp" });
    expect(within(listbox).getByRole("option", { name: /Old Mag/ })).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(editor, { key: "Enter" });
    // The chip shows the name only; the token (with its id) is what gets saved.
    expect(chips()).toEqual(["Old Mag"]);
    expect(editor).toHaveTextContent("met Old Mag");
    expect(editor.textContent).not.toContain("k2");
    expect(editor.querySelector(".bj-mi-chip")).toHaveAttribute("contenteditable", "false");
    expect(stored()).toBe("met @[Old Mag](k2) ");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).toBeNull();

    type("at the ford");
    fireEvent.keyDown(editor, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith("met @[Old Mag](k2) at the ford");
    expect(stored()).toBe("");
    expect(editor).toHaveAttribute("data-empty", "true");
  });

  it("a click on an option puts a chip; Escape closes the list without cancelling, a second Escape cancels", () => {
    const onCancel = vi.fn();
    const { editor, type, focus, stored, onSubmit } = setup({ onCancel });
    focus();
    type("ask @");
    fireEvent.click(screen.getByRole("option", { name: /Sable/ }));
    expect(stored()).toBe("ask @[Sable](k4) ");

    type("and @mar");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.keyDown(editor, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.keyDown(editor, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(editor, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith("ask @[Sable](k4) and @mar");
  });

  it("an '@' right after a chip opens the list too", () => {
    const { type, focus, chips } = setup({ defaultValue: "@[Marlow](k1)" });
    focus();
    type("@sa");
    expect(optionNames()).toEqual(["SableSmuggler"]);
    fireEvent.click(screen.getByRole("option", { name: /Sable/ }));
    expect(chips()).toEqual(["Marlow", "Sable"]);
  });

  it("a player's picker offers only what their codex.list returns (the entries the party knows); no match says so", () => {
    codex = { role: "player", entries: [ENTRIES[0]!] };
    const { editor, type, focus, onSubmit } = setup();
    focus();
    type("@");
    expect(optionNames()).toEqual(["MarlowFerryman"]);
    type("sab");
    expect(screen.getByRole("option")).toHaveTextContent("No match in Characters & Locations.");
    expect(screen.getByRole("option")).toHaveAttribute("aria-disabled", "true");
    // Enter with nothing to choose submits the text as written.
    fireEvent.keyDown(editor, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith("@sab");
  });

  it("editing shows existing tokens as name chips and keeps them on save; an email-like '@' or '@ ' opens nothing", () => {
    const { editor, type, focus, stored, chips, onSubmit } = setup({ defaultValue: "met @[Marlow](k1)" });
    expect(chips()).toEqual(["Marlow"]);
    expect(editor).toHaveTextContent("met Marlow");
    expect(editor.textContent).not.toContain("@[");
    expect(stored()).toBe("met @[Marlow](k1)");
    focus();
    type(" via mag@ford");
    expect(screen.queryByRole("listbox")).toBeNull();
    type(" or @ ford");
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.keyDown(editor, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith("met @[Marlow](k1) via mag@ford or @ ford");
  });

  it("paste inserts plain text on one line; a removed chip leaves its token out", () => {
    const { editor, focus, stored } = setup({ defaultValue: "ask @[Marlow](k1) now" });
    focus();
    act(() => {
      placeCaret(editor);
      fireEvent.paste(editor, { clipboardData: { getData: () => " later\nthat\r\nnight" } });
    });
    expect(stored()).toBe("ask @[Marlow](k1) now later that night");
    act(() => {
      editor.querySelector(".bj-mi-chip")!.remove();
      fireEvent.input(editor);
    });
    expect(stored()).toBe("ask  now later that night");
  });

  it("at 10 mentions the list only states the limit and reads nothing", () => {
    const ten = Array.from({ length: 10 }, () => "@[Marlow](k1)").join(" ");
    const { type, focus } = setup({ defaultValue: ten });
    focus();
    type(" @ma");
    expect(screen.getByRole("option")).toHaveTextContent("At most 10 links in one entry.");
    expect(queried).toEqual(["skip"]);
  });

  it("the list closes when the editor loses focus, which reports the stored text", () => {
    const onBlurText = vi.fn();
    const { editor, type, focus } = setup({ defaultValue: "@[Marlow](k1)", onBlurText });
    focus();
    type(" @m");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    act(() => editor.blur());
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onBlurText).toHaveBeenCalledWith("@[Marlow](k1) @m");
  });
});

describe("EntryText", () => {
  it("text without tokens is shown as written and reads nothing", () => {
    render(<EntryText campaignId={CAMPAIGN} text="bought rope" />);
    expect(screen.getByText("bought rope")).toBeInTheDocument();
    expect(queried).toEqual([]);
  });

  it("a visible entry is a link with its CURRENT name, the role tooltip and the Codex ?entry= href", () => {
    codex = { role: "gm", entries: [{ ...ENTRIES[0]!, name: "Marlow the Grey" }, ENTRIES[2]!] };
    render(<EntryText campaignId={CAMPAIGN} text="met @[Marlow](k1) at @[Mabry Ford](k3)" />);
    const marlow = screen.getByRole("link", { name: "Marlow the Grey" });
    expect(marlow).toHaveAttribute("href", "/campaigns/c1/codex?entry=k1");
    expect(marlow).toHaveAttribute("title", "Ferryman");
    expect(marlow).toHaveClass("bj-mention");
    expect(screen.getByRole("link", { name: "Mabry Ford" })).toHaveAttribute("title", "Location");
    expect(screen.queryByText(/Marlow\b(?! the Grey)/)).toBeNull();
  });

  it("an entry the viewer cannot see is the stored name as plain text: no link, no role", () => {
    codex = { role: "player", entries: [ENTRIES[0]!] };
    const { container } = render(<EntryText campaignId={CAMPAIGN} text="met @[Marlow](k1) and @[The Hooded One](k9)" />);
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(container).toHaveTextContent("met Marlow and The Hooded One");
    expect(screen.queryByTitle("Character")).toBeNull();
  });

  it("while the list loads, every mention is its stored name as plain text", () => {
    codex = undefined;
    const { container } = render(<EntryText campaignId={CAMPAIGN} text="met @[Marlow](k1)" />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(container).toHaveTextContent("met Marlow");
  });
});
