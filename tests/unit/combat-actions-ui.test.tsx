/**
 * Combat Map actions helpers (plan combat-actions CA5): the target hints (Q1 / Q2), single-select picking (user answer
 * 2026-10-22, CB p.96), the verdict and outcome words of an attack (U1, Q5), the weapon damage label. The GM's
 * resolution filter left with the classic Resolutions card (plan combat-hud H8.2): tests/unit/hud/queue-model.test.tsx
 * "resolutionRows" covers it. Plan combat-hud H8.1 deleted the classic target list and attack result card: the HUD's picker rows
 * (tests/unit/hud/pick-model.test.tsx "lists every creature of the rule's side with band and reach…", "row names and
 * ring labels carry names and bands only (U1)…") and result (tests/unit/hud/result-panel.test.tsx, tests/unit/hud/
 * attack-pick.test.tsx "resolved: Hit / Miss / Defeated only (hard rule 2)") cover what their tests checked.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { damageLabel, outcomeLine, targetVerdict } from "@/components/combat-map/actions/attack";
import { hintOf } from "@/components/combat-map/actions/targets";
import { ActionsProvider, useCombatTargets } from "@/components/combat-map/actions/targets/state";
import type { RollRecord } from "@/lib/domain/duality";

import type { Id } from "../../convex/_generated/dataModel";

const tok = (s: string) => s as Id<"combatTokens">;
const BANDIT = tok("t-bandit");
const WOLF = tok("t-wolf");
describe("target hints", () => {
  it("hint priority: line of sight, then range, then cover", () => {
    expect(hintOf({ tokenId: BANDIT, band: "far", inRange: false, lineOfSight: false, cover: true }).text).toBe("No line of sight");
    expect(hintOf({ tokenId: BANDIT, band: "far", inRange: false, lineOfSight: true, cover: true }).tone).toBe("range");
    expect(hintOf({ tokenId: BANDIT, band: "close", inRange: true, lineOfSight: true, cover: true }).tone).toBe("cover");
    expect(hintOf(undefined).tone).toBe("none");
  });
});

describe("picking targets", () => {
  function Probe() {
    const t = useCombatTargets();
    return (
      <>
        <output data-testid="picked">{t.targetTokenIds.join(",")}</output>
        <button type="button" onClick={() => t.toggleTarget(BANDIT)}>
          bandit
        </button>
        <button type="button" onClick={() => t.toggleTarget(WOLF)}>
          wolf
        </button>
        <button type="button" onClick={() => t.toggleExtraTarget(BANDIT)}>
          extra bandit
        </button>
      </>
    );
  }

  it("a weapon attack's pick is single-select: another enemy replaces it, the same one clears it", () => {
    render(
      <ActionsProvider>
        <Probe />
      </ActionsProvider>,
    );
    const picked = screen.getByTestId("picked");
    act(() => fireEvent.click(screen.getByRole("button", { name: "bandit" })));
    expect(picked).toHaveTextContent("t-bandit");
    act(() => fireEvent.click(screen.getByRole("button", { name: "wolf" })));
    expect(picked.textContent).toBe("t-wolf");
    act(() => fireEvent.click(screen.getByRole("button", { name: "wolf" })));
    expect(picked.textContent).toBe("");
    // Cards that name several targets (CA6) add to the pick.
    act(() => fireEvent.click(screen.getByRole("button", { name: "wolf" })));
    act(() => fireEvent.click(screen.getByRole("button", { name: "extra bandit" })));
    expect(picked.textContent).toBe("t-wolf,t-bandit");
  });
});

const attackRoll: RollRecord = {
  kind: "action",
  dice: [
    { sides: 12, value: 9, role: "hope" },
    { sides: 12, value: 4, role: "fear" },
  ],
  modifier: 2,
  total: 15,
  outcome: "successHope",
  manual: false,
};

describe("attack words", () => {
  it("verdicts and outcome lines", () => {
    expect(targetVerdict({ hit: true, defeated: true })).toBe("Defeated");
    expect(targetVerdict({ hit: false, defeated: false })).toBe("Miss");
    expect(outcomeLine({ ...attackRoll, outcome: "critical" }).text).toBe("Critical success");
  });
});

describe("weapon damage at Proficiency", () => {
  it("multiplies the dice by Proficiency and keeps the modifier and type", () => {
    expect(damageLabel({ damage: "d8+3 phy" }, 2)).toBe("2d8+3 phy");
    expect(damageLabel({ damage: "d6 mag" }, 1)).toBe("1d6 mag");
  });
});
