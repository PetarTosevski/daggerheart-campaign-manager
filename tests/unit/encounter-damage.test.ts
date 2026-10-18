import { act, fireEvent, render, screen } from "@testing-library/react";
import { createElement, useSyncExternalStore } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyCondition,
  applyMark,
  damageSeverity,
  damageTaken,
  hordeHalved,
  hpForDamage,
  isDefeated,
  markHp,
  markStress,
  minionDefeats,
  vulnerableFromStress,
} from "@/lib/domain/encounters/damage";
import { applySpotlight, spotlightLimit, spotlightStatus, spotlightsThisTurn } from "@/lib/domain/encounters/spotlight";

// D8 A4: the tracker's pure rules (CB p.91, p.92, p.99, p.148, p.153, p.178, p.195, p.199, p.201, p.208) and the
// optimistic update on a double click (CL4: double-click "+" gives +2).

const T = { major: 8, severe: 15 };

describe("damage through thresholds", () => {
  it("marks 0 / 1 / 2 / 3 HP below, at Major and at Severe (CB p.91); no Massive Damage (Q3)", () => {
    expect(hpForDamage(0, T, false)).toBe(0);
    expect(hpForDamage(7, T, false)).toBe(1);
    expect(hpForDamage(8, T, false)).toBe(2);
    expect(hpForDamage(14, T, false)).toBe(2);
    expect(hpForDamage(15, T, false)).toBe(3);
    expect(hpForDamage(30, T, false)).toBe(3);
    expect(damageSeverity(-2, T, false)).toBe("none");
  });

  it("halves resistant damage before the thresholds (CB p.99), rounding down", () => {
    expect(damageTaken(26, true)).toBe(13);
    expect(damageTaken(15, true)).toBe(7);
    expect(hpForDamage(15, T, true)).toBe(1);
    expect(hpForDamage(16, T, true)).toBe(2);
    expect(hpForDamage(1, T, true)).toBe(0);
  });

  it("treats a None threshold as never reached, and None/None (Minions) as defeat on any damage", () => {
    expect(hpForDamage(20, { major: 6, severe: null }, false)).toBe(2);
    expect(hpForDamage(1, { major: null, severe: null }, false)).toBe("all");
    expect(damageSeverity(1, { major: null, severe: null }, false)).toBe("defeat");
    expect(hpForDamage(0, { major: null, severe: null }, false)).toBe(0);
  });
});

describe("HP and Stress tracks", () => {
  const tracks = { hp: 0, hpMax: 7, stress: 0, stressMax: 2 };

  it("keeps HP within 0..max and defeats on the last HP (CB p.208)", () => {
    expect(markHp(tracks, 3)).toEqual({ hp: 3 });
    expect(markHp(tracks, 9)).toEqual({ hp: 7 });
    expect(markHp({ ...tracks, hp: 2 }, -5)).toEqual({ hp: 0 });
    expect(isDefeated({ hp: 7, hpMax: 7 })).toBe(true);
    expect(isDefeated({ hp: 6, hpMax: 7 })).toBe(false);
  });

  it("marks 1 HP instead when Stress overflows (CB p.92, Q2)", () => {
    expect(markStress(tracks, 1)).toEqual({ stress: 1, hp: 0, overflow: false });
    expect(markStress({ ...tracks, stress: 1 }, 2)).toEqual({ stress: 2, hp: 1, overflow: true });
    expect(markStress({ ...tracks, stress: 2 }, 3)).toEqual({ stress: 2, hp: 1, overflow: true });
    expect(markStress({ ...tracks, stress: 2 }, -1)).toEqual({ stress: 1, hp: 0, overflow: false });
    expect(markStress({ ...tracks, stress: 2, hp: 7 }, 1)).toEqual({ stress: 2, hp: 7, overflow: true });
  });

  it("is Vulnerable while Stress is full (CB p.178), never for a block without Stress", () => {
    expect(vulnerableFromStress({ stress: 2, stressMax: 2 })).toBe(true);
    expect(vulnerableFromStress({ stress: 1, stressMax: 2 })).toBe(false);
    expect(vulnerableFromStress({ stress: 0, stressMax: 0 })).toBe(false);
  });

  it("halves a Horde at half its HP, rounded up (CB p.199)", () => {
    expect(hordeHalved({ hp: 2, hpMax: 5 })).toBe(false);
    expect(hordeHalved({ hp: 3, hpMax: 5 })).toBe(true);
    expect(hordeHalved({ hp: 3, hpMax: 6 })).toBe(true);
  });

  it("suggests 1 + floor(damage / X) Minion defeats (CB p.201, Q4), capped by those left", () => {
    expect(minionDefeats(7, 3)).toBe(3);
    expect(minionDefeats(2, 3)).toBe(1);
    expect(minionDefeats(0, 3)).toBe(0);
    expect(minionDefeats(30, 3, 4)).toBe(4);
    expect(minionDefeats(5, null)).toBe(1);
  });

  it("applies marks and conditions to an instance as the server stores them", () => {
    const instance = { hp: 6, stress: 2, defeated: false, conditions: ["hidden" as const], stats: { hpMax: 7, stressMax: 2 } };
    expect(applyMark(instance, "stress", 1)).toMatchObject({ hp: 7, stress: 2, defeated: true });
    expect(applyMark(instance, "hp", -1)).toMatchObject({ hp: 5, defeated: false });
    expect(applyCondition<"hidden" | "vulnerable", typeof instance & { conditions: ("hidden" | "vulnerable")[] }>(instance, "vulnerable").conditions).toEqual([
      "hidden",
      "vulnerable",
    ]);
    expect(applyCondition(instance, "hidden").conditions).toEqual([]);
  });
});

describe("spotlight per GM turn", () => {
  it("allows 1 per GM turn, X with Relentless (X), and warns past it without blocking (CB p.153, p.195, Q5)", () => {
    expect(spotlightLimit(null)).toBe(1);
    expect(spotlightLimit(3)).toBe(3);
    expect(spotlightStatus(1, 3)).toEqual({ count: 1, limit: 3, over: false, label: "Spotlight 1/3" });
    expect(spotlightStatus(2, 1).over).toBe(true);
    expect(spotlightStatus(5, "X").over).toBe(false);
  });

  it("counts only the current turn, so End GM turn resets without a write", () => {
    expect(spotlightsThisTurn({ spotlights: 2, spotlightTurn: 1 }, 1)).toBe(2);
    expect(spotlightsThisTurn({ spotlights: 2, spotlightTurn: 1 }, 2)).toBe(0);
    expect(applySpotlight({ spotlights: 2, spotlightTurn: 1 }, 2)).toEqual({ spotlights: 1, spotlightTurn: 2 });
    expect(applySpotlight({ spotlights: 2, spotlightTurn: 2 }, 2)).toEqual({ spotlights: 3, spotlightTurn: 2 });
  });
});

describe("tracker rolls", async () => {
  const { attackRoll, damageRoll, isNatural20, rulesFor } = await import("@/components/adversaries/tracker/rules");

  it("rolls d20 + ATK, or d20 + dice for a dice modifier (CB p.160)", () => {
    expect(attackRoll(3)).toEqual({ dice: [{ count: 1, sides: 20 }], modifier: 3 });
    expect(attackRoll("+2d4")).toEqual({ dice: [{ count: 1, sides: 20 }, { count: 2, sides: 4 }], modifier: 0 });
    expect(attackRoll("odd")).toBeNull();
    expect(isNatural20([{ sides: 20, value: 20 }])).toBe(true);
    expect(isNatural20([{ sides: 20, value: 19 }])).toBe(false);
  });

  it("rolls damage dice, adds the dice maximum on a critical (CB p.148: 2d8+2 → 16 + roll + 2), and leaves flat damage", () => {
    expect(damageRoll("2d8+2 phy")).toEqual({ dice: [{ count: 2, sides: 8 }], modifier: 2 });
    expect(damageRoll("2d8+2 phy", true)).toEqual({ dice: [{ count: 2, sides: 8 }], modifier: 18 });
    expect(damageRoll("2 phy")).toEqual({ flat: 2 });
    expect(damageRoll("nonsense")).toBeNull();
  });

  it("reads Relentless, Minion and Horde values from SRD and custom blocks", () => {
    expect(rulesFor({ kind: "srd", adversaryId: "acid-burrower" }, [])).toMatchObject({ relentless: 3, minionX: null, hordeX: null });
    expect(rulesFor({ kind: "srd", adversaryId: "jagged-knife-lackey" }, [])).toMatchObject({ relentless: null, minionX: 3 });
    expect(rulesFor({ kind: "srd", adversaryId: "nope" }, [])).toBeNull();
    expect(rulesFor({ kind: "custom", customId: "gone" }, [])).toBeNull();
  });
});

// ---------------------------------------------------------------- optimistic double click (CL4)

type Store = Map<string, unknown>;
const store: Store = new Map();
const listeners = new Set<() => void>();
const calls: { name: string; args: Record<string, unknown> }[] = [];
const nameOf = (ref: unknown) => String((ref as Record<symbol, unknown>)[Symbol.for("functionName")] ?? ref);
const local = {
  getQuery: (ref: unknown) => store.get(nameOf(ref)),
  setQuery: (ref: unknown, _args: unknown, value: unknown) => {
    store.set(nameOf(ref), value);
    for (const l of listeners) l();
  },
};

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown) =>
    useSyncExternalStore(
      (l) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
      () => store.get(nameOf(ref)),
    ),
  useMutation: (ref: unknown) => {
    const name = nameOf(ref);
    let updater: ((s: typeof local, args: Record<string, unknown>) => void) | null = null;
    const fn = Object.assign(
      async (args: Record<string, unknown>) => {
        calls.push({ name, args });
        updater?.(local, args);
        return null;
      },
      {
        withOptimisticUpdate: (u: typeof updater) => {
          updater = u;
          return fn;
        },
      },
    );
    return fn;
  },
}));

describe("instance card: optimistic pips", async () => {
  const { InstanceCard } = await import("@/components/adversaries/tracker/instance-card");
  const { useTracker } = await import("@/components/adversaries/tracker/use-tracker");
  const { useQuery } = await import("convex/react");
  const { api } = await import("../../convex/_generated/api");

  const bear = {
    _id: "i1",
    _creationTime: 0,
    campaignId: "c1",
    encounterId: "e1",
    source: { kind: "srd", adversaryId: "bear" },
    label: "Bear",
    order: 1,
    summoned: false,
    stats: { difficulty: 14, major: 9, severe: 17, hpMax: 7, stressMax: 2 },
    hp: 0,
    stress: 0,
    defeated: false,
    conditions: [],
    tags: [],
    spotlights: 0,
    spotlightTurn: 1,
    updatedAt: 0,
    name: "Bear",
    type: "Bruiser",
    tier: 1,
  };

  function Harness() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the mocked store holds the fixture as is
    const view = useQuery(api.encounters.get, { campaignId: "c1" as never, encounterId: "e1" }) as any;
    const actions = useTracker("c1" as never, "e1");
    if (!view) return null;
    return createElement(InstanceCard, { instance: view.instances[0], rules: null, gmTurn: view.encounter.gmTurn, selected: false, onSelect: () => {}, actions });
  }

  beforeEach(() => {
    calls.length = 0;
    store.set(nameOf(api.encounters.get), { encounter: { _id: "e1", gmTurn: 1 }, instances: [bear] });
  });

  it("marks 2 HP on a double click of + and sends two +1 intents", async () => {
    render(createElement(Harness));
    const plus = screen.getByRole("button", { name: "Mark 1 Hit Point on Bear" });
    await act(async () => {
      fireEvent.click(plus);
      fireEvent.click(plus);
    });
    expect(calls.filter((c) => c.name.endsWith("markHp")).map((c) => c.args.delta)).toEqual([1, 1]);
    expect(screen.getByRole("button", { name: "Mark Hit Point 2 of 7" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Mark Hit Point 3 of 7" })).toHaveAttribute("aria-pressed", "false");
    // The next pip click reads the optimistic value: pip 3 is one more mark, not three.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Mark Hit Point 3 of 7" }));
    });
    expect(calls.at(-1)!.args.delta).toBe(1);
  });

  it("counts spotlights and toggles conditions optimistically", async () => {
    render(createElement(Harness));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Spotlight Bear" }));
      fireEvent.click(screen.getByRole("button", { name: "Spotlight Bear" }));
    });
    expect(screen.getByTestId("spotlight-count")).toHaveTextContent("Spotlight 2/1");
    expect(screen.getByText("Past the limit for this GM turn")).toBeInTheDocument();
    const hidden = screen.getByRole("button", { name: "Hidden" });
    await act(async () => {
      fireEvent.click(hidden);
    });
    expect(screen.getByRole("button", { name: /Hidden/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("shows Vulnerable while Stress is full", async () => {
    render(createElement(Harness));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Mark Stress 2 of 2" }));
    });
    expect(calls.at(-1)).toMatchObject({ args: { delta: 2 } });
    expect(screen.getByText("Vulnerable · Stress full")).toBeInTheDocument();
  });
});
