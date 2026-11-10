import { act, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CharacterView } from "../../convex/characters";
import type { Id } from "../../convex/_generated/dataModel";
import { DOMAIN_CARDS } from "../../src/lib/srd/domain-cards";

// The guided level-up draft (plan guided-level-up, GL0): picks, the built LevelUpChoice, problems with their
// steps, the account draft (config N4 b: drafts kind levelUp) restore, cancel, finish and goTo.

const calls: { name: string; args: unknown }[] = [];
/** drafts.save / drafts.clear calls, apart from `calls` (the level-up intents). */
const draftCalls: { name: string; args: Record<string, unknown> }[] = [];
/** The account's level-up drafts by character id, as drafts.get returns them (a fake server). */
const accountDrafts = new Map<string, { schemaVersion: number; data: string; updatedAt: number }>();
/** drafts.get's arguments, or "skip", per render. */
const draftReads: unknown[] = [];
const functionName = (ref: unknown) => String((ref as Record<symbol, unknown>)[Symbol.for("functionName")] ?? ref);

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown, args: unknown) => {
    if (functionName(ref) !== "drafts:get") return undefined;
    draftReads.push(args);
    if (args === "skip") return undefined;
    return accountDrafts.get(String((args as { characterId: string }).characterId)) ?? null;
  },
  useMutation: (ref: unknown) => async (args: Record<string, unknown>) => {
    const name = functionName(ref);
    if (name === "drafts:save") {
      draftCalls.push({ name, args });
      accountDrafts.set(String(args.characterId), { schemaVersion: args.schemaVersion as number, data: args.data as string, updatedAt: 0 });
      return null;
    }
    if (name === "drafts:clear") {
      draftCalls.push({ name, args });
      accountDrafts.delete(String(args.characterId));
      return null;
    }
    calls.push({ name, args });
    return { level: 2 };
  },
}));

const { LevelUpDraftProvider, useLevelUpDraft } = await import("@/app/(gm)/campaigns/[campaignId]/party/[characterId]/level-up-draft");
const { issueTarget, advancementsChosen, cardsChosen } = await import("@/lib/party/level-up");
const { DRAFT_DEBOUNCE_MS } = await import("@/lib/party/wizard-draft");

/** The account draft of c1, parsed. */
const storedDraft = () => JSON.parse(accountDrafts.get("c1")!.data) as Record<string, unknown>;
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
    draftCalls.length = 0;
    draftReads.length = 0;
    accountDrafts.clear();
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

  it("sets the targets of the second traits pick of a tier with setPickTargets' index (GL5)", () => {
    const { result } = setup(character({ level: 2 }));
    act(() => result.current.start());
    act(() => result.current.togglePick("traits", 2, true));
    act(() => result.current.togglePick("traits", 2, true));
    act(() => result.current.setPickTargets("traits", 2, ["agility", "strength"]));
    act(() => result.current.setPickTargets("traits", 2, ["finesse", "instinct", "presence"], 1));
    expect(result.current.draft.picks).toEqual([
      { option: "traits", tier: 2, targets: ["agility", "strength"] },
      { option: "traits", tier: 2, targets: ["finesse", "instinct"] },
    ]);
    // Index 0 is the default; an index past the picks changes nothing.
    act(() => result.current.setPickTargets("traits", 2, ["knowledge", "presence"], 0));
    act(() => result.current.setPickTargets("traits", 2, ["agility"], 2));
    expect(result.current.draft.picks.map((p) => p.targets)).toEqual([
      ["knowledge", "presence"],
      ["finesse", "instinct"],
    ]);
    // Four distinct unmarked traits pass the rules; a trait in both picks does not.
    act(() => result.current.setCardId(CARD.id));
    expect(result.current.problems).toEqual([]);
    act(() => result.current.setPickTargets("traits", 2, ["knowledge", "agility"], 1));
    expect(result.current.problems).toEqual(["knowledge is marked this tier."]);
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

  it("saves the draft on the account per character from each change and restores it on another mount", () => {
    const first = setup();
    act(() => first.result.current.start());
    expect(draftCalls[0]).toEqual({
      name: "drafts:save",
      args: expect.objectContaining({ kind: "levelUp", characterId: "c1", schemaVersion: 1 }),
    });
    act(() => first.result.current.togglePick("hp", 2));
    act(() => first.result.current.goTo("advancements"));
    expect(storedDraft()).toEqual({ level: 1, step: "advancements", draft: { picks: [{ option: "hp", tier: 2 }], experienceName: "", cardId: "" } });
    expect(draftCalls.every((c) => c.name === "drafts:save" && c.args.characterId === "c1" && c.args.kind === "levelUp")).toBe(true);
    first.unmount();

    // Another tab or device: the same account draft opens the mode at its step.
    const again = setup();
    expect(draftReads.at(-1)).toEqual({ kind: "levelUp", characterId: "c1" });
    expect(again.result.current.active).toBe(true);
    expect(again.result.current.step).toBe("advancements");
    expect(again.result.current.draft.picks).toEqual([{ option: "hp", tier: 2 }]);
    again.unmount();

    // A draft started at another level is ignored (left for the next start to replace), not a crash.
    const before = draftCalls.length;
    const levelled = setup(character({ level: 2 }));
    expect(levelled.result.current.active).toBe(false);
    expect(draftCalls).toHaveLength(before);
  });

  it("debounces a typed Experience name and saves a click at once", () => {
    vi.useFakeTimers();
    try {
      const { result } = setup();
      act(() => result.current.start());
      const afterStart = draftCalls.length;
      act(() => result.current.setExperienceName("Court"));
      act(() => result.current.setExperienceName("Court musician"));
      expect(draftCalls).toHaveLength(afterStart);
      act(() => vi.advanceTimersByTime(DRAFT_DEBOUNCE_MS));
      expect(draftCalls).toHaveLength(afterStart + 1);
      expect(storedDraft()).toMatchObject({ draft: { experienceName: "Court musician" } });

      act(() => result.current.togglePick("hp", 2));
      expect(draftCalls).toHaveLength(afterStart + 2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores a bad account draft: another schemaVersion, broken JSON or a wrong shape", () => {
    const good = JSON.stringify({ level: 1, step: "advancements", draft: { picks: [], experienceName: "", cardId: "" } });
    const bad = [
      { schemaVersion: 2, data: good, updatedAt: 0 },
      { schemaVersion: 1, data: "{not json", updatedAt: 0 },
      { schemaVersion: 1, data: JSON.stringify({ level: 1, step: "nowhere", draft: {} }), updatedAt: 0 },
      { schemaVersion: 1, data: JSON.stringify({ level: 1, step: "deck", draft: { picks: [{ option: "nope", tier: 2 }], experienceName: "", cardId: "" } }), updatedAt: 0 },
    ];
    for (const stored of bad) {
      accountDrafts.set("c1", stored);
      const { result, unmount } = setup();
      expect(result.current.active).toBe(false);
      act(() => result.current.start());
      expect(result.current.active).toBe(true);
      unmount();
    }
    accountDrafts.set("c1", { schemaVersion: 1, data: good, updatedAt: 0 });
    expect(setup().result.current.active).toBe(true);
  });

  it("a viewer who cannot level never reads or writes the draft", () => {
    accountDrafts.set("c1", { schemaVersion: 1, data: JSON.stringify({ level: 1, step: "advancements", draft: { picks: [], experienceName: "", cardId: "" } }), updatedAt: 0 });
    const reader = setup(character({}, { canEdit: false }));
    expect(draftReads.every((a) => a === "skip")).toBe(true);
    expect(reader.result.current.active).toBe(false);
    act(() => reader.result.current.start());
    act(() => reader.result.current.goTo("deck"));
    expect(draftCalls).toEqual([]);
  });

  it("cancel ends the mode and clears the account draft", () => {
    const { result } = setup();
    act(() => result.current.start());
    act(() => result.current.togglePick("hp", 2));
    expect(accountDrafts.has("c1")).toBe(true);
    act(() => result.current.cancel());
    expect(result.current.active).toBe(false);
    expect(result.current.draft.picks).toEqual([]);
    expect(draftCalls.at(-1)).toEqual({ name: "drafts:clear", args: { kind: "levelUp", characterId: "c1" } });
    expect(accountDrafts.has("c1")).toBe(false);
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
    // The applied level-up's draft is gone from the account.
    expect(draftCalls.at(-1)).toEqual({ name: "drafts:clear", args: { kind: "levelUp", characterId: "c1" } });
    expect(accountDrafts.has("c1")).toBe(false);
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

  it("goes on to the Domain Deck once both picks and their choosers are done, then to Finish once the card is chosen", () => {
    const { result, navigate } = setup(character({ level: 2 }));
    act(() => result.current.start());
    expect(result.current.step).toBe("advancements");

    act(() => result.current.togglePick("hp", 2, true));
    act(() => result.current.togglePick("traits", 2, true));
    // The traits chooser is still open: no jump yet.
    expect(result.current.step).toBe("advancements");
    act(() => result.current.setPickTargets("traits", 2, ["agility"]));
    expect(result.current.step).toBe("advancements");
    act(() => result.current.setPickTargets("traits", 2, ["agility", "instinct"]));
    expect(result.current.step).toBe("deck");
    expect(navigate).toHaveBeenLastCalledWith("domains", "cards");

    act(() => result.current.setCardId(CARD.id));
    expect(result.current.step).toBe("finish");

    // Coming back to change a pick that is already complete does not jump away again.
    act(() => result.current.goTo("advancements"));
    act(() => result.current.togglePick("hp", 2, false));
    act(() => result.current.togglePick("stress", 2, true));
    expect(result.current.step).toBe("deck");
  });
});

describe("advancementsChosen and cardsChosen", () => {
  it("need both picks with their targets, and every card with no half-set exchange", () => {
    const traits = { option: "traits" as const, tier: 2, targets: ["agility", "instinct"] };
    expect(advancementsChosen({ picks: [traits], experienceName: "", cardId: "" })).toBe(false);
    expect(advancementsChosen({ picks: [traits, { option: "hp", tier: 2 }], experienceName: "", cardId: "" })).toBe(true);
    expect(advancementsChosen({ picks: [{ ...traits, targets: ["agility"] }, { option: "hp", tier: 2 }], experienceName: "", cardId: "" })).toBe(false);
    expect(advancementsChosen({ picks: [{ option: "domainCard", tier: 2, targets: [] }, { option: "hp", tier: 2 }], experienceName: "", cardId: "" })).toBe(true);
    const extra = { option: "domainCard" as const, tier: 2, targets: [] as string[] };
    expect(cardsChosen({ picks: [extra], experienceName: "", cardId: "a" })).toBe(false);
    expect(cardsChosen({ picks: [{ ...extra, targets: ["b"] }], experienceName: "", cardId: "a" })).toBe(true);
    expect(cardsChosen({ picks: [], experienceName: "", cardId: "a", trade: { out: "x", in: "" } })).toBe(false);
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
