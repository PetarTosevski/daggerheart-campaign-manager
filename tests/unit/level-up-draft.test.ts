import { act, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CharacterView } from "../../convex/characters";
import type { Id } from "../../convex/_generated/dataModel";
import { DOMAIN_CARDS } from "../../src/lib/srd/domain-cards";

// The guided level-up draft (plan guided-level-up, GL0): picks, the built LevelUpChoice, problems with their
// steps, sessionStorage restore, cancel, finish and goTo.

const calls: { name: string; args: unknown }[] = [];
const functionName = (ref: unknown) => String((ref as Record<symbol, unknown>)[Symbol.for("functionName")] ?? ref);

vi.mock("convex/react", () => ({
  useMutation: (ref: unknown) => async (args: unknown) => {
    calls.push({ name: functionName(ref), args });
    return { level: 2 };
  },
}));

const { LevelUpDraftProvider, useLevelUpDraft, issueTarget } = await import("@/app/(gm)/campaigns/[campaignId]/party/[characterId]/level-up-draft");

const KEY = "dcm:level-up-draft:c1";
/** A level-1 card of the Bard's domains the fixture doesn't own. */
const CARD = DOMAIN_CARDS.find((c) => c.domain === "grace" && c.level === 1 && c.source === "core" && c.id !== "deft-deceiver")!;

function character(sheet: Partial<CharacterView["sheet"]> = {}, overrides: Partial<CharacterView> = {}): CharacterView {
  return {
    _id: "c1" as Id<"characters">,
    ownerId: "u1" as Id<"users">,
    status: "active",
    portraitUrl: null,
    canEdit: true,
    mine: true,
    updatedAt: 0,
    sheet: {
      name: "Liriel",
      pronouns: "she/her",
      description: "",
      level: 1,
      classId: "bard",
      subclassId: "troubadour",
      ancestry: { kind: "single", id: "elf" },
      communityId: "loreborne",
      traits: { agility: 0, strength: -1, finesse: 1, instinct: 0, presence: 2, knowledge: 1 },
      traitMarks: {},
      evasion: 10,
      hpMax: 5,
      hp: 0,
      stressMax: 6,
      stress: 0,
      hope: 2,
      scars: 0,
      armorMarked: 0,
      proficiency: 1,
      primaryWeaponId: "rapier",
      armorId: "gambeson-armor",
      inventory: [],
      gold: { handfuls: 1, bags: 0, chest: false },
      experiences: [
        { id: "e1", name: "Wandering minstrel", value: 2 },
        { id: "e2", name: "Silver tongue", value: 2 },
      ],
      domainCards: { owned: ["deft-deceiver", "book-of-ava"], loadout: ["deft-deceiver", "book-of-ava"] },
      background: [],
      connections: [],
      notes: "",
      levelUpPending: true,
      ...sheet,
    } as CharacterView["sheet"],
    ...overrides,
  };
}

function setup(view: CharacterView = character(), { isGm = false } = {}) {
  const navigate = vi.fn();
  const slot = { campaignId: "k1" as Id<"campaigns">, character: view, canEdit: view.canEdit, isGm, hopeAndFear: false };
  const wrapper = ({ children }: { children: ReactNode }) => createElement(LevelUpDraftProvider, { slot, navigate }, children);
  const hook = renderHook(() => useLevelUpDraft(), { wrapper });
  return { ...hook, navigate };
}

describe("useLevelUpDraft", () => {
  beforeEach(() => {
    calls.length = 0;
    sessionStorage.clear();
    document.body.innerHTML = "";
  });

  it("is inactive with no-op actions outside the provider", () => {
    const { result } = renderHook(() => useLevelUpDraft());
    expect(result.current.active).toBe(false);
    expect(result.current.steps).toEqual([]);
    act(() => result.current.start());
    expect(result.current.active).toBe(false);
  });

  it("does not start for a viewer who cannot level (no flag and not the GM, or read only)", () => {
    const noFlag = setup(character({ levelUpPending: false }));
    expect(noFlag.result.current.canStart).toBe(false);
    act(() => noFlag.result.current.start());
    expect(noFlag.result.current.active).toBe(false);

    const reader = setup(character({}, { canEdit: false }), { isGm: true });
    act(() => reader.result.current.start());
    expect(reader.result.current.active).toBe(false);

    const gm = setup(character({ levelUpPending: false }), { isGm: true });
    expect(gm.result.current.canStart).toBe(true);
  });

  it("starts at the first step: the Experience at an achievement level, the advancements otherwise", () => {
    const two = setup();
    act(() => two.result.current.start());
    expect(two.result.current.active).toBe(true);
    expect(two.result.current.level).toBe(2);
    expect(two.result.current.steps.map((s) => s.id)).toEqual(["experiences", "advancements", "deck", "finish"]);
    expect(two.result.current.step).toBe("experiences");
    expect(two.navigate).toHaveBeenCalledWith("sheet", undefined);

    const three = setup(character({ level: 2 }));
    act(() => three.result.current.start());
    expect(three.result.current.steps.map((s) => s.id)).toEqual(["advancements", "deck", "finish"]);
    expect(three.result.current.steps[0]!.label).toBe("Advancements (0/2)");
    expect(three.navigate).toHaveBeenCalledWith("story", undefined);
  });

  it("toggles picks within the two picks and the slots, and sets targets", () => {
    const { result } = setup();
    act(() => result.current.start());
    act(() => result.current.togglePick("hp", 2));
    act(() => result.current.togglePick("hp", 2, true));
    expect(result.current.draft.picks).toEqual([
      { option: "hp", tier: 2 },
      { option: "hp", tier: 2 },
    ]);
    expect(result.current.picksUsed).toBe(2);
    // No picks left: a third is refused.
    act(() => result.current.togglePick("stress", 2));
    expect(result.current.draft.picks).toHaveLength(2);
    // Toggling a taken option removes one.
    act(() => result.current.togglePick("hp", 2));
    expect(result.current.draft.picks).toEqual([{ option: "hp", tier: 2 }]);
    // Locked tiers and the both-picks options at level 2 are refused.
    act(() => result.current.togglePick("proficiency", 3));
    expect(result.current.draft.picks).toHaveLength(1);

    act(() => result.current.togglePick("experiences", 2));
    expect(result.current.draft.picks[1]).toEqual({ option: "experiences", tier: 2, targets: [] });
    act(() => result.current.setPickTargets("experiences", 2, ["e1", "e2", "e3"]));
    expect(result.current.draft.picks[1]!.targets).toEqual(["e1", "e2"]);
    act(() => result.current.togglePick("experiences", 2, false));
    expect(result.current.draft.picks).toEqual([{ option: "hp", tier: 2 }]);
  });

  it("builds the choice, lists problems with their steps and clears them as choices are made", () => {
    const { result } = setup();
    act(() => result.current.start());
    expect(result.current.choice).toEqual({ picks: [], cardId: "", experienceName: "" });
    const targets = Object.fromEntries(result.current.issues.map((i) => [i.message, i.target]));
    expect(targets).toMatchObject({
      "Choose two advancements (Proficiency and multiclass take both).": "advancements",
      "Name the new Experience (up to 80 characters).": "experiences",
      "Choose the level's domain card.": "deck",
    });
    expect(result.current.steps.every((s) => !s.done)).toBe(true);

    act(() => {
      result.current.setExperienceName("  Never misses a cue ");
      result.current.togglePick("hp", 2);
      result.current.togglePick("stress", 2);
      result.current.setCardId(CARD.id);
      result.current.setTrade({ out: "book-of-ava", in: "" });
      result.current.setMulticlass({ classId: "wizard", domainId: "codex", subclassId: "x" });
    });
    // The half-chosen trade and a multiclass without its pick stay out of the choice.
    expect(result.current.choice).toEqual({
      picks: [
        { option: "hp", tier: 2 },
        { option: "stress", tier: 2 },
      ],
      cardId: CARD.id,
      experienceName: "Never misses a cue",
    });
    expect(result.current.problems).toEqual([]);
    expect(result.current.steps.every((s) => s.done)).toBe(true);

    act(() => result.current.setTrade(null));
    expect(result.current.draft.trade).toBeUndefined();
  });

  it("leaves the Experience name out of the choice away from achievement levels", () => {
    const { result } = setup(character({ level: 2 }));
    act(() => result.current.start());
    act(() => result.current.setExperienceName("Ignored"));
    expect(result.current.choice).not.toHaveProperty("experienceName");
  });

  it("restores the draft from sessionStorage and drops one from another level", () => {
    const first = setup();
    act(() => first.result.current.start());
    act(() => first.result.current.togglePick("hp", 2));
    act(() => first.result.current.goTo("advancements"));
    const stored = JSON.parse(sessionStorage.getItem(KEY)!);
    expect(stored).toMatchObject({ v: 1, level: 1, step: "advancements", draft: { picks: [{ option: "hp", tier: 2 }] } });
    first.unmount();

    const again = setup();
    expect(again.result.current.active).toBe(true);
    expect(again.result.current.step).toBe("advancements");
    expect(again.result.current.draft.picks).toEqual([{ option: "hp", tier: 2 }]);
    again.unmount();

    const levelled = setup(character({ level: 2 }));
    expect(levelled.result.current.active).toBe(false);
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it("ignores a broken stored draft and works when storage throws", () => {
    sessionStorage.setItem(KEY, "{not json");
    expect(setup().result.current.active).toBe(false);

    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const setSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const { result } = setup();
    act(() => result.current.start());
    expect(result.current.active).toBe(true);
    spy.mockRestore();
    setSpy.mockRestore();
  });

  it("cancel ends the mode and drops the stored draft", () => {
    const { result } = setup();
    act(() => result.current.start());
    act(() => result.current.togglePick("hp", 2));
    expect(sessionStorage.getItem(KEY)).not.toBeNull();
    act(() => result.current.cancel());
    expect(result.current.active).toBe(false);
    expect(result.current.draft.picks).toEqual([]);
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it("finish refuses while problems remain, then calls levelUp.apply once with the choice", async () => {
    const { result } = setup();
    act(() => result.current.start());
    let ok = true;
    await act(async () => {
      ok = await result.current.finish();
    });
    expect(ok).toBe(false);
    expect(calls).toEqual([]);

    act(() => {
      result.current.setExperienceName("Never misses a cue");
      result.current.togglePick("hp", 2);
      result.current.togglePick("stress", 2);
      result.current.setCardId(CARD.id);
    });
    await act(async () => {
      ok = await result.current.finish();
    });
    expect(ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.name).toBe("levelUp:apply");
    expect(calls[0]!.args).toMatchObject({ characterId: "c1" });
    expect((calls[0]!.args as { choice: unknown }).choice).toEqual({
      picks: [
        { option: "hp", tier: 2 },
        { option: "stress", tier: 2 },
      ],
      cardId: CARD.id,
      experienceName: "Never misses a cue",
    });
    expect(result.current.active).toBe(false);
  });

  it("goTo switches the page and sub-tab and focuses the target's heading, or the page tab when it is missing", () => {
    document.body.innerHTML = `<button id="tab-domains">Domains</button><section id="lu-target-advancements"><h3>Level Up</h3></section>`;
    const { result, navigate } = setup();
    act(() => result.current.start());
    act(() => result.current.goTo("deck"));
    expect(navigate).toHaveBeenLastCalledWith("domains", "cards");
    expect(result.current.step).toBe("deck");
    expect(document.activeElement?.id).toBe("tab-domains");

    act(() => result.current.goTo("advancements"));
    expect(navigate).toHaveBeenLastCalledWith("story", undefined);
    expect(document.activeElement?.textContent).toBe("Level Up");
    expect(document.activeElement?.getAttribute("tabindex")).toBe("-1");
  });
});

describe("issueTarget", () => {
  const sheet = { experiences: [{ id: "e1", name: "Silver tongue", value: 10 }] };
  it("sends each problem to the place that fixes it", () => {
    expect(issueTarget("Choose two different Experiences.", sheet)).toBe("experiences");
    expect(issueTarget("Silver tongue is already at +10.", sheet)).toBe("experiences");
    expect(issueTarget("agility is already at +10.", sheet)).toBe("advancements");
    expect(issueTarget("Choose a domain card.", sheet)).toBe("deck");
    expect(issueTarget("Trade Book of Ava for a card of level 1 or lower.", sheet)).toBe("deck");
    expect(issueTarget("You already have Book of Ava.", sheet)).toBe("deck");
    expect(issueTarget("Choose a foundation card from that class's subclasses.", sheet)).toBe("advancements");
    expect(issueTarget("Choose an additional domain card: every slot in tier 2 is marked.", sheet)).toBe("advancements");
  });
});
