// D11 N5: the mentions slot (src/components/notes/mentions): the @ picker in MentionInput and the links in EntryText.
// convex/react's useQuery is replaced by the viewer's `codex.list` result held here (GM: every entry; a player: only
// the entries the party knows, as the server returns them).
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../../convex/_generated/dataModel";
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

function setup(props: { defaultValue?: string; onCancel?: () => void } = {}) {
  const onSubmit = vi.fn();
  render(<MentionInput campaignId={CAMPAIGN} label="New entry" placeholder="Write…" onSubmit={onSubmit} {...props} />);
  const input = screen.getByRole("textbox", { name: "New entry" }) as HTMLInputElement;
  /** Types the whole value with the caret at its end (jsdom puts the caret at the end of a set value). */
  const type = (value: string) => fireEvent.change(input, { target: { value } });
  return { input, type, onSubmit, combobox: screen.getByRole("combobox", { name: "New entry" }) };
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

describe("MentionInput", () => {
  it("typing @ opens the combobox listbox filtered by the prefix; arrows move; Enter inserts the token; Enter again submits", () => {
    const { input, type, onSubmit, combobox } = setup();
    fireEvent.focus(input);
    type("met ");
    expect(combobox).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("listbox")).toBeNull();
    // Nothing in the codex is read until the list opens.
    expect(queried).toEqual([]);

    type("met @ma");
    expect(combobox).toHaveAttribute("aria-expanded", "true");
    const listbox = screen.getByRole("listbox", { name: "Characters & Locations" });
    expect(input).toHaveAttribute("aria-controls", listbox.id);
    expect(optionNames()).toEqual(["Mabry FordLocation", "MarlowFerryman", "Old MagCharacter"]);
    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");
    expect(input).toHaveAttribute("aria-activedescendant", screen.getAllByRole("option")[0]!.id);

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(within(listbox).getByRole("option", { name: /Old Mag/ })).toHaveAttribute("aria-selected", "true");
    expect(input).toHaveAttribute("aria-activedescendant", within(listbox).getByRole("option", { name: /Old Mag/ }).id);
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(within(listbox).getByRole("option", { name: /Old Mag/ })).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(input, { key: "Enter" });
    expect(input.value).toBe("met @[Old Mag](k2) ");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).toBeNull();

    type("met @[Old Mag](k2) at the ford");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith("met @[Old Mag](k2) at the ford");
    expect(input.value).toBe("");
  });

  it("a click on an option inserts it; Escape closes the list without cancelling, a second Escape cancels", () => {
    const onCancel = vi.fn();
    const { input, type } = setup({ onCancel });
    fireEvent.focus(input);
    type("ask @");
    fireEvent.click(screen.getByRole("option", { name: /Sable/ }));
    expect(input.value).toBe("ask @[Sable](k4) ");

    type("ask @[Sable](k4) and @mar");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("a player's picker offers only what their codex.list returns (the entries the party knows); no match says so", () => {
    codex = { role: "player", entries: [ENTRIES[0]!] };
    const { input, type, onSubmit } = setup();
    fireEvent.focus(input);
    type("@");
    expect(optionNames()).toEqual(["MarlowFerryman"]);
    type("@sab");
    expect(screen.getByRole("option")).toHaveTextContent("No match in Characters & Locations.");
    expect(screen.getByRole("option")).toHaveAttribute("aria-disabled", "true");
    // Enter with nothing to choose submits the text as written.
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith("@sab");
  });

  it("editing keeps existing tokens; an email-like '@' or '@ ' opens nothing", () => {
    const { input, type, onSubmit } = setup({ defaultValue: "met @[Marlow](k1)" });
    expect(input.value).toBe("met @[Marlow](k1)");
    fireEvent.focus(input);
    type("met @[Marlow](k1) via mag@ford");
    expect(screen.queryByRole("listbox")).toBeNull();
    type("met @[Marlow](k1) via @ ford");
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith("met @[Marlow](k1) via @ ford");
  });

  it("at 10 mentions the list only states the limit and reads nothing", () => {
    const ten = Array.from({ length: 10 }, () => "@[Marlow](k1)").join(" ");
    const { input, type } = setup({ defaultValue: ten });
    fireEvent.focus(input);
    type(`${ten} @ma`);
    expect(screen.getByRole("option")).toHaveTextContent("At most 10 links in one entry.");
    expect(queried).toEqual(["skip"]);
  });

  it("the list closes when the input loses focus", () => {
    const { input, type } = setup();
    fireEvent.focus(input);
    type("@m");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.blur(input);
    expect(screen.queryByRole("listbox")).toBeNull();
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
