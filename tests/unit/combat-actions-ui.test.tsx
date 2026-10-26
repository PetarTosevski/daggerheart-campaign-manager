/**
 * Combat Map actions UI (plan combat-actions CA5): the target list (bands and hints, Q1 / Q2), single-select picking
 * (user answer 2026-10-22, CB p.96), the attack result view (U1: hit / miss / defeated and the player's own dice, never
 * an enemy's numbers; Q5), the weapon damage label and the GM's resolution filter.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AttackResult, damageLabel, outcomeLine, targetVerdict } from "@/components/combat-map/actions/attack";
import { resolutionsOf } from "@/components/combat-map/actions/gm";
import { TargetRows, hintOf, type TargetHint } from "@/components/combat-map/actions/targets";
import { ActionsProvider, useCombatTargets } from "@/components/combat-map/actions/targets/state";
import type { RollRecord } from "@/lib/domain/duality";

import type { Id } from "../../convex/_generated/dataModel";

const tok = (s: string) => s as Id<"combatTokens">;
const BANDIT = tok("t-bandit");
const WOLF = tok("t-wolf");
const ARCHER = tok("t-archer");
const GHOST = tok("t-ghost");

const enemies = [
  { _id: BANDIT, name: "Bandit" },
  { _id: WOLF, name: "Wolf" },
  { _id: ARCHER, name: "Archer" },
  { _id: GHOST, name: "Ghost" },
];

const hints: TargetHint[] = [
  { tokenId: BANDIT, band: "melee", inRange: true, lineOfSight: true, cover: false },
  { tokenId: WOLF, band: "veryClose", inRange: true, lineOfSight: true, cover: true },
  { tokenId: ARCHER, band: "far", inRange: false, lineOfSight: true, cover: false },
];

describe("target list", () => {
  it("shows each enemy's band and hint, and a picked token that can't be attacked", () => {
    const onToggle = vi.fn();
    render(<TargetRows enemies={enemies} hints={hints} picked={[BANDIT, GHOST]} onToggle={onToggle} />);
    const list = screen.getByRole("list", { name: "Enemies in sight" });
    const rows = within(list).getAllByRole("button");
    expect(rows.map((r) => r.getAttribute("aria-label"))).toEqual([
      "Bandit, Melee, In range",
      "Wolf, Very Close, Cover: disadvantage",
      "Archer, Far, Out of range: the GM decides",
      "Ghost, Can't be attacked",
    ]);
    expect(rows.map((r) => r.getAttribute("aria-pressed"))).toEqual(["true", "false", "false", "true"]);
    fireEvent.click(rows[2]!);
    expect(onToggle).toHaveBeenCalledWith(ARCHER);
  });

  it("says when no enemy is in sight", () => {
    render(<TargetRows enemies={[]} hints={[]} picked={[]} onToggle={() => {}} />);
    expect(screen.getByTestId("combat-no-targets")).toHaveTextContent("No enemy in sight");
  });

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
const damageRoll: RollRecord = { kind: "damage", dice: [{ sides: 8, value: 6, role: "damage" }], modifier: 0, total: 6, outcome: "none", manual: false };

describe("attack result", () => {
  it("shows the dice, outcome, damage total and Hit / Miss / Defeated, and no enemy number", () => {
    const names = new Map<string, string>([
      [BANDIT, "Bandit"],
      [WOLF, "Wolf"],
      [ARCHER, "Archer"],
    ]);
    render(
      <AttackResult
        weaponName="Rapier"
        names={names}
        result={{
          roll: attackRoll,
          damage: damageRoll,
          fearGained: 0,
          targets: [
            { tokenId: BANDIT, hit: true, defeated: false },
            { tokenId: WOLF, hit: false, defeated: false },
            { tokenId: ARCHER, hit: true, defeated: true },
          ],
        }}
      />,
    );
    const result = screen.getByRole("region", { name: "Attack result" });
    expect(within(result).getByText("With Hope")).toBeInTheDocument();
    expect(within(result).getByText("15")).toBeInTheDocument();
    expect(within(result).getByTestId("combat-attack-damage")).toHaveTextContent("Damage");
    expect(within(result).getByTestId("combat-attack-damage")).toHaveTextContent("6");
    const verdicts = within(within(result).getByRole("list", { name: "Targets" })).getAllByRole("listitem");
    expect(verdicts.map((v) => v.textContent)).toEqual(["BanditHit", "WolfMiss", "ArcherDefeated"]);
    expect(result.textContent).not.toMatch(/\b(HP|Stress|Difficulty|threshold|Minor|Major|Severe)\b/);
    expect(within(result).getAllByRole("list", { name: "Dice" })).toHaveLength(2);
  });

  it("a miss on everything has no damage row", () => {
    render(<AttackResult weaponName="Rapier" names={new Map()} result={{ roll: { ...attackRoll, outcome: "failFear" }, damage: null, fearGained: 1, targets: [{ tokenId: BANDIT, hit: false, defeated: false }] }} />);
    expect(screen.queryByTestId("combat-attack-damage")).toBeNull();
    expect(screen.getByText("With Fear")).toBeInTheDocument();
    expect(screen.getByText(/the GM gains a Fear/)).toBeInTheDocument();
  });

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

describe("GM resolutions", () => {
  it("keeps the GM's combat rows only, newest first", () => {
    const base = { at: 1, actorId: "u" as Id<"users">, undone: false, canUndo: true, revealable: false };
    const rows = [
      { ...base, _id: "a" as Id<"actionLog">, kind: "combat" as const, visibility: "gm" as const, summary: "Ash attacks → Bandit: 6 phy → Minor → 1 HP (1/5)" },
      { ...base, _id: "b" as Id<"actionLog">, kind: "combat" as const, visibility: "public" as const, summary: "Ash attacks with Rapier → Bandit: Hit" },
      { ...base, _id: "c" as Id<"actionLog">, kind: "roll" as const, visibility: "public" as const, summary: "Ash rolls" },
    ];
    expect(resolutionsOf(rows).map((r) => r._id)).toEqual(["a"]);
  });
});
