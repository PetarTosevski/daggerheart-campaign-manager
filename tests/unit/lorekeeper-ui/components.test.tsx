// D13 L6: the answer card and the composer as a user sees them (convex/react replaced by stubs: no server).
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../../../convex/_generated/dataModel";
import type { MessageView } from "../../../convex/lorekeeper";

const calls: { name: string; args: Record<string, unknown> }[] = [];
const functionName = (ref: unknown) => String((ref as Record<symbol, unknown>)[Symbol.for("functionName")] ?? ref);

vi.mock("convex/react", () => ({
  useQuery: () => undefined,
  useMutation: (ref: unknown) => {
    const run = async (args: Record<string, unknown>) => {
      calls.push({ name: functionName(ref), args });
      return null;
    };
    return Object.assign(run, { withOptimisticUpdate: () => run });
  },
}));

const { AnswerCard } = await import("@/components/lorekeeper/answer/answer-card");
const { Composer } = await import("@/components/lorekeeper/composer/composer");

const CAMPAIGN = "c1" as Id<"campaigns">;
const BOOK = "b1" as Id<"lorekeeperBooks">;
const titles = new Map([[BOOK as string, "Daggerheart Core Rulebook"]]);

function message(patch: Partial<MessageView>): MessageView {
  return {
    _id: "m1" as Id<"lorekeeperMessages">,
    _creationTime: 1,
    conversationId: "v1" as Id<"lorekeeperConversations">,
    role: "answer",
    status: "done",
    text: "Yes. A critical hit always succeeds.",
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  };
}

const card = (answer: MessageView, extra: Partial<Parameters<typeof AnswerCard>[0]> = {}) =>
  render(<AnswerCard campaignId={CAMPAIGN} answer={answer} question="Do crits deal extra damage?" titles={titles} isGm={false} mine sentToGm={false} {...extra} />);

beforeEach(() => {
  calls.length = 0;
});

describe("AnswerCard", () => {
  it("shows the thinking row until text streams", () => {
    card(message({ status: "pending", text: "" }));
    expect(screen.getByText("Searching your books…")).toBeTruthy();
  });

  it("shows the run's phase in a polite live region while an uncertain answer waits (L11)", () => {
    const view = card(message({ status: "streaming", text: "", phase: "retry" }));
    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.textContent).toBe("Checking again with a stronger model…");
    expect(screen.queryByRole("article")).toBeNull();
    view.rerender(
      <AnswerCard campaignId={CAMPAIGN} answer={message({ status: "streaming", text: "", phase: "web" })} question="Q" titles={titles} isGm={false} mine sentToGm={false} />,
    );
    // The same live region, its text changed in place.
    expect(screen.getByRole("status")).toBe(status);
    expect(status.textContent).toBe("Searching the internet…");
    view.rerender(
      <AnswerCard campaignId={CAMPAIGN} answer={message({ status: "done", phase: "done", parts: { verdict: "unclear", quotes: [], call: "Your call." } })} question="Q" titles={titles} isGm={false} mine sentToGm={false} />,
    );
    expect(screen.queryByText("Searching the internet…")).toBeNull();
    expect(screen.getByText("Rules unclear")).toBeTruthy();
  });

  it("an answer stopped before any finished answer shows only the stopped note", () => {
    card(message({ status: "stopped", text: "", phase: "done" }));
    expect(screen.getByText("Stopped.")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("an early Stop shows its note under 'Stopped.' with no actions (L12)", () => {
    card(message({ status: "stopped", text: "Stopped before an answer was ready. Ask again to get one.", phase: "done" }));
    expect(screen.getByText("Stopped.")).toBeTruthy();
    expect(screen.getByText("Stopped before an answer was ready. Ask again to get one.")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("during the internet pass the kept book answer shows with 'Searching the internet…' under it, then the web part grows (L12)", () => {
    const book = { verdict: "unclear" as const, quotes: [], call: "Your call." };
    const view = card(message({ status: "streaming", phase: "web", text: "The books don't settle it.", parts: book, checkedAgain: true }));
    const article = screen.getByRole("article");
    expect(article.getAttribute("aria-busy")).toBe("true");
    expect(within(article).getByText("The books don't settle it.")).toBeTruthy();
    expect(within(article).getByText("Rules unclear")).toBeTruthy();
    expect(within(article).getByRole("status").textContent).toBe("Searching the internet…");
    expect(within(article).queryByRole("button", { name: "Copy" })).toBeNull();
    const web = [{ title: "Table talk", site: "example.com", url: "https://example.com/t", snippet: "" }];
    view.rerender(
      <AnswerCard
        campaignId={CAMPAIGN}
        answer={message({ status: "done", phase: "done", text: "The books don't settle it.\n\nOnline, tables pick one.", parts: { ...book, web }, checkedAgain: true })}
        question="Q"
        titles={titles}
        isGm={false}
        mine
        sentToGm={false}
      />,
    );
    expect(screen.queryByText("Searching the internet…")).toBeNull();
    expect(screen.getByText(/^The books don't settle it\.\s+Online, tables pick one\.$/)).toBeTruthy();
    expect(screen.getByText("From the internet · unofficial.")).toBeTruthy();
  });

  it("a live retry streams its text with no status row under it (L12)", () => {
    card(message({ status: "streaming", phase: "retry", text: "Two Hexes are", parts: { verdict: "rules", quotes: [] } }));
    expect(screen.getByText("Two Hexes are")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("renders the verdict pill, prose, a quote with its book and page chip, and the board's actions", () => {
    card(
      message({
        parts: { verdict: "rules", quotes: [{ kind: "book", text: "A critical hit always succeeds.", bookId: BOOK, page: 3, section: "Core Mechanics → Critical Hits" }] },
      }),
    );
    const article = screen.getByRole("article", { name: "The Lorekeeper's answer" });
    expect(within(article).getByText("From the rules")).toBeTruthy();
    expect(within(article).getByRole("button", { name: "📖 Daggerheart Core Rulebook · p.3" })).toBeTruthy();
    expect(within(article).getByText("Core Mechanics → Critical Hits")).toBeTruthy();
    const names = within(article)
      .getAllByRole("button")
      .map((b) => b.textContent);
    expect(names).toEqual(["📖 Daggerheart Core Rulebook · p.3", "Open in the book", "Copy"]);
  });

  it("renders text from the model as plain text, never HTML", () => {
    const { container } = card(message({ text: "<img src=x onerror=alert(1)> **bold**", parts: { verdict: "rules", quotes: [] } }));
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("<img src=x onerror=alert(1)> **bold**")).toBeTruthy();
  });

  it("shows the Suggested GM call, the retry note and Ask the GM, then 'Sent to the GM' disabled", async () => {
    const answer = message({ checkedAgain: true, parts: { verdict: "unclear", quotes: [], call: "Apply only the strongest Hex." } });
    const { rerender } = card(answer);
    expect(screen.getByText("Rules unclear")).toBeTruthy();
    expect(screen.getByText("Suggested GM call")).toBeTruthy();
    expect(screen.getByText("Apply only the strongest Hex.")).toBeTruthy();
    expect(screen.getByText("Checked again with a stronger model")).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Ask the GM" })));
    expect(calls).toEqual([{ name: "lorekeeperAsks:send", args: { campaignId: CAMPAIGN, messageId: "m1" } }]);
    rerender(<AnswerCard campaignId={CAMPAIGN} answer={answer} question="q" titles={titles} isGm={false} mine sentToGm />);
    const sent = screen.getByRole("button", { name: "Sent to the GM" }) as HTMLButtonElement;
    expect(sent.disabled).toBe(true);
  });

  it("shows the internet block with its disclaimer and safe links", () => {
    card(
      message({
        parts: {
          verdict: "none",
          quotes: [],
          web: [
            { title: "Table talk", site: "example.com", url: "https://example.com/t", snippet: "Most tables let the GM call it." },
            { title: "Bad link", site: "evil", url: "javascript:alert(1)", snippet: "" },
          ],
        },
      }),
    );
    expect(screen.getByText("From the internet · unofficial.")).toBeTruthy();
    const link = screen.getByRole("link", { name: "Table talk" });
    expect(link.getAttribute("rel")).toBe("noopener nofollow");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(screen.queryByRole("link", { name: "Bad link" })).toBeNull();
    expect(screen.getByText("Bad link")).toBeTruthy();
  });

  it("shows an unclear answer with its book quote, the GM call and the internet block with its disclaimer (L10)", () => {
    card(
      message({
        checkedAgain: true,
        text: "The books describe one Hex at a time.\n\nOnline, most tables apply only the strongest.",
        parts: {
          verdict: "unclear",
          quotes: [{ kind: "book", text: "A Hex marks one target.", bookId: BOOK, page: 7, section: "Witch → Hex" }],
          call: "Apply only the strongest Hex.",
          web: [{ title: "Table talk", site: "example.com", url: "https://example.com/t", snippet: "Most tables let the GM call it." }],
        },
      }),
    );
    const article = screen.getByRole("article", { name: "The Lorekeeper's answer" });
    expect(within(article).getByText("Rules unclear")).toBeTruthy();
    expect(within(article).getByText("A Hex marks one target.")).toBeTruthy();
    expect(within(article).getByRole("button", { name: "📖 Daggerheart Core Rulebook · p.7" })).toBeTruthy();
    expect(within(article).getByText("Apply only the strongest Hex.")).toBeTruthy();
    expect(within(article).getByText("From the internet · unofficial.")).toBeTruthy();
    expect(within(article).getByText(/other people’s readings and house rules found online/)).toBeTruthy();
    expect(within(article).getByRole("link", { name: "Table talk" }).getAttribute("href")).toBe("https://example.com/t");
    expect(within(article).getByRole("button", { name: "Ask the GM" })).toBeTruthy();
  });

  it("offers only Ask the GM on the web miss", () => {
    card(message({ text: "I couldn’t find this in your books or online. Ask your GM.", parts: { verdict: "none", quotes: [] } }));
    const article = screen.getByRole("article");
    expect(within(article).getAllByRole("button").map((b) => b.textContent)).toEqual(["Ask the GM"]);
  });

  it("offers only Ask the GM on the books-only miss", () => {
    card(message({ text: "I couldn’t find this in your books, and internet search is off. Ask your GM, or turn on “Search the internet too”.", parts: { verdict: "none", quotes: [] } }));
    expect(screen.getByText("Not in your books")).toBeTruthy();
    const article = screen.getByRole("article");
    expect(within(article).getAllByRole("button").map((b) => b.textContent)).toEqual(["Ask the GM"]);
  });

  it("links Show on Combat Map when a quote cites the range section", () => {
    card(message({ parts: { verdict: "rules", quotes: [{ kind: "book", text: "Close is up to four squares.", bookId: BOOK, page: 6, section: "Combat → Range On A Grid" }] } }));
    expect(screen.getByRole("link", { name: "Show on Combat Map" }).getAttribute("href")).toBe("/campaigns/c1/combat-map");
  });

  it("gives the GM Pin as table ruling with a dialog prefilled from the question and the GM call", async () => {
    card(message({ parts: { verdict: "unclear", quotes: [], call: "Apply only the strongest Hex." } }), { isGm: true, question: "Do our Hexes stack?" });
    // jsdom has no showModal; the Modal calls it in an effect.
    HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
    fireEvent.click(screen.getByRole("button", { name: "Pin as table ruling" }));
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Do our Hexes stack?");
    expect((screen.getByLabelText("Ruling") as HTMLTextAreaElement).value).toBe("Apply only the strongest Hex.");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Pin ruling" })));
    expect(calls).toEqual([
      { name: "lorekeeperRulings:pin", args: { campaignId: CAMPAIGN, title: "Do our Hexes stack?", text: "Apply only the strongest Hex.", fromMessageId: "m1" } },
    ]);
  });

  it("shows the error card with Try again, and the stopped note", () => {
    const retry = vi.fn();
    const { unmount } = card(message({ status: "error", text: "", errorCode: "LOREKEEPER_FAILED" }), { onRetry: retry });
    expect(screen.getByText("The Lorekeeper couldn't answer just now. Try again.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
    unmount();
    card(message({ status: "stopped", text: "The rule is" }));
    expect(screen.getByText("Stopped.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
  });
});

describe("Composer", () => {
  function composer(patch: Partial<Parameters<typeof Composer>[0]> = {}) {
    const props = {
      disabled: null,
      streaming: false,
      sending: false,
      onAsk: vi.fn(async () => true),
      onStop: vi.fn(),
      webSearch: true,
      onWebSearch: vi.fn(),
      visibility: null,
      notice: null,
      onNewConversation: vi.fn(),
      ...patch,
    };
    render(<Composer {...props} />);
    return props;
  }

  it("asks a suggestion chip's question", async () => {
    const props = composer();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Critical hits" })));
    expect(props.onAsk).toHaveBeenCalledWith("If my Hope and Fear dice match on an attack, do I deal extra damage?");
  });

  it("sends on Enter, keeps Shift+Enter for a new line, and clears the box", async () => {
    const props = composer();
    const box = screen.getByRole("textbox", { name: "Your question" }) as HTMLTextAreaElement;
    expect(box.placeholder).toBe("Ask The Lorekeeper a rules question…");
    fireEvent.change(box, { target: { value: "How far is Close?" } });
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    expect(props.onAsk).not.toHaveBeenCalled();
    await act(async () => fireEvent.keyDown(box, { key: "Enter" }));
    expect(props.onAsk).toHaveBeenCalledWith("How far is Close?");
    expect(box.value).toBe("");
  });

  it("brings the draft back when the ask fails", async () => {
    composer({ onAsk: vi.fn(async () => false) });
    const box = screen.getByRole("textbox", { name: "Your question" }) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "Lost?" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Ask" })));
    expect(box.value).toBe("Lost?");
  });

  it("limits the question to 1,000 characters and shows the count near the end", () => {
    composer();
    const box = screen.getByRole("textbox", { name: "Your question" }) as HTMLTextAreaElement;
    expect(box.maxLength).toBe(1000);
    fireEvent.change(box, { target: { value: "x".repeat(950) } });
    expect(screen.getByText("950 / 1,000")).toBeTruthy();
  });

  it("turns Ask into Stop while an answer streams", () => {
    const props = composer({ streaming: true });
    expect(screen.queryByRole("button", { name: "Ask" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(props.onStop).toHaveBeenCalledOnce();
  });

  it("shows the internet toggle with aria-pressed", () => {
    const props = composer({ webSearch: false });
    const group = screen.getByRole("group", { name: "Internet search" });
    expect(within(group).getByRole("button", { name: "Books only" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(group).getByRole("button", { name: "Search the internet too" }).getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(within(group).getByRole("button", { name: "Search the internet too" }));
    expect(props.onWebSearch).toHaveBeenCalledWith(true);
  });

  it("disables asking with the reason and the questions left", () => {
    composer({ disabled: "You’ve asked the most questions allowed today. Try again tomorrow.", questionsLeft: 0 });
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert").textContent).toContain("You’ve asked the most questions allowed today.");
    expect(screen.getByText("0 questions left today")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Critical hits" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("textbox", { name: "Your question" }) as HTMLTextAreaElement).disabled).toBe(true);
  });

  it("puts the blocked notice in the question box's spot: first in the composer, which moves above the stream (dcm-bxp.82.10)", () => {
    composer({ disabled: "This campaign has used this month’s Lorekeeper budget." });
    const group = screen.getByRole("group", { name: "Ask the Lorekeeper" });
    expect(group.hasAttribute("data-blocked")).toBe(true);
    const alert = within(group).getByRole("alert");
    expect(group.firstElementChild).toBe(alert);
    // Before the chips and the box, and the box points at it.
    const box = within(group).getByRole("textbox", { name: "Your question" });
    expect(alert.compareDocumentPosition(screen.getByRole("button", { name: "Critical hits" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(box.getAttribute("aria-describedby")).toContain(alert.id);
  });

  it("keeps other notices under the toggles and the composer in place when asking is on", () => {
    composer({ notice: { text: "Too many questions in a short time. Wait a moment and ask again.", newConversation: false }, questionsLeft: 3 });
    const group = screen.getByRole("group", { name: "Ask the Lorekeeper" });
    expect(group.hasAttribute("data-blocked")).toBe(false);
    const alert = within(group).getByRole("alert");
    expect(group.lastElementChild).toBe(alert);
    expect(alert.textContent).toContain("3 questions left today");
  });

  it("offers 'Start a new conversation' when the conversation is full", () => {
    const props = composer({ notice: { text: "This conversation is full. Start a new conversation.", newConversation: true } });
    fireEvent.click(screen.getByRole("button", { name: "Start a new conversation" }));
    expect(props.onNewConversation).toHaveBeenCalledOnce();
  });

  it("toggles a conversation private (Q3)", () => {
    const onChange = vi.fn();
    composer({ visibility: { value: "campaign", onChange } });
    expect(screen.getByText("Everyone in the campaign can read this")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Private" }));
    expect(onChange).toHaveBeenCalledWith("private");
  });
});
