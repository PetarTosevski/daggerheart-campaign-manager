import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";

import { CardDialog, CardMore } from "../../src/components/cards/card-dialog";
import { DOMAIN_CARDS } from "../../src/lib/srd/domain-cards";

// SC1 (dcm-bxp.126, dcm-bxp.127): 'More' opens the large card in a native modal <dialog> named by the card, with its art,
// domain, level, type, recall cost, whole text and once-per state; closing returns focus to 'More'.

beforeAll(() => {
  // jsdom has no showModal/close; model the browser: close() drops `open` and fires the dialog's close event.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    if (!this.hasAttribute("open")) return;
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});

const card = (id: string) => {
  const found = DOMAIN_CARDS.find((c) => c.id === id);
  if (!found) throw new Error(`no card ${id}`);
  return found;
};

// Book of Ava: Codex grimoire, level 1, recall 2, three spells: a long text the face cuts off.
const ava = card("book-of-ava");

function openMore(name = ava.name) {
  fireEvent.click(screen.getByRole("button", { name: `More about ${name}` }));
  return screen.getByRole("dialog", { name });
}

describe("CardDialog", () => {
  it("renders nothing while closed", () => {
    render(<CardDialog card={ava} open={false} onClose={() => undefined} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("'More' opens a modal named by the card with its art, domain, level, type, recall cost and whole text", () => {
    render(<CardMore card={ava} />);
    const more = screen.getByRole("button", { name: "More about Book of Ava" });
    expect(more).toHaveTextContent("More");
    expect(more).toHaveAttribute("aria-haspopup", "dialog");
    const dialog = openMore();
    expect(dialog).toHaveAttribute("open");
    expect(within(dialog).getByRole("heading", { level: 2, name: "Book of Ava" })).toBeInTheDocument();
    const terms = within(dialog)
      .getAllByRole("term")
      .map((t) => [t.textContent, t.nextElementSibling?.textContent]);
    expect(terms).toEqual([
      ["Domain", "Codex"],
      ["Level", String(ava.level)],
      ["Type", "Grimoire"],
      ["Recall cost", String(ava.recallCost)],
    ]);
    // The whole text, not a clamp of it.
    expect(dialog.querySelector(".cd-text")?.textContent).toBe(ava.text);
    expect(dialog.querySelector("img")).toHaveAttribute("alt", "");
    expect(within(dialog).queryByText(/^Used/)).toBeNull();
  });

  it("shows the once-per state (CA7's ribbon)", () => {
    render(<CardMore card={ava} used="Back after a long rest" />);
    const dialog = openMore();
    expect(within(dialog).getByText("Used · Back after a long rest")).toBeInTheDocument();
    expect(dialog).toHaveAttribute("data-exhausted", "true");
  });

  it("the close button closes it and returns focus to 'More'", () => {
    render(<CardMore card={ava} />);
    const dialog = openMore();
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "More about Book of Ava" })).toHaveFocus();
  });

  it("Escape (the dialog's own close event) closes it and returns focus to 'More'", () => {
    render(<CardMore card={ava} />);
    const dialog = openMore() as HTMLDialogElement;
    // The browser closes a modal dialog on Escape and fires `close`; jsdom does not, so fire what the browser does.
    dialog.close();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "More about Book of Ava" })).toHaveFocus();
  });

  it("a click on the backdrop closes it; a click on the card does not", () => {
    render(<CardMore card={ava} />);
    const dialog = openMore();
    fireEvent.click(within(dialog).getByRole("heading", { name: "Book of Ava" }));
    expect(screen.getByRole("dialog", { name: "Book of Ava" })).toBeInTheDocument();
    fireEvent.click(dialog);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("works for a card without art and uses the face's button class", () => {
    const noArt = { ...card("deft-deceiver"), art: null };
    render(<CardMore card={noArt} className="dk-more" />);
    expect(screen.getByRole("button", { name: "More about Deft Deceiver" })).toHaveClass("dk-more");
    const dialog = openMore("Deft Deceiver");
    expect(dialog.querySelector("img")).toBeNull();
    expect(dialog.querySelector(".cd-text")?.textContent).toBe(noArt.text);
  });
});
