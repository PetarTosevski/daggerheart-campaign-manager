import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Id } from "../../convex/_generated/dataModel";
import { helpRoll, NO_HELP, toggleHelper, type HelpData } from "../../src/components/combat-map/hud/pick-feature/model";
import { HelpRow } from "../../src/components/combat-map/hud/pick-feature/rows";
import type { HelperCandidate } from "../../src/components/combat-map/hud/pick-attack/model";

// dcm-bxp.134.5: the HUD feature panel's Help an Ally control (R7, CB p.90), as the hand's roll options: Book ticks the
// PCs who help (1 Hope each, sent as `roll.helpers`), Manual keeps the bare "Help dice" counter (`roll.help`).

const theo = "theo" as Id<"characters">;
const ash = "ash" as Id<"characters">;
const vex = "vex" as Id<"characters">;
const candidates: HelperCandidate[] = [
  { characterId: theo, name: "Theo", hope: 2 },
  { characterId: ash, name: "Ash", hope: 0 },
  { characterId: vex, name: "Vex", hope: 1 },
];

describe("helpRoll", () => {
  it("Book sends the ticked helpers and never the counter", () => {
    expect(helpRoll({ help: 2, helpers: [theo] }, true)).toEqual({ helpers: [theo] });
    expect(helpRoll({ help: 2, helpers: [] }, true)).toEqual({});
  });

  it("Manual sends the counter only", () => {
    expect(helpRoll({ help: 2, helpers: [theo] }, false)).toEqual({ help: 2 });
    expect(helpRoll(NO_HELP, false)).toEqual({});
  });

  it("toggleHelper ticks and unticks", () => {
    expect(toggleHelper([], theo)).toEqual([theo]);
    expect(toggleHelper([theo, vex], theo)).toEqual([vex]);
  });
});

describe("HelpRow", () => {
  it("Book: a chip per candidate; a PC without Hope can't be ticked; a tick reports the helper", () => {
    const onChange = vi.fn<(next: HelpData) => void>();
    render(<HelpRow helpers={candidates} value={NO_HELP} onChange={onChange} />);
    expect(screen.getByRole("group", { name: "Helped by" })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Help dice" })).toBeNull();
    const ashChip = screen.getByRole("button", { name: /Ash/ });
    expect((ashChip as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Theo/ }));
    expect(onChange).toHaveBeenCalledWith({ help: 0, helpers: [theo] });
  });

  it("Book: a ticked chip is pressed and unticks", () => {
    const onChange = vi.fn<(next: HelpData) => void>();
    render(<HelpRow helpers={candidates} value={{ help: 0, helpers: [theo] }} onChange={onChange} />);
    const chip = screen.getByRole("button", { name: /Theo/ });
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(chip);
    expect(onChange).toHaveBeenCalledWith({ help: 0, helpers: [] });
  });

  it("Book with nobody to help says so", () => {
    render(<HelpRow helpers={[]} value={NO_HELP} onChange={() => {}} />);
    expect(screen.getByText("No one can help")).toBeTruthy();
  });

  it("Manual: the Help dice counter", () => {
    const onChange = vi.fn<(next: HelpData) => void>();
    render(<HelpRow value={{ help: 1, helpers: [] }} onChange={onChange} />);
    expect(screen.queryByRole("group", { name: "Helped by" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More Help dice" }));
    expect(onChange).toHaveBeenCalledWith({ help: 2, helpers: [] });
  });
});
