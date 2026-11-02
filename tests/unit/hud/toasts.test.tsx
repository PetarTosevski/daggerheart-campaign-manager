/**
 * The three blocked layers (plan combat-hud H6.1; board CmpBlocked; docs/tasks/TASK-HUD-H6.1.md): the before-the-click
 * reason (`blockedReason`, `useBlocked`, `BlockedReason`, `BlockedTag`), the click-time `useRefusal()` and
 * `RefusalMessage`, and the toast host near the hand (`HudToasts`, `hudToasts`).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { ConvexError } from "convex/values";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BlockedReason, BlockedTag, RefusalMessage, blockedReason, useBlocked, useRefusal, type UseRefusalOptions } from "@/components/combat-map/hud/blocked";
import { HudToasts, TOAST_MAX, TOAST_TTL, hudToasts } from "@/components/combat-map/hud/toasts";
import type { CombatPageState } from "@/components/combat-map/slots";
import type { Cost } from "@/lib/domain/card-effects/types";

const STATE = {} as CombatPageState;
const hope = (n: number): Cost => ({ kind: "hope", amount: { kind: "fixed", value: n } });

afterEach(() => {
  act(() => hudToasts.reset());
  vi.useRealTimers();
});

// ---------------------------------------------------------------- layer 1

describe("before the click", () => {
  it("pre-computes the Hope shortfall: 'Needs 3 Hope · you have 1' and the tag 'Needs 3 Hope'", () => {
    const why = blockedReason({ kind: "feature", subject: "Evolution", costs: [hope(3)], room: { hope: 1 } });
    expect(why).toMatchObject({ code: "FEATURE_COST_UNPAID", text: "Needs 3 Hope · you have 1", tag: "Needs 3 Hope" });
    expect(why?.refusal.text).toBe("Evolution costs 3 Hope. You have 1.");
    expect(blockedReason({ costs: [hope(1)], room: { hope: 1 } })).toBeNull();
  });

  it("the spotlight blocks non-reactions first; reactions stay enabled", () => {
    const why = blockedReason({ spotlightWithGm: true, used: "card", costs: [hope(3)], room: { hope: 0 } });
    expect(why).toMatchObject({ code: "SPOTLIGHT_WITH_GM", text: "The GM has the spotlight · reactions only" });
    expect(blockedReason({ spotlightWithGm: true, reaction: true })).toBeNull();
  });

  it("used up before the cost; a server shortfall wins over the client's", () => {
    expect(blockedReason({ used: "card", costs: [hope(3)], room: { hope: 0 } })).toMatchObject({ code: "CARD_EXHAUSTED", text: "Used · back after a rest" });
    expect(blockedReason({ shortfall: [{ resource: "hope", need: 2, have: 0 }], costs: [hope(9)], room: { hope: 0 } })?.text).toBe("Needs 2 Hope · you have 0");
  });

  it("a GM Fear cost: 'Needs 2 Fear · you have 1'", () => {
    const why = blockedReason({ kind: "fear", viewer: "gm", costs: [{ kind: "fear", amount: { kind: "fixed", value: 2 } }], room: { fear: 1 } });
    expect(why).toMatchObject({ code: "NOT_ENOUGH_FEAR", text: "Needs 2 Fear · you have 1" });
    expect(why?.refusal.text).toBe("This needs 2 Fear. You have 1.");
  });

  function Control({ reason }: { reason: string | null }) {
    const b = useBlocked(reason);
    return (
      <>
        <button type="button" className="hud-btn" {...b.control} onClick={() => undefined}>
          Use
        </button>
        <BlockedReason id={b.reasonId}>{b.text}</BlockedReason>
      </>
    );
  }

  it("useBlocked: aria-disabled (still focusable) and described by the reason beside it", () => {
    const { rerender } = render(<Control reason="Needs 3 Hope · you have 1" />);
    const button = screen.getByRole("button", { name: "Use" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toBeDisabled();
    expect(button).toHaveAccessibleDescription("Needs 3 Hope · you have 1");
    rerender(<Control reason={null} />);
    expect(button).not.toHaveAttribute("aria-disabled");
    expect(button).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByText(/Needs/)).toBeNull();
  });

  it("BlockedTag draws the board's lock tag", () => {
    render(<BlockedTag>Needs 1 Hope</BlockedTag>);
    expect(screen.getByText("Needs 1 Hope")).toHaveClass("hud-hs", "hud-hs-no");
  });
});

// ---------------------------------------------------------------- layer 2

function Sender({ send, options }: { send: () => Promise<unknown>; options?: UseRefusalOptions }) {
  const r = useRefusal(options);
  return (
    <div>
      <button type="button" aria-describedby={r.refusal ? r.messageId : undefined} onClick={() => void r.run(send)}>
        Cast on Lieutenant
      </button>
      <RefusalMessage refusal={r.refusal} id={r.messageId} />
    </div>
  );
}

describe("at the click", () => {
  it("shows the server's refusal under the pressed control (role=alert), with the caller's names", async () => {
    render(<Sender send={() => Promise.reject(new ConvexError({ code: "COMBAT_NO_LINE_OF_SIGHT" }))} options={{ target: "the Lieutenant" }} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Cast on Lieutenant" })));
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("You can’t see the Lieutenant from where you stand.");
    expect(alert).toHaveAttribute("data-code", "COMBAT_NO_LINE_OF_SIGHT");
    expect(screen.getByRole("button", { name: "Cast on Lieutenant" })).toHaveAccessibleDescription(/You can’t see the Lieutenant/);
  });

  it("a new click clears the last refusal; a success shows nothing", async () => {
    let fail = true;
    render(<Sender send={() => (fail ? Promise.reject(new ConvexError({ code: "FEATURE_EXHAUSTED" })) : Promise.resolve("ok"))} />);
    await act(async () => fireEvent.click(screen.getByRole("button")));
    expect(screen.getByRole("alert")).toHaveTextContent("That feature is used up for now. It comes back on a rest.");
    fail = false;
    await act(async () => fireEvent.click(screen.getByRole("button")));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a toast-placed refusal goes to the host near the hand and runs its follow-up", async () => {
    const onThen = vi.fn();
    render(
      <>
        <Sender send={() => Promise.reject(new ConvexError({ code: "REQUEST_NOT_OPEN" }))} options={{ onThen }} />
        <HudToasts state={STATE} />
      </>,
    );
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Cast on Lieutenant" })));
    expect(screen.queryByRole("alert")).toBeNull();
    const status = screen.getByRole("status", { name: "Notices" });
    expect(within(status).getByText("Already answered")).toBeInTheDocument();
    expect(within(status).getByText("Someone already answered this.")).toBeInTheDocument();
    expect(onThen).toHaveBeenCalledWith("refresh", expect.objectContaining({ code: "REQUEST_NOT_OPEN" }));
  });

  it("anything that isn't a refusal is FALLBACK, as a toast", async () => {
    render(
      <>
        <Sender send={() => Promise.reject(new Error("socket closed"))} />
        <HudToasts state={STATE} />
      </>,
    );
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Cast on Lieutenant" })));
    expect(within(screen.getByRole("status")).getByText("Something went wrong. Check your connection and try again.")).toBeInTheDocument();
  });

  it("place: 'inline' keeps even a toast refusal under the control", async () => {
    render(<Sender send={() => Promise.reject(new ConvexError({ code: "FEATURE_NEEDS_MAP" }))} options={{ place: "inline" }} />);
    await act(async () => fireEvent.click(screen.getByRole("button")));
    expect(screen.getByRole("alert")).toHaveTextContent("That needs a live map with its targets on it.");
  });
});

// ---------------------------------------------------------------- layer 3

describe("toast host", () => {
  it("is a live region even when empty", () => {
    render(<HudToasts state={STATE} />);
    expect(screen.getByRole("status", { name: "Notices" })).toBeEmptyDOMElement();
  });

  it("shows the board's toast: title, message, hint; dismisses on ✕", () => {
    render(<HudToasts state={STATE} />);
    act(() => {
      hudToasts.push({ title: "Not enough Hope", message: "Wall Walk costs 1 Hope. You have 0.", hint: "Roll with Hope, or rest, to gain Hope." });
    });
    const status = screen.getByRole("status");
    expect(within(status).getByText("Not enough Hope")).toBeInTheDocument();
    expect(within(status).getByText("Roll with Hope, or rest, to gain Hope.")).toBeInTheDocument();
    fireEvent.click(within(status).getByRole("button", { name: "Dismiss: Not enough Hope" }));
    expect(status).toBeEmptyDOMElement();
  });

  it("stacks up to TOAST_MAX (oldest out) and replaces a repeat instead of copying it", () => {
    render(<HudToasts state={STATE} />);
    act(() => {
      for (let i = 1; i <= TOAST_MAX + 1; i++) hudToasts.push({ title: `T${i}`, message: "m" });
      hudToasts.push({ title: "T3", message: "m" });
    });
    const items = within(screen.getByRole("status")).getAllByRole("listitem");
    expect(items.map((li) => li.querySelector("b")?.textContent)).toEqual(["T2", "T4", "T3"]);
  });

  it("auto-dismisses after its time, paused while hovered", () => {
    vi.useFakeTimers();
    render(<HudToasts state={STATE} />);
    act(() => {
      hudToasts.push({ title: "Already answered", message: "Someone already answered this.", tone: "neutral" });
    });
    const item = screen.getByRole("listitem");
    expect(item).toHaveClass("hud-toast-neutral");
    fireEvent.pointerEnter(item);
    act(() => vi.advanceTimersByTime(TOAST_TTL * 2));
    expect(screen.getByRole("listitem")).toBeInTheDocument();
    fireEvent.pointerLeave(item);
    act(() => vi.advanceTimersByTime(TOAST_TTL - 1));
    expect(screen.getByRole("listitem")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole("listitem")).toBeNull();
  });

  it("stops moving under prefers-reduced-motion", () => {
    const css = readFileSync(join(process.cwd(), "src/components/combat-map/hud/toasts/toasts.css"), "utf8");
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.hud-toast\s*\{\s*animation: none;/);
  });
});
