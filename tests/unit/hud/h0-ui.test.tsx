/**
 * The Combat HUD primitives (plan combat-hud H0; docs/tasks/TASK-HUD-H0.md): every export of hud/ui and its states.
 * Each control reports an intent and leaves the value to its caller.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BandLabel,
  ChoiceRow,
  CostPill,
  PART_RETRY_DELAYS_MS,
  PART_RETRY_STABLE_MS,
  PartBoundary,
  Pips,
  Popup,
  Seal,
  SidePanel,
  StatTile,
  Stepper,
  Tag,
  Toggle,
  TwoTapButton,
  WaitingDots,
  costLabel,
} from "@/components/combat-map/hud/ui";

describe("Popup", () => {
  it("shows the icon, title, sub, body and one primary that names the result", () => {
    const onUse = vi.fn();
    render(
      <Popup icon={<span>i</span>} title="Your roll waits" sub="Brannoc · 15 with Hope" primary={{ label: "Use and roll damage", onClick: onUse }} secondary={<button type="button">Pass</button>}>
        <p>Use a feature before the damage is rolled, or pass.</p>
      </Popup>,
    );
    const dialog = screen.getByRole("dialog", { name: "Your roll waits" });
    expect(dialog).toHaveAttribute("aria-modal", "false");
    expect(dialog).toHaveTextContent("Brannoc · 15 with Hope");
    expect(dialog).toHaveTextContent("Use a feature before the damage is rolled");
    const primaries = dialog.querySelectorAll(".hud-btn-primary");
    expect(primaries).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Use and roll damage" }));
    expect(onUse).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Pass" })).toBeInTheDocument();
  });

  it("takes the GM, red and waiting tones and a disabled primary", () => {
    const { rerender } = render(<Popup icon="!" title="Out of range" tone="gm" primary={{ label: "Allow", onClick: () => {}, disabled: true }} />);
    expect(screen.getByRole("dialog")).toHaveClass("hud-pc", "hud-pc-gm");
    expect(screen.getByRole("button", { name: "Allow" })).toBeDisabled();
    rerender(<Popup icon="!" title="Forced attack" tone="red" />);
    expect(screen.getByRole("dialog")).toHaveClass("hud-pc-red");
    rerender(<Popup icon="!" title="Waiting for the GM" tone="wait" />);
    expect(screen.getByRole("dialog")).toHaveClass("hud-pc-wait");
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("Tag, CostPill, Pips, Seal, BandLabel, StatTile, WaitingDots", () => {
  it("Tag takes each of the board's hand states", () => {
    for (const kind of ["play", "no", "used", "limit", "cost"] as const) {
      const { unmount } = render(<Tag kind={kind}>{kind}</Tag>);
      expect(screen.getByText(kind)).toHaveClass("hud-hs", `hud-hs-${kind}`);
      unmount();
    }
  });

  it("CostPill spells the cost out for screen readers", () => {
    render(
      <>
        <CostPill amount={1} resource="hope" />
        <CostPill amount={2} resource="fear" />
        <CostPill amount={3} resource="hp" />
      </>,
    );
    expect(screen.getByRole("img", { name: "1 Hope" })).toHaveClass("hud-cost");
    expect(screen.getByRole("img", { name: "2 Fear" })).toHaveClass("hud-cost-fear");
    expect(screen.getByRole("img", { name: "3 Hit Points" })).toHaveClass("hud-cost-hp");
    expect(costLabel(1, "armor")).toBe("1 Armor Slot");
    expect(costLabel(2, "stress")).toBe("2 Stress");
  });

  it("Pips fill `on` of `max` and announce the caller's label", () => {
    render(<Pips kind="hp" on={4} max={6} label="2 of 6 Hit Points marked" />);
    const row = screen.getByRole("img", { name: "2 of 6 Hit Points marked" });
    expect(row.querySelectorAll("i")).toHaveLength(6);
    expect(row.querySelectorAll("i.on")).toHaveLength(4);
  });

  it("Pips clamp out-of-range values", () => {
    render(<Pips kind="stress" on={9} max={3} label="Stress" />);
    expect(screen.getByRole("img", { name: "Stress" }).querySelectorAll("i.on")).toHaveLength(3);
  });

  it("Seal shows the Hope number and greys at 0", () => {
    const { rerender } = render(<Seal value={3} label="3 Hope" />);
    expect(screen.getByRole("img", { name: "3 Hope" })).toHaveTextContent("3");
    expect(screen.getByRole("img", { name: "3 Hope" })).not.toHaveClass("hud-seal-empty");
    rerender(<Seal value={0} label="0 Hope" />);
    expect(screen.getByRole("img", { name: "0 Hope" })).toHaveClass("hud-seal-empty");
  });

  it("BandLabel colours by ring state", () => {
    render(
      <>
        <BandLabel>Close</BandLabel>
        <BandLabel state="picked">Far</BandLabel>
        <BandLabel state="out">Very Far · GM</BandLabel>
        <BandLabel state="los">No line of sight</BandLabel>
      </>,
    );
    expect(screen.getByText("Close")).toHaveClass("hud-band");
    expect(screen.getByText("Close")).not.toHaveClass("hud-band-in");
    expect(screen.getByText("Far")).toHaveClass("hud-band-picked");
    expect(screen.getByText("Very Far · GM")).toHaveClass("hud-band-out");
    expect(screen.getByText("No line of sight")).toHaveClass("hud-band-los");
  });

  it("StatTile shows the number over its label; WaitingDots are decorative", () => {
    render(
      <>
        <StatTile label="Evasion" value={10} />
        <WaitingDots />
      </>,
    );
    expect(screen.getByText("Evasion")).toHaveTextContent("10Evasion");
    expect(screen.getByTestId("hud-waiting-dots")).toHaveAttribute("aria-hidden", "true");
  });
});

describe("Stepper", () => {
  function Harness({ start = 1 }: { start?: number }) {
    const [value, setValue] = useState(start);
    return <Stepper value={value} min={0} max={2} label="Hope to spend" onStep={(d) => setValue((v) => v + d)} />;
  }

  it("steps by one and stops at min and max", () => {
    render(<Harness />);
    const group = screen.getByRole("group", { name: "Hope to spend" });
    expect(group).toHaveTextContent("1");
    fireEvent.click(screen.getByRole("button", { name: "More Hope to spend" }));
    expect(group).toHaveTextContent("2");
    expect(screen.getByRole("button", { name: "More Hope to spend" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Less Hope to spend" }));
    fireEvent.click(screen.getByRole("button", { name: "Less Hope to spend" }));
    expect(group).toHaveTextContent("0");
    expect(screen.getByRole("button", { name: "Less Hope to spend" })).toBeDisabled();
  });

  it("sends a delta per click, so a double click is two steps (CL4)", () => {
    const onStep = vi.fn();
    render(<Stepper value={0} min={0} max={5} label="Fear" onStep={onStep} />);
    const more = screen.getByRole("button", { name: "More Fear" });
    fireEvent.click(more);
    fireEvent.click(more);
    expect(onStep.mock.calls).toEqual([[1], [1]]);
  });
});

describe("Toggle and ChoiceRow", () => {
  it("Toggle is a switch named by its label and reports the new value", () => {
    const onChange = vi.fn();
    const { rerender } = render(<Toggle checked={false} onChange={onChange} label="If it hits, also Restrain the Bandit" note="Very Close to the Lieutenant" end={<CostPill amount={1} resource="hope" />} />);
    const sw = screen.getByRole("switch", { name: /If it hits, also Restrain the Bandit/ });
    expect(sw).toHaveAttribute("aria-checked", "false");
    fireEvent.click(sw);
    expect(onChange).toHaveBeenLastCalledWith(true);
    rerender(<Toggle checked onChange={onChange} label="Restrain" />);
    expect(screen.getByRole("switch", { name: "Restrain" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("switch", { name: "Restrain" }));
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it("ChoiceRow is a radio or a checkbox with a note", () => {
    const onSelect = vi.fn();
    render(
      <div role="radiogroup" aria-label="Lead by Example">
        <ChoiceRow type="radio" checked onSelect={onSelect} label="Clear a Stress" />
        <ChoiceRow type="radio" checked={false} onSelect={onSelect} label="Gain a Hope" note="auto" />
        <ChoiceRow type="checkbox" checked onSelect={onSelect} label="Use Reliable Backup" note="once per scene" />
      </div>,
    );
    expect(screen.getByRole("radio", { name: "Clear a Stress" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: /Gain a Hope/ })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("checkbox", { name: /Use Reliable Backup/ })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("radio", { name: /Gain a Hope/ }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});

describe("TwoTapButton", () => {
  it("fires on the second tap only", () => {
    const onConfirm = vi.fn();
    render(<TwoTapButton label="Clear all targets" confirmLabel="Click again to clear" onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: "Clear all targets" }));
    expect(onConfirm).not.toHaveBeenCalled();
    const armed = screen.getByRole("button", { name: "Click again to clear" });
    expect(armed).toHaveAttribute("data-armed", "true");
    fireEvent.click(armed);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Clear all targets" })).toHaveAttribute("data-armed", "false");
  });

  it("disarms on blur and on Escape", () => {
    const onConfirm = vi.fn();
    render(<TwoTapButton label="Clear" confirmLabel="Again" onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    fireEvent.blur(screen.getByRole("button", { name: "Again" }));
    expect(screen.getByRole("button", { name: "Clear" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "Again" }), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe("SidePanel", () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(!open)}>
          Moss
        </button>
        <SidePanel open={open} onClose={() => setOpen(false)} title="Moss" label="Moss's sheet">
          <p>Sheet body</p>
        </SidePanel>
        <button type="button">Elsewhere</button>
      </>
    );
  }

  it("is a non-modal aside that takes focus and gives it back on close", () => {
    render(<Harness />);
    expect(screen.queryByRole("complementary")).toBeNull();
    const opener = screen.getByRole("button", { name: "Moss" });
    opener.focus();
    fireEvent.click(opener);
    const panel = screen.getByRole("complementary", { name: "Moss's sheet" });
    expect(panel).toHaveFocus();
    expect(panel).not.toHaveAttribute("aria-modal");
    fireEvent.click(screen.getByRole("button", { name: "Close Moss's sheet" }));
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(opener).toHaveFocus();
  });

  it("closes on Escape inside the panel", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Moss" }));
    fireEvent.keyDown(screen.getByText("Sheet body"), { key: "Escape" });
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("is named by its title without a label and can sit on the left", () => {
    render(
      <SidePanel open onClose={() => {}} title="Map tools" side="left">
        <p>Tools</p>
      </SidePanel>,
    );
    const panel = screen.getByRole("complementary", { name: "Map tools" });
    expect(panel).toHaveClass("hud-panel", "hud-panel-left");
  });
});

describe("PartBoundary", () => {
  // Bead dcm-rzq2: a failed part retries by itself after 2, 5 and 10 s ("Loading…" meanwhile); only when the third
  // retry fails does it show the alert with "Try again".
  let failing = true;
  let renders = 0;
  function Flaky() {
    renders += 1;
    if (failing) throw new Error("query failed");
    return <p>Banners</p>;
  }

  function mount() {
    return render(
      <PartBoundary label="The party banners">
        <Flaky />
      </PartBoundary>,
    );
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    failing = true;
    renders = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("retries quietly 3 times (2, 5, 10 s), then shows the part's name and Try again", () => {
    mount();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
    const attempts = () => renders;
    const first = attempts();

    act(() => vi.advanceTimersByTime(PART_RETRY_DELAYS_MS[0] - 1));
    expect(attempts()).toBe(first);
    act(() => vi.advanceTimersByTime(1));
    const second = attempts();
    expect(second).toBeGreaterThan(first);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Loading…");

    act(() => vi.advanceTimersByTime(PART_RETRY_DELAYS_MS[1]));
    const third = attempts();
    expect(third).toBeGreaterThan(second);
    expect(screen.queryByRole("alert")).toBeNull();

    act(() => vi.advanceTimersByTime(PART_RETRY_DELAYS_MS[2]));
    expect(attempts()).toBeGreaterThan(third);
    expect(screen.getByRole("alert")).toHaveTextContent("The party banners failed to load: query failed");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();

    // No more retries by itself.
    const settled = attempts();
    act(() => vi.advanceTimersByTime(60_000));
    expect(attempts()).toBe(settled);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("recovers on a retry that succeeds", () => {
    mount();
    failing = false;
    act(() => vi.advanceTimersByTime(PART_RETRY_DELAYS_MS[0]));
    expect(screen.getByText("Banners")).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("Try again remounts the part and, if it fails again, retries afresh", () => {
    mount();
    for (const delay of PART_RETRY_DELAYS_MS) act(() => vi.advanceTimersByTime(delay));
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();

    // Still failing: Try again starts a fresh round of quiet retries.
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Loading…");

    // Then the query recovers: the part shows.
    failing = false;
    act(() => vi.advanceTimersByTime(PART_RETRY_DELAYS_MS[0]));
    expect(screen.getByText("Banners")).toBeInTheDocument();
  });

  it("Try again shows the part at once when it loads", () => {
    mount();
    for (const delay of PART_RETRY_DELAYS_MS) act(() => vi.advanceTimersByTime(delay));
    failing = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("Banners")).toBeInTheDocument();
  });

  it("resets the retry count once a retried part has stayed up", () => {
    const tree = (
      <PartBoundary label="The party banners">
        <Flaky />
      </PartBoundary>
    );
    const { rerender } = render(tree);
    // Two failed retries, then the third succeeds and the part stays up past the stable window.
    act(() => vi.advanceTimersByTime(PART_RETRY_DELAYS_MS[0]));
    act(() => vi.advanceTimersByTime(PART_RETRY_DELAYS_MS[1]));
    failing = false;
    act(() => vi.advanceTimersByTime(PART_RETRY_DELAYS_MS[2]));
    expect(screen.getByText("Banners")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(PART_RETRY_STABLE_MS));

    // A new failure gets the quiet retries again, not the alert.
    failing = true;
    rerender(
      <PartBoundary label="The party banners">
        <Flaky />
      </PartBoundary>,
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
    failing = false;
    act(() => vi.advanceTimersByTime(PART_RETRY_DELAYS_MS[0]));
    expect(screen.getByText("Banners")).toBeInTheDocument();
  });
});
