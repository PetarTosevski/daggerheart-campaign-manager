/**
 * The Combat HUD state and tools drawer (plan combat-hud H0; docs/tasks/TASK-HUD-H0.md): HudProvider's sheet / pick /
 * drawer state and root classes, and the drawer with its toggle button. The opt-in switch and its tests went with the
 * cut-over (plan combat-hud H8.1).
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { HudProvider, hudRootClasses, sameSheet, useHud, type HudSheetTarget } from "@/components/combat-map/hud/state";
import { HudTools, MapToolsButton, toolsLabel } from "@/components/combat-map/hud/tools";

import type { Id } from "../../../convex/_generated/dataModel";

const pc = (id: string): HudSheetTarget => ({ kind: "pc", characterId: id as Id<"characters"> });
const enemy = (id: string): HudSheetTarget => ({ kind: "adversary", tokenId: id as Id<"combatTokens"> });

describe("HudProvider", () => {
  function Probe() {
    const hud = useHud();
    return (
      <>
        <span data-testid="classes">{hudRootClasses(hud)}</span>
        <button type="button" onClick={() => hud.toggleSheet(pc("moss"))}>
          Moss
        </button>
        <button type="button" onClick={() => hud.toggleSheet(pc("brannoc"))}>
          Brannoc
        </button>
        <button type="button" onClick={() => hud.toggleSheet(enemy("bandit"))}>
          Bandit
        </button>
        <button type="button" onClick={() => hud.closeSheet()}>
          Close
        </button>
        <button type="button" onClick={() => hud.setPick({ id: "card:vicious-entangle", anchorTokenId: null })}>
          Pick
        </button>
        <button type="button" onClick={() => hud.setPick(null)}>
          Cancel pick
        </button>
      </>
    );
  }

  it("opens, swaps and closes the sheet, with the board's root classes", () => {
    render(
      <HudProvider>
        <Probe />
      </HudProvider>,
    );
    const classes = screen.getByTestId("classes");
    expect(classes).toHaveTextContent(/^$/);
    fireEvent.click(screen.getByRole("button", { name: "Moss" }));
    expect(classes).toHaveTextContent("hud-sh-open hud-sh-moss");
    fireEvent.click(screen.getByRole("button", { name: "Brannoc" }));
    expect(classes).toHaveTextContent("hud-sh-open hud-sh-brannoc");
    // The same banner again closes it (HANDOFF "Sheet panel").
    fireEvent.click(screen.getByRole("button", { name: "Brannoc" }));
    expect(classes).toHaveTextContent(/^$/);
    fireEvent.click(screen.getByRole("button", { name: "Bandit" }));
    expect(classes).toHaveTextContent("hud-sh-open hud-sh-bandit");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(classes).toHaveTextContent(/^$/);
  });

  it("holds one pick session slot", () => {
    render(
      <HudProvider>
        <Probe />
      </HudProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Pick" }));
    expect(screen.getByTestId("classes")).toHaveTextContent("pk-open");
    fireEvent.click(screen.getByRole("button", { name: "Cancel pick" }));
    expect(screen.getByTestId("classes")).not.toHaveTextContent("pk-open");
  });

  it("compares sheet targets by kind and id", () => {
    expect(sameSheet(pc("a"), pc("a"))).toBe(true);
    expect(sameSheet(pc("a"), pc("b"))).toBe(false);
    expect(sameSheet(pc("a"), enemy("a"))).toBe(false);
    expect(sameSheet(null, null)).toBe(true);
    expect(sameSheet(null, pc("a"))).toBe(false);
  });

  it("throws outside the provider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/HudProvider/);
    spy.mockRestore();
  });
});

describe("the tools drawer", () => {
  it("opens from 'Map tools' (GM) and closes with Escape, focus back on the button", () => {
    render(
      <HudProvider>
        <MapToolsButton role="gm" />
        <HudTools role="gm">
          <p>Maps</p>
        </HudTools>
      </HudProvider>,
    );
    const button = screen.getByRole("button", { name: "Map tools" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    button.focus();
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    const drawer = screen.getByRole("complementary", { name: "Map tools" });
    expect(drawer).toHaveTextContent("Maps");
    expect(drawer).toHaveFocus();
    fireEvent.keyDown(drawer, { key: "Escape" });
    expect(screen.queryByRole("complementary", { name: "Map tools" })).toBeNull();
    expect(button).toHaveFocus();
  });

  it("names the player's drawer after their classic column", () => {
    expect(toolsLabel("gm")).toBe("Map tools");
    expect(toolsLabel("player")).toBe("Your character");
  });
});
