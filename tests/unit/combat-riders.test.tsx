/**
 * The Attack bar's riders (plan sheet-drawer SD5; docs/tasks/TASK-SD-SD5.md): the toggles with their costs and when they
 * apply, what each asks (a number, an option, a situation, extra targets), the `riders` argument they send, and the
 * after-roll prompt (Q1: Hit / Miss only, Use / Pass, the GM's Resolve now).
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { extraMax, riderProblem, RiderPickPrompt, RiderToggles, ridersToSend, riseToSend, type RiderOption, type RiderPicks, type RiderPickView } from "@/components/combat-map/actions/attack/riders";

import type { Id } from "../../convex/_generated/dataModel";

vi.mock("convex/react", () => ({ useMutation: () => vi.fn() }));

const tok = (s: string) => s as Id<"combatTokens">;

const base: Pick<RiderOption, "ready" | "resetLabel" | "limit" | "numbers" | "options" | "situations" | "addTargets"> = { ready: true, resetLabel: null, limit: null, numbers: [], options: [], situations: [], addTargets: null };

/** Rage Up (CB p.330): "mark a Stress … You can Rage Up twice per attack." */
const RAGE_UP: RiderOption = { ...base, source: "card", id: "rage-up", useId: "main", name: "Rage Up", phase: "before", when: "Before the roll", costs: ["X Stress"], numbers: [{ id: "n:times", label: "Times to Rage Up (a Stress each)", min: 1, max: 2 }] };
/** Hold Them Off (CB p.38): "two additional adversaries within range of the attack". */
const HOLD: RiderOption = { ...base, source: "feature", id: "hope:ranger", useId: "main", name: "Hold Them Off", phase: "after", when: "On a success", costs: ["3 Hope"], addTargets: { max: 2, range: "weapon" } };
/** Kick (CB p.58): knock back yourself or the target. */
const KICK: RiderOption = {
  ...base,
  source: "feature",
  id: "ancestry:faun:kick",
  useId: "main",
  name: "Kick",
  phase: "after",
  when: "On a success",
  costs: ["1 Stress"],
  options: [{ id: "opt:knock", label: "Knock back yourself or the target to Very Close range", options: [{ id: "self", label: "Yourself" }, { id: "target", label: "The target" }] }],
};
const USED: RiderOption = { ...base, source: "feature", id: "subclass:x:y", useId: "main", name: "Spent Feature", phase: "after", when: "On a success", costs: [], ready: false, resetLabel: "Back after a rest", limit: "Once per rest" };

function Harness({ options, onPicks, enemies = [] }: { options: RiderOption[]; onPicks?: (p: RiderPicks) => void; enemies?: { _id: Id<"combatTokens">; name: string }[] }) {
  const [picks, setPicks] = useState<RiderPicks>({});
  return (
    <RiderToggles
      options={options}
      picks={picks}
      enemies={enemies}
      onChange={(p) => {
        setPicks(p);
        onPicks?.(p);
      }}
    />
  );
}

describe("rider toggles", () => {
  it("lists each rider with when it applies and its cost; a used one is disabled with its reset", () => {
    render(<Harness options={[RAGE_UP, HOLD, USED]} />);
    const box = screen.getByRole("group", { name: "With this attack" });
    expect(within(box).getByRole("checkbox", { name: /Rage Up/ })).not.toBeChecked();
    expect(within(box).getByText("Before the roll · X Stress")).toBeInTheDocument();
    expect(within(box).getByText("On a success · 3 Hope")).toBeInTheDocument();
    expect(within(box).getByRole("checkbox", { name: /Spent Feature/ })).toBeDisabled();
    expect(within(box).getByText("Used · Back after a rest")).toBeInTheDocument();
  });

  it("renders nothing without riders", () => {
    const { container } = render(<Harness options={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("Rage Up: toggled, then twice: sends n:times 2", () => {
    let picks: RiderPicks = {};
    render(<Harness options={[RAGE_UP]} onPicks={(p) => (picks = p)} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /Rage Up/ }));
    expect(ridersToSend([RAGE_UP], picks)).toEqual([{ source: "card", id: "rage-up", useId: "main", choices: [{ id: "n:times", value: 1 }] }]);
    fireEvent.click(screen.getByRole("button", { name: "More times to rage up (a stress each)" }));
    expect(ridersToSend([RAGE_UP], picks)[0]!.choices).toEqual([{ id: "n:times", value: 2 }]);
    // Twice is the most (CB p.330).
    expect(screen.getByRole("button", { name: "More times to rage up (a stress each)" })).toBeDisabled();
  });

  it("Hold Them Off: picks at most two more enemies as `picked`", () => {
    let picks: RiderPicks = {};
    const enemies = [
      { _id: tok("a"), name: "Wolf" },
      { _id: tok("b"), name: "Archer" },
      { _id: tok("c"), name: "Bandit" },
    ];
    render(<Harness options={[HOLD]} enemies={enemies} onPicks={(p) => (picks = p)} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /Hold Them Off/ }));
    fireEvent.click(screen.getByRole("button", { name: "Wolf" }));
    fireEvent.click(screen.getByRole("button", { name: "Archer" }));
    expect(screen.getByRole("button", { name: "Bandit" })).toBeDisabled();
    expect(ridersToSend([HOLD], picks)).toEqual([{ source: "feature", id: "hope:ranger", useId: "main", choices: [{ id: "picked", value: ["a", "b"] }] }]);
    expect(extraMax(HOLD, picks["feature|hope:ranger|main"]!)).toBe(2);
  });

  it("Kick: an unanswered option blocks the attack until picked", () => {
    let picks: RiderPicks = {};
    render(<Harness options={[KICK]} onPicks={(p) => (picks = p)} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /Kick/ }));
    expect(riderProblem([KICK], picks)).toBe("Kick: Knock back yourself or the target to Very Close range");
    fireEvent.change(screen.getByRole("combobox", { name: "Knock back yourself or the target to Very Close range" }), { target: { value: "target" } });
    expect(riderProblem([KICK], picks)).toBeNull();
    expect(ridersToSend([KICK], picks)[0]!.choices).toEqual([{ id: "opt:knock", value: ["target"] }]);
  });

  it("sends nothing for an untoggled or used rider", () => {
    expect(ridersToSend([RAGE_UP, USED], { "feature|subclass:x:y|main": { on: true, numbers: {}, options: {}, situations: [], extra: [] } })).toEqual([]);
  });
});

/** Rise to the Challenge (CB p.48): "While you have 2 or fewer Hit Points unmarked, you can roll a d20 as your Hope Die." */
const RISE: RiderOption = { ...base, source: "feature", id: "subclass:call-of-the-brave:rise-to-the-challenge", useId: "main", name: "Rise to the Challenge", phase: "before", when: "Before the roll", costs: [], defaultOn: true };

describe("DA2: Rise to the Challenge starts on (user 2026-10-30)", () => {
  it("the toggle starts ticked; nothing is sent while on, `false` once switched off", () => {
    let picks: RiderPicks = {};
    render(<Harness options={[RISE]} onPicks={(p) => (picks = p)} />);
    const box = screen.getByRole("checkbox", { name: /Rise to the Challenge/ });
    expect(box).toBeChecked();
    expect(ridersToSend([RISE], picks)).toEqual([]);
    expect(riseToSend([RISE], picks)).toBeUndefined();
    fireEvent.click(box);
    expect(box).not.toBeChecked();
    expect(riseToSend([RISE], picks)).toBe(false);
    expect(ridersToSend([RISE], picks)).toEqual([]);
  });
});

describe("DA2: Death Strike's prompt (HF p.8)", () => {
  const view = (n: number): RiderPickView => ({
    requestId: "r1" as Id<"combatRequests">,
    name: "Death Strike",
    costs: ["1 Stress"],
    candidates: [
      { tokenId: tok("a"), name: "Wolf" },
      { tokenId: tok("b"), name: "Archer" },
    ].slice(0, n),
  });

  it("one creature: Use / Pass, Use ready at once", () => {
    render(<RiderPickPrompt campaignId={"c" as Id<"campaigns">} view={view(1)} />);
    expect(screen.getByText(/: Wolf/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use Death Strike" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Pass" })).toBeEnabled();
  });

  it("several creatures: pick ONE before Use", () => {
    render(<RiderPickPrompt campaignId={"c" as Id<"campaigns">} view={view(2)} />);
    const use = screen.getByRole("button", { name: "Use Death Strike" });
    expect(use).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Archer" }));
    expect(screen.getByRole("button", { name: "Archer" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Wolf" })).toHaveAttribute("aria-pressed", "false");
    expect(use).toBeEnabled();
  });
});
