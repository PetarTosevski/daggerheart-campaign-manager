/**
 * The Hand on the Combat Map (plan combat-actions CA6): what a card use asks first (the dialog only when the card needs
 * a choice), the choices list sent to combatCards.useCard, badges and recall labels; the Hand itself with Convex mocked:
 * Use on combat cards (once per click, picked targets), no button on passive cards, exhausted cards greyed with their
 * reset label, Recall from the vault (free during an open rest), the GM's locked view, the after-the-roll choice
 * resubmitted; the result view (U1); and the panel memory that keeps results across the 760 px layout switch.
 * F7-H4 (dcm-bxp.99.24): dialog picks ringed on the map (`toggleExtraTarget`), another player's hand read only or
 * hidden, the player's and the GM's sharing switches. F8-I1 (dcm-bxp.99.28): the roll-options strip in the Hand applies
 * to the next card that rolls, and a rolling card with an enemy picked and nothing else to ask fires at once.
 * HF1 (plan hand-fan, dcm-bxp.99.30): the fan docked along the bottom of the map. A card dragged onto the table goes
 * the same way as its Use; a one-enemy card with no enemy picked waits for the enemy tapped on the map; used, greyed
 * and read-only cards don't drag; "Hide cards" leaves the peek tab and is remembered per player; the dock portals into
 * the map board.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { PanelMemoryProvider, usePanelMemory } from "@/components/combat-map/actions/attack/memory";
import { Hand, HandBody, HandColumn, handHiddenKey, type BodyProps } from "@/components/combat-map/actions/hand";
import { HideHandSwitch } from "@/components/combat-map/actions/hand/sharing";
import { ActionsProvider, useCombatTargets } from "@/components/combat-map/actions/targets/state";
import { HandSharingSwitch } from "@/components/combat-map/settings/hand-sharing";
import type { ActionsPanelProps } from "@/components/combat-map/slots";
import {
  aimsOnMap,
  answerChoices,
  cardBadges,
  dropsOnTable,
  choicesOf,
  formFor,
  formProblem,
  initialValues,
  needsDialog,
  playableUses,
  recallLabel,
  rollOf,
  usedRollOptions,
  type HandCard,
  type ResolvedUse,
} from "@/components/combat-map/actions/hand/model";
import { CardResult } from "@/components/combat-map/actions/hand/result";
import { NO_ROLL_OPTIONS, rollSummary } from "@/components/combat-map/actions/roll-controls";
import { cardEffect } from "@/lib/srd/card-effects";
import type { CardUse } from "@/lib/domain/card-effects/types";
import type { RollRecord } from "@/lib/domain/duality";

import type { Id } from "../../convex/_generated/dataModel";

const calls: { name: string; args: Record<string, unknown> }[] = [];
const results: Record<string, unknown[]> = {};
const queries: Record<string, unknown> = {};
const functionName = (ref: unknown) => String((ref as Record<symbol, unknown>)[Symbol.for("functionName")] ?? ref);

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown, args: unknown) => (args === "skip" ? undefined : queries[functionName(ref)]),
  useMutation: (ref: unknown) => {
    const name = functionName(ref);
    const run = async (args: Record<string, unknown>) => {
      calls.push({ name, args });
      return results[name]?.shift() ?? null;
    };
    return Object.assign(run, { withOptimisticUpdate: () => run });
  },
}));

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    if (!this.hasAttribute("open")) return;
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});

afterEach(() => {
  calls.length = 0;
  for (const k of Object.keys(results)) delete results[k];
  for (const k of Object.keys(queries)) delete queries[k];
});

const tok = (s: string) => s as Id<"combatTokens">;
const BANDIT = tok("t-bandit");
const ARCHER = tok("t-archer");
const ASH = tok("t-ash");
const MIRA = tok("t-mira");

const use = (cardId: string, useId = "main"): CardUse => {
  const found = cardEffect(cardId)?.uses.find((u) => u.id === useId);
  if (!found) throw new Error(`no use ${cardId}/${useId}`);
  return found;
};

type HandUseFixture = HandCard["uses"][number];
const handUse = (useId: string, name: string, extra: Partial<HandUseFixture> = {}): HandUseFixture => ({
  useId,
  name,
  activation: "action",
  ready: true,
  resetLabel: null,
  usesLeft: null,
  rolls: true,
  targets: { side: "enemy", range: "far", count: "one" },
  choices: [],
  ...extra,
});

const card = (cardId: string, name: string, extra: Partial<HandCard> = {}): HandCard => ({
  cardId,
  name,
  domain: "splendor",
  level: 1,
  type: "spell",
  recallCost: 1,
  place: "loadout",
  usage: "combat",
  state: "ready",
  resetLabel: null,
  tokens: 0,
  uses: [handUse("main", name)],
  ...extra,
});

const BOLT = card("bolt-beacon", "Bolt Beacon");
const DEFT = card("deft-maneuvers", "Deft Maneuvers", { domain: "bone", type: "ability", state: "exhausted", resetLabel: "Back after a rest", uses: [handUse("main", "Deft Maneuvers", { ready: false, resetLabel: "Back after a rest", targets: null })] });
const BONES = card("bare-bones", "Bare Bones", { domain: "valor", type: "ability", usage: "passive", state: "passive", uses: [handUse("main", "Bare Bones", { activation: "passive", targets: null })] });
const ILLIAT = card("book-of-illiat", "Book of Illiat", {
  domain: "codex",
  type: "grimoire",
  uses: [
    handUse("slumber", "Slumber", { targets: { side: "enemy", range: "veryClose", count: "one" } }),
    handUse("arcane-barrage", "Arcane Barrage", { rolls: false, targets: { side: "enemy", range: "close", count: "one" }, choices: [{ id: "hope", label: "Hope to spend", min: 1 }] }),
    handUse("telepathy", "Telepathy", { rolls: false, targets: { side: "any", range: "unlimited", count: "one" } }),
  ],
});
const AVA = card("book-of-ava", "Book of Ava", { domain: "codex", type: "grimoire", place: "vault", recallCost: 2 });

const roll = (total: number): RollRecord => ({
  kind: "action",
  dice: [
    { sides: 12, value: 8, label: "Hope" },
    { sides: 12, value: 3, label: "Fear" },
  ],
  modifier: total - 11,
  total,
  outcome: "successHope",
} as unknown as RollRecord);

const resolved = (extra: Partial<ResolvedUse> = {}): ResolvedUse => ({
  status: "resolved",
  entryId: "e1" as Id<"actionLog">,
  cardId: "bolt-beacon",
  useId: "main",
  roll: roll(15),
  damage: [],
  success: true,
  targets: [{ tokenId: BANDIT, hit: true, defeated: false }],
  fearDelta: 0,
  prompts: [],
  minionOffer: null,
  ...extra,
});

describe("what a use asks first", () => {
  it("Bolt Beacon rolls but asks nothing else, so with an enemy picked it fires at once (F8-I1); without one the dialog asks", () => {
    const form = formFor(use("bolt-beacon"));
    expect(form.targets).toEqual({ side: "enemy", max: 1, range: "far" });
    expect(form.rolls).toBe(true);
    expect(needsDialog(form, { spells: 1, pickedEnemies: 1, gm: false })).toBe(false);
    expect(needsDialog(form, { spells: 1, pickedEnemies: 0, gm: false })).toBe(true);
    expect(initialValues(form, [ARCHER, BANDIT]).targets).toEqual([BANDIT]);
    expect(choicesOf(form, initialValues(form, [BANDIT]))).toEqual([]);
  });

  it("a one-enemy card that does not roll (Deadly Focus) fires at once with an enemy picked; without one the dialog asks", () => {
    const form = formFor(use("deadly-focus"));
    expect(form.rolls).toBe(false);
    expect(needsDialog(form, { spells: 1, pickedEnemies: 1, gm: false })).toBe(false);
    expect(needsDialog(form, { spells: 1, pickedEnemies: 0, gm: false })).toBe(true);
  });

  it("the strip's roll options become useCard's roll: Experiences, advantage or disadvantage, Help; nothing set → no roll", () => {
    const form = formFor(use("bolt-beacon"));
    const values = initialValues(form, [BANDIT]);
    expect(rollOf(form, values, false, NO_ROLL_OPTIONS)).toBeUndefined();
    expect(rollOf(form, null, false, { experienceIds: ["e1"], edge: 2, help: 1 })).toEqual({ experienceIds: ["e1"], advantage: 2, help: 1 });
    expect(rollOf(form, values, false, { ...NO_ROLL_OPTIONS, edge: -1 })).toEqual({ disadvantage: 1 });
    // The dialog's Difficulty only for the GM.
    expect(rollOf(form, { ...values, difficulty: 12 }, true, NO_ROLL_OPTIONS)).toEqual({ difficulty: 12 });
    expect(rollOf(form, { ...values, difficulty: 12 }, false, NO_ROLL_OPTIONS)).toBeUndefined();
    // A card that doesn't roll sends none of them.
    const deadly = formFor(use("deadly-focus"));
    expect(rollOf(deadly, initialValues(deadly, [BANDIT]), false, { experienceIds: ["e1"], edge: 1, help: 0 })).toBeUndefined();
    expect(usedRollOptions({ roll: { experienceIds: ["e1"] } })).toBe(true);
    expect(usedRollOptions({ roll: { difficulty: 12 } })).toBe(false);
    expect(usedRollOptions({})).toBe(false);
    expect(rollSummary({ experienceIds: ["e1", "e2"], edge: -1, help: 1 })).toBe("Disadvantage ×1 · 2 Experiences · 1 Help die");
    expect(rollSummary(NO_ROLL_OPTIONS)).toBeNull();
  });

  it("a grimoire asks which spell; Arcane Barrage asks the Hope to spend (n:hope)", () => {
    const form = formFor(use("book-of-illiat", "arcane-barrage"));
    expect(needsDialog(form, { spells: 3, pickedEnemies: 1, gm: false })).toBe(true);
    expect(form.numbers).toEqual([{ id: "hope", label: "Hope to spend", min: 1, max: null }]);
    const values = { ...initialValues(form, [BANDIT]), numbers: { hope: 3 } };
    expect(choicesOf(form, values)).toEqual([{ id: "n:hope", value: 3 }]);
  });

  it("a situation must be confirmed before Mending Touch can run", () => {
    const form = formFor(use("mending-touch"));
    expect(form.situations).toEqual(["You can take a few minutes to focus on the target"]);
    expect(form.targets?.side).toBe("any");
    const values = { ...initialValues(form, []), targets: [MIRA] };
    expect(formProblem(form, values)).toBe("Confirm the card's situation.");
    const confirmed = { ...values, situations: form.situations };
    expect(formProblem(form, confirmed)).toBeNull();
    expect(choicesOf(form, confirmed)).toEqual([{ id: "situations", value: form.situations }]);
  });

  it("a card with no targets and no choices (Deft Maneuvers) needs no dialog", () => {
    const form = formFor(use("deft-maneuvers"));
    expect(form.targets).toBeNull();
    expect(needsDialog(form, { spells: 1, pickedEnemies: 0, gm: false })).toBe(false);
  });

  it("the server's after-the-roll asks become opt:<step> and split:<token> choices", () => {
    const asks = [
      { kind: "choose" as const, stepId: "grip", label: "Choose one", options: [{ id: "pull", label: "Pull" }] },
      { kind: "split" as const, label: "Split the damage", tokenIds: [BANDIT, ARCHER] },
    ];
    expect(answerChoices(asks, { grip: ["pull"] }, { [BANDIT]: 4 })).toEqual([
      { id: "opt:grip", value: ["pull"] },
      { id: `split:${BANDIT}`, value: 4 },
      { id: `split:${ARCHER}`, value: 0 },
    ]);
  });

  it("badges: costs, a cost on a success, the limit; passive and grimoires say so", () => {
    expect(cardBadges(BOLT, cardEffect("bolt-beacon"))).toEqual([{ kind: "cost", text: "On a success: 1 Hope" }]);
    expect(cardBadges({ ...DEFT, state: "ready" }, cardEffect("deft-maneuvers"))).toEqual([
      { kind: "cost", text: "1 Stress" },
      { kind: "limit", text: "Once per rest" },
    ]);
    expect(cardBadges(BONES, cardEffect("bare-bones"))).toEqual([{ kind: "how", text: "Passive" }]);
    expect(cardBadges(ILLIAT, cardEffect("book-of-illiat"))).toEqual([{ kind: "how", text: "3 spells" }]);
    expect(playableUses(BONES)).toEqual([]);
  });

  it("recall costs Stress, free during an open rest (CB p.101, p.105)", () => {
    expect(recallLabel(2, false)).toBe("Recall: 2 Stress");
    expect(recallLabel(2, true)).toBe("Recall: free");
    expect(recallLabel(0, false)).toBe("Recall: free");
  });
});

const props = (extra: Partial<BodyProps> = {}): BodyProps => ({
  campaignId: "c1" as Id<"campaigns">,
  mapId: "m1" as Id<"combatMaps">,
  characterId: "ch1" as Id<"characters">,
  creatures: [
    { tokenId: ASH, name: "You", side: "self" },
    { tokenId: MIRA, name: "Mira", side: "pc" },
    { tokenId: BANDIT, name: "Bandit", side: "enemy" },
    { tokenId: ARCHER, name: "Archer", side: "enemy" },
  ],
  pickedEnemies: [BANDIT],
  gm: false,
  canPlay: true,
  ...extra,
});

function withHand(loadout: HandCard[], vault: HandCard[] = [], restOpen = false) {
  queries["combatCards:hand"] = { characterId: "ch1", loadout, vault };
  queries["rests:current"] = { open: restOpen ? { _id: "r1" } : null };
  queries["combatCards:pending"] = [];
}

const useCalls = () => calls.filter((c) => c.name === "combatCards:useCard");

describe("the Hand", () => {
  it("lists the loadout: Use on combat cards, none on passive cards, exhausted cards greyed with their reset label", () => {
    withHand([BOLT, DEFT, BONES], [AVA]);
    render(<HandBody {...props()} />);
    const loadout = screen.getByRole("list", { name: "Loadout" });
    const bolt = within(loadout).getByRole("article", { name: "Bolt Beacon" });
    expect(within(bolt).getByRole("button", { name: "Use Bolt Beacon" })).toBeEnabled();
    expect(within(bolt).getByRole("list", { name: "Cost and limit" })).toHaveTextContent("On a success: 1 Hope");
    const deft = within(loadout).getByRole("article", { name: "Deft Maneuvers, used: Back after a rest" });
    expect(deft).toHaveAttribute("data-exhausted", "true");
    expect(deft).toHaveTextContent("Used · Back after a rest");
    expect(within(deft).queryByRole("button", { name: /^Use/ })).toBeNull();
    const bones = within(loadout).getByRole("article", { name: "Bare Bones" });
    expect(within(bones).queryByRole("button", { name: /^Use/ })).toBeNull();
    expect(within(bones).getByRole("button", { name: "More about Bare Bones" })).toBeInTheDocument();
    // HF1: the vault opens from the deck at the bar's right end.
    expect(screen.queryByRole("list", { name: "Vault" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open vault, 1 card" }));
    const vault = screen.getByRole("list", { name: "Vault" });
    expect(within(vault).getByRole("button", { name: "Recall: 2 Stress, Book of Ava" })).toBeEnabled();
  });

  it("Use on Bolt Beacon with the Bandit picked fires useCard once with no dialog (F8-I1) and shows Hit", async () => {
    withHand([BOLT]);
    results["combatCards:useCard"] = [resolved()];
    render(<HandBody {...props()} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Use Bolt Beacon" })));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(useCalls()).toHaveLength(1);
    expect(useCalls()[0]!.args).toMatchObject({ cardId: "bolt-beacon", spell: "main", targetTokenIds: [BANDIT], choices: [] });
    const result = screen.getByRole("region", { name: "Card result" });
    expect(within(result).getByTestId("combat-card-verdict")).toHaveTextContent(/Bandit\s*Hit/);
    expect(result).not.toHaveTextContent(/\b(HP|Stress|Difficulty|threshold|Minor|Major|Severe)\b/);
  });

  it("with no enemy picked the dialog asks for the target, then fires once", async () => {
    withHand([BOLT]);
    results["combatCards:useCard"] = [resolved({ targets: [{ tokenId: ARCHER, hit: false, defeated: false }] })];
    render(<HandBody {...props({ pickedEnemies: [] })} />);
    fireEvent.click(screen.getByRole("button", { name: "Use Bolt Beacon" }));
    const dialog = screen.getByRole("dialog", { name: "Bolt Beacon" });
    // Only enemies fit; the actor and Mira are not offered.
    expect(within(dialog).getAllByRole("button", { pressed: false }).map((b) => b.textContent)).toEqual(["Bandit", "Archer"]);
    expect(within(dialog).getByRole("button", { name: "Pick a target." })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Archer" }));
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Use Bolt Beacon" })));
    expect(useCalls()).toHaveLength(1);
    expect(useCalls()[0]!.args).toMatchObject({ targetTokenIds: [ARCHER] });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTestId("combat-card-verdict")).toHaveTextContent(/Archer\s*Miss/);
  });

  it("a grimoire's dialog picks the spell and its Hope, and a used spell can't be picked", async () => {
    withHand([{ ...ILLIAT, uses: ILLIAT.uses.map((u) => (u.useId === "slumber" ? { ...u, ready: false, resetLabel: "Back after a rest" } : u)) }]);
    results["combatCards:useCard"] = [resolved({ cardId: "book-of-illiat", useId: "arcane-barrage", roll: null })];
    render(<HandBody {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: "Use Book of Illiat" }));
    const dialog = screen.getByRole("dialog", { name: "Book of Illiat" });
    expect(within(dialog).getByRole("button", { name: /^Slumber · Used/ })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Arcane Barrage" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.change(within(dialog).getByRole("spinbutton", { name: "Hope to spend" }), { target: { value: "2" } });
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Use Arcane Barrage" })));
    expect(useCalls()[0]!.args).toMatchObject({ cardId: "book-of-illiat", spell: "arcane-barrage", targetTokenIds: [BANDIT], choices: [{ id: "n:hope", value: 2 }] });
  });

  it("a choice after the roll opens a second dialog and resubmits the same use with it", async () => {
    withHand([BOLT]);
    results["combatCards:useCard"] = [
      { status: "needsChoice", asks: [{ kind: "choose", stepId: "pick", label: "Choose one", options: [{ id: "a", label: "Option A" }] }] },
      resolved(),
    ];
    render(<HandBody {...props()} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Use Bolt Beacon" })));
    const dialog = screen.getByRole("dialog", { name: "Bolt Beacon" });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Option A" }));
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Continue" })));
    expect(useCalls()).toHaveLength(2);
    expect(useCalls()[1]!.args).toMatchObject({ cardId: "bolt-beacon", targetTokenIds: [BANDIT], choices: [{ id: "opt:pick", value: ["a"] }] });
    expect(screen.getByRole("region", { name: "Card result" })).toBeInTheDocument();
  });

  it("Recall calls characters.moveCard into the loadout, free during an open rest", async () => {
    withHand([BOLT], [AVA], true);
    render(<HandBody {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: "Open vault, 1 card" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Recall: free, Book of Ava" })));
    expect(calls.find((c) => c.name === "characters:moveCard")?.args).toEqual({ characterId: "ch1", cardId: "book-of-ava", to: "loadout", duringRest: true });
  });

  it("the GM's view before 'Play for this character': greyed, no Use and no Recall", () => {
    withHand([BOLT], [AVA]);
    render(<HandBody {...props({ gm: true, canPlay: false, pickedEnemies: [] })} />);
    const bolt = screen.getByRole("article", { name: "Bolt Beacon" });
    expect(bolt).toHaveAttribute("data-locked", "true");
    expect(screen.queryByRole("button", { name: /^Use/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Recall/ })).toBeNull();
    expect(screen.getByText(/Turn on “Play for this character”/)).toBeInTheDocument();
  });
});

const SHEET = { experiences: [{ id: "x1", name: "Sellsword", value: 2 }, { id: "x2", name: "Lockpick", value: 1 }], hope: 1 };

/** Shows the page's picked targets (the map's rings read the same state). */
function Rings() {
  const { targetTokenIds } = useCombatTargets();
  return <output data-testid="rings">{targetTokenIds.join(",")}</output>;
}

describe("F8-I1: the roll-options strip; rings in the card dialog", () => {
  it("the Hand's strip applies to the next card that rolls: it fires at once with them, then the strip clears", async () => {
    withHand([BOLT]);
    queries["characters:get"] = { sheet: SHEET };
    results["combatCards:useCard"] = [resolved(), resolved()];
    render(<HandBody {...props()} />);
    const strip = screen.getByTestId("combat-hand-roll-options");
    expect(strip).toHaveTextContent("Applies to the next card that rolls.");
    fireEvent.click(within(strip).getByRole("button", { name: "Sellsword (+2)" }));
    fireEvent.click(within(strip).getByRole("button", { name: "More advantage" }));
    fireEvent.click(within(strip).getByRole("button", { name: "More help dice" }));
    // Two Experiences with 1 Hope: a rolling card waits until the strip is fixed.
    fireEvent.click(within(strip).getByRole("button", { name: "Lockpick (+1)" }));
    expect(screen.getByText("Not enough Hope for those Experiences.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use Bolt Beacon" })).toBeDisabled();
    fireEvent.click(within(strip).getByRole("button", { name: "Lockpick (+1)" }));
    expect(within(strip).getByText(/Advantage ×1 · 1 Experience · 1 Help die/)).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Use Bolt Beacon" })));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(useCalls()).toHaveLength(1);
    expect(useCalls()[0]!.args).toMatchObject({ targetTokenIds: [BANDIT], roll: { experienceIds: ["x1"], advantage: 1, help: 1 } });
    // Cleared: the next card rolls plainly.
    expect(within(strip).getByRole("button", { name: "Sellsword (+2)" })).toHaveAttribute("aria-pressed", "false");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Use Bolt Beacon" })));
    expect(useCalls()[1]!.args).not.toHaveProperty("roll");
  });

  it("a rolling card that opens the dialog names the strip's options and sends them", async () => {
    withHand([BOLT]);
    queries["characters:get"] = { sheet: SHEET };
    results["combatCards:useCard"] = [resolved({ targets: [{ tokenId: ARCHER, hit: true, defeated: false }] })];
    render(<HandBody {...props({ pickedEnemies: [] })} />);
    fireEvent.click(within(screen.getByTestId("combat-hand-roll-options")).getByRole("button", { name: "Less advantage" }));
    fireEvent.click(screen.getByRole("button", { name: "Use Bolt Beacon" }));
    const dialog = screen.getByRole("dialog", { name: "Bolt Beacon" });
    expect(within(dialog).getByTestId("combat-card-roll-note")).toHaveTextContent("Roll options from the Hand: Disadvantage ×1");
    fireEvent.click(within(dialog).getByRole("button", { name: "Archer" }));
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Use Bolt Beacon" })));
    expect(useCalls()[0]!.args).toMatchObject({ targetTokenIds: [ARCHER], roll: { disadvantage: 1 } });
  });

  it("a card that does not roll leaves the strip alone and its dialog names no roll options", async () => {
    withHand([ILLIAT]);
    results["combatCards:useCard"] = [resolved({ cardId: "book-of-illiat", useId: "arcane-barrage", roll: null })];
    render(<HandBody {...props()} />);
    const strip = screen.getByTestId("combat-hand-roll-options");
    fireEvent.click(within(strip).getByRole("button", { name: "More help dice" }));
    fireEvent.click(screen.getByRole("button", { name: "Use Book of Illiat" }));
    const dialog = screen.getByRole("dialog", { name: "Book of Illiat" });
    // Arcane Barrage deals damage with no roll.
    fireEvent.click(within(dialog).getByRole("button", { name: "Arcane Barrage" }));
    expect(within(dialog).queryByTestId("combat-card-roll-note")).toBeNull();
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Use Arcane Barrage" })));
    expect(useCalls()[0]!.args).not.toHaveProperty("roll");
    expect(within(strip).getByRole("group", { name: "Help dice" })).toHaveTextContent("1");
  });

  it("the GM's locked view has no strip", () => {
    withHand([BOLT]);
    render(<HandBody {...props({ gm: true, canPlay: false })} />);
    expect(screen.queryByTestId("combat-hand-roll-options")).toBeNull();
  });

  it("creatures picked in the dialog get target rings on the map; unpicking one drops its ring", () => {
    withHand([BOLT]);
    render(
      <ActionsProvider>
        <Rings />
        <HandBody {...props({ pickedEnemies: [] })} />
      </ActionsProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Use Bolt Beacon" }));
    const dialog = screen.getByRole("dialog", { name: "Bolt Beacon" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Archer" }));
    expect(screen.getByTestId("rings")).toHaveTextContent(ARCHER);
    // One target: picking the Bandit moves the ring.
    fireEvent.click(within(dialog).getByRole("button", { name: "Bandit" }));
    expect(screen.getByTestId("rings").textContent).toBe(BANDIT);
    fireEvent.click(within(dialog).getByRole("button", { name: "Bandit" }));
    expect(screen.getByTestId("rings").textContent).toBe("");
  });
});

const ASH_CH = "ch1" as Id<"characters">;
const MIRA_CH = "ch2" as Id<"characters">;

/** The player's page state with Ash's view (Mira's PC token next to Ash) and a token selected. */
function playerPanel(selected: Id<"combatTokens"> | null, onSelectToken = vi.fn()): ActionsPanelProps {
  const pc = (id: Id<"combatTokens">, name: string, characterId: Id<"characters">, mine: boolean) => ({ _id: id, name, characterId, mine, side: "pc", x: 0, y: 0, size: 1 });
  queries["combatVision:playerView"] = {
    state: "ok",
    mapId: "m1",
    characterId: ASH_CH,
    tokenId: ASH,
    pcs: [pc(ASH, "Ash", ASH_CH, true), pc(MIRA, "Mira", MIRA_CH, false)],
    others: [],
  };
  return {
    campaignId: "c1" as Id<"campaigns">,
    role: "player",
    mode: "play",
    map: { _id: "m1" as Id<"combatMaps">, name: "Map", live: true, source: "generated", w: 20, h: 20 } as ActionsPanelProps["map"],
    selectedTokenId: selected,
    onSelectToken,
    previewCharacterId: null,
    onPreview: vi.fn(),
  };
}

describe("F7-H4: another player's hand and the sharing switches", () => {
  it("selecting another player's token shows that hand read only: no Use, no Recall; 'Your hand' goes back", () => {
    withHand([BOLT], [AVA]);
    queries["combatCards:handSharing"] = { playersSeeHands: true, hidden: [] };
    const onSelect = vi.fn();
    render(<Hand {...playerPanel(MIRA, onSelect)} />);
    const hand = screen.getByRole("region", { name: "Hand of Mira" });
    expect(within(hand).getByRole("article", { name: "Bolt Beacon" })).toHaveAttribute("data-locked", "true");
    expect(within(hand).queryByRole("button", { name: /^Use/ })).toBeNull();
    expect(within(hand).queryByRole("button", { name: /^Recall/ })).toBeNull();
    expect(within(hand).getByText(/Read only: Mira’s player plays these cards/)).toBeInTheDocument();
    expect(within(hand).queryByRole("switch")).toBeNull();
    fireEvent.click(within(hand).getByRole("button", { name: "Your hand" }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("a hidden hand, or the GM's switch off, shows no cards and says why", () => {
    withHand([BOLT]);
    queries["combatCards:handSharing"] = { playersSeeHands: true, hidden: [MIRA_CH] };
    const { unmount } = render(<Hand {...playerPanel(MIRA)} />);
    expect(screen.queryByRole("article", { name: "Bolt Beacon" })).toBeNull();
    expect(screen.getByTestId("combat-hand-hidden")).toHaveTextContent("Mira’s player keeps their hand hidden.");
    unmount();
    queries["combatCards:handSharing"] = { playersSeeHands: false, hidden: [] };
    render(<Hand {...playerPanel(MIRA)} />);
    expect(screen.queryByRole("article", { name: "Bolt Beacon" })).toBeNull();
    expect(screen.getByTestId("combat-hand-hidden")).toHaveTextContent("The GM keeps every player’s cards private.");
  });

  it("the player's own hand (own token or nothing selected) has Use; the column's Hand card has the 'Hide my hand' switch", async () => {
    withHand([BOLT]);
    queries["combatCards:handSharing"] = { playersSeeHands: true, hidden: [] };
    render(
      <>
        <Hand {...playerPanel(ASH)} />
        <HandColumn {...playerPanel(ASH)} />
      </>,
    );
    const hand = screen.getByRole("region", { name: "Your hand" });
    expect(within(hand).getByRole("button", { name: "Use Bolt Beacon" })).toBeEnabled();
    expect(within(hand).queryByRole("switch")).toBeNull();
    const column = screen.getByRole("region", { name: "Hand" });
    expect(column).toHaveTextContent("Your cards lie along the bottom of the map.");
    const hide = within(column).getByRole("switch", { name: "Hide my hand from the other players" });
    expect(hide).not.toBeChecked();
    await act(async () => fireEvent.click(hide));
    expect(calls.find((c) => c.name === "combatCards:setHandHidden")?.args).toEqual({ campaignId: "c1", characterId: ASH_CH, hidden: true });
  });

  it("no 'Hide my hand' switch while the GM keeps hands private", () => {
    queries["combatCards:handSharing"] = { playersSeeHands: false, hidden: [] };
    render(<HideHandSwitch campaignId={"c1" as Id<"campaigns">} characterId={ASH_CH} />);
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("the GM's switch 'Players can see each other's cards' is on by default and calls setPlayersSeeHands", async () => {
    queries["combatCards:handSharing"] = { playersSeeHands: true, hidden: [] };
    render(<HandSharingSwitch campaignId={"c1" as Id<"campaigns">} />);
    const sw = screen.getByRole("switch", { name: "Players can see each other's cards" });
    expect(sw).toBeChecked();
    await act(async () => fireEvent.click(sw));
    expect(calls.find((c) => c.name === "campaigns:setPlayersSeeHands")?.args).toEqual({ campaignId: "c1", enabled: false });
  });
});

type Rect = { left: number; top: number; right: number; bottom: number };
const box = ({ left, top, right, bottom }: Rect) => ({ left, top, right, bottom, x: left, y: top, width: right - left, height: bottom - top, toJSON: () => ({}) }) as DOMRect;
/** The map's viewport is 800 x 600 at the origin; the hand's tray covers its bottom 150 px. */
const TABLE: Rect = { left: 0, top: 0, right: 800, bottom: 600 };
const TRAY: Rect = { left: 0, top: 450, right: 800, bottom: 600 };

/** Lays out the page for a drag: a map viewport (`.cm-vp`) and the tray's box, as getBoundingClientRect reports them. */
function layOut() {
  const vp = document.createElement("div");
  vp.className = "cm-vp";
  document.body.appendChild(vp);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function rect(this: HTMLElement) {
    if (this.classList.contains("cm-vp")) return box(TABLE);
    if (this.classList.contains("cmh-tray")) return box(TRAY);
    return box({ left: 0, top: 0, right: 0, bottom: 0 });
  });
  return () => vp.remove();
}

/** Drags the card named `name` from the fan (inside the tray) to `to`, as a mouse would. */
function drag(name: RegExp | string, to: { x: number; y: number }) {
  const slot = screen.getByRole("article", { name }).closest("li")!;
  fireEvent.pointerDown(slot, { pointerId: 1, button: 0, clientX: 400, clientY: 520 });
  fireEvent.pointerMove(slot, { pointerId: 1, clientX: to.x, clientY: to.y });
  fireEvent.pointerUp(slot, { pointerId: 1, clientX: to.x, clientY: to.y });
}

/** Stands in for the map: a click on the Bandit's token picks it (the vision layer calls toggleTarget). */
function MapClick({ tokenId }: { tokenId: Id<"combatTokens"> }) {
  const { toggleTarget } = useCombatTargets();
  return (
    <button type="button" onClick={() => toggleTarget(tokenId)}>
      Bandit on the map
    </button>
  );
}

describe("HF1: the fan along the bottom of the map", () => {
  let cleanUp = () => {};
  beforeAll(() => {
    // jsdom has no pointer capture.
    HTMLElement.prototype.setPointerCapture ??= () => {};
  });
  afterEach(() => {
    cleanUp();
    cleanUp = () => {};
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("model: a card let go on the table outside the tray plays; a one-enemy card with no enemy picked aims on the map", () => {
    expect(dropsOnTable({ x: 400, y: 200 }, TABLE, TRAY)).toBe(true);
    expect(dropsOnTable({ x: 400, y: 500 }, TABLE, TRAY)).toBe(false);
    expect(dropsOnTable({ x: 900, y: 200 }, TABLE, TRAY)).toBe(false);
    expect(dropsOnTable({ x: 400, y: 200 }, null, TRAY)).toBe(false);
    expect(dropsOnTable({ x: 400, y: 200 }, TABLE, null)).toBe(true);
    const bolt = formFor(use("bolt-beacon"));
    expect(aimsOnMap(bolt, { spells: 1, pickedEnemies: 0, gm: false })).toBe(true);
    // An enemy already picked: it fires at once instead; the GM picks in the dialog.
    expect(aimsOnMap(bolt, { spells: 1, pickedEnemies: 1, gm: false })).toBe(false);
    expect(aimsOnMap(bolt, { spells: 1, pickedEnemies: 0, gm: true })).toBe(false);
    // A grimoire (a spell to pick) or a card with other questions opens the dialog, as Use does.
    expect(aimsOnMap(formFor(use("book-of-illiat", "slumber")), { spells: 3, pickedEnemies: 0, gm: false })).toBe(false);
    expect(aimsOnMap(formFor(use("mending-touch")), { spells: 1, pickedEnemies: 0, gm: false })).toBe(false);
    // Nothing to target: it never waits.
    expect(aimsOnMap(formFor(use("deft-maneuvers")), { spells: 1, pickedEnemies: 0, gm: false })).toBe(false);
  });

  it("the loadout is a fan: each card turned 7° per step, a used card turned further", () => {
    withHand([BOLT, DEFT, ILLIAT]);
    render(<HandBody {...props()} />);
    const slots = [...screen.getByRole("list", { name: "Loadout" }).querySelectorAll<HTMLElement>(":scope > li")];
    expect(slots.map((li) => li.style.getPropertyValue("--rot"))).toEqual(["-7deg", "16deg", "7deg"]);
    expect(slots.map((li) => li.style.zIndex)).toEqual(["1", "2", "3"]);
  });

  it("dragging Bolt Beacon onto the table with the Bandit picked plays it the way Use does: one useCard, same request", async () => {
    cleanUp = layOut();
    withHand([BOLT]);
    results["combatCards:useCard"] = [resolved(), resolved()];
    render(<HandBody {...props()} />);
    expect(screen.getByRole("article", { name: "Bolt Beacon" }).closest("li")).toHaveAttribute("data-draggable", "true");
    await act(async () => drag("Bolt Beacon", { x: 400, y: 200 }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(useCalls()).toHaveLength(1);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Use Bolt Beacon" })));
    expect(useCalls()).toHaveLength(2);
    const [dragged, used] = useCalls().map((c) => ({ ...c.args, idempotencyKey: "fresh per click" }));
    expect(dragged).toEqual(used);
    expect(dragged).toMatchObject({ cardId: "bolt-beacon", spell: "main", targetTokenIds: [BANDIT], choices: [] });
    expect(screen.getByTestId("combat-card-verdict")).toHaveTextContent(/Bandit\s*Hit/);
  });

  it("let go over the tray or off the map, or only tapped, the card stays in the hand; a tap raises it (focus)", () => {
    cleanUp = layOut();
    withHand([BOLT]);
    render(<HandBody {...props()} />);
    drag("Bolt Beacon", { x: 400, y: 500 });
    drag("Bolt Beacon", { x: 900, y: 200 });
    expect(useCalls()).toHaveLength(0);
    const slot = screen.getByRole("article", { name: "Bolt Beacon" }).closest("li")!;
    fireEvent.pointerDown(slot, { pointerId: 2, button: 0, clientX: 400, clientY: 520 });
    fireEvent.pointerUp(slot, { pointerId: 2, clientX: 401, clientY: 521 });
    expect(slot).toHaveFocus();
    expect(useCalls()).toHaveLength(0);
  });

  it("dragged with no enemy picked, Bolt Beacon waits; the enemy then tapped on the map is its target, with the roll options", async () => {
    cleanUp = layOut();
    withHand([BOLT]);
    queries["characters:get"] = { sheet: SHEET };
    results["combatCards:useCard"] = [resolved()];
    render(
      <ActionsProvider>
        <MapClick tokenId={BANDIT} />
        <HandBody {...props({ pickedEnemies: [] })} />
      </ActionsProvider>,
    );
    act(() => drag("Bolt Beacon", { x: 400, y: 200 }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(useCalls()).toHaveLength(0);
    expect(screen.getByTestId("combat-hand-aim")).toHaveTextContent("Bolt Beacon: tap an enemy on the map to target it.");
    expect(screen.getByRole("article", { name: "Bolt Beacon" }).closest("li")).toHaveAttribute("data-aiming", "true");
    // Roll options set while it waits still apply.
    fireEvent.click(within(screen.getByTestId("combat-hand-roll-options")).getByRole("button", { name: "More advantage" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Bandit on the map" })));
    expect(useCalls()).toHaveLength(1);
    expect(useCalls()[0]!.args).toMatchObject({ cardId: "bolt-beacon", targetTokenIds: [BANDIT], choices: [], roll: { advantage: 1 } });
    expect(screen.queryByTestId("combat-hand-aim")).toBeNull();
  });

  it("a waiting card can be cancelled, or its target picked from a list instead", () => {
    cleanUp = layOut();
    withHand([BOLT]);
    render(
      <ActionsProvider>
        <MapClick tokenId={BANDIT} />
        <HandBody {...props({ pickedEnemies: [] })} />
      </ActionsProvider>,
    );
    act(() => drag("Bolt Beacon", { x: 400, y: 200 }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByTestId("combat-hand-aim")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Bandit on the map" }));
    expect(useCalls()).toHaveLength(0);
    act(() => drag("Bolt Beacon", { x: 400, y: 200 }));
    fireEvent.click(screen.getByRole("button", { name: "Pick from a list" }));
    expect(screen.getByRole("dialog", { name: "Bolt Beacon" })).toBeInTheDocument();
  });

  it("a used card, a card that can't be played and the GM's locked view don't drag", () => {
    cleanUp = layOut();
    withHand([BOLT, DEFT, BONES]);
    const { unmount } = render(<HandBody {...props()} />);
    expect(screen.getByRole("article", { name: /^Deft Maneuvers, used/ }).closest("li")).not.toHaveAttribute("data-draggable");
    expect(screen.getByRole("article", { name: "Bare Bones" }).closest("li")).not.toHaveAttribute("data-draggable");
    drag(/^Deft Maneuvers, used/, { x: 400, y: 200 });
    drag("Bare Bones", { x: 400, y: 200 });
    expect(useCalls()).toHaveLength(0);
    unmount();
    render(<HandBody {...props({ gm: true, canPlay: false, pickedEnemies: [] })} />);
    expect(document.querySelectorAll("[data-draggable]")).toHaveLength(0);
    drag("Bolt Beacon", { x: 400, y: 200 });
    expect(useCalls()).toHaveLength(0);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("another player's hand is a read-only fan: nothing drags", () => {
    cleanUp = layOut();
    withHand([BOLT]);
    queries["combatCards:handSharing"] = { playersSeeHands: true, hidden: [] };
    render(<Hand {...playerPanel(MIRA)} />);
    const hand = screen.getByRole("region", { name: "Hand of Mira" });
    expect(within(hand).getByRole("list", { name: "Loadout" })).toBeInTheDocument();
    expect(hand.querySelectorAll("[data-draggable]")).toHaveLength(0);
    drag("Bolt Beacon", { x: 400, y: 200 });
    expect(useCalls()).toHaveLength(0);
  });

  it("the GM's dragged card asks its target in the dialog (GM map clicks select tokens)", () => {
    cleanUp = layOut();
    withHand([BOLT]);
    render(
      <ActionsProvider>
        <HandBody {...props({ gm: true, pickedEnemies: [] })} />
      </ActionsProvider>,
    );
    act(() => drag("Bolt Beacon", { x: 400, y: 200 }));
    expect(screen.queryByTestId("combat-hand-aim")).toBeNull();
    expect(screen.getByRole("dialog", { name: "Bolt Beacon" })).toBeInTheDocument();
  });

  it("'Hide cards' leaves the peek tab 'Show cards (N)', remembered per campaign and character; Show brings the fan back", () => {
    withHand([BOLT, DEFT]);
    const { unmount } = render(<HandBody {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: "Hide cards" }));
    expect(screen.getByRole("button", { name: "Show cards (2)" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "Use Bolt Beacon" })).toBeNull();
    expect(screen.queryByTestId("combat-hand-roll-options")).toBeNull();
    expect(window.localStorage.getItem(handHiddenKey("c1" as Id<"campaigns">, "ch1" as Id<"characters">))).toBe("1");
    unmount();
    // The next visit to this campaign's map, in this browser, starts hidden; another character's hand does not.
    const again = render(<HandBody {...props()} />);
    expect(screen.getByRole("button", { name: "Show cards (2)" })).toBeInTheDocument();
    again.unmount();
    render(<HandBody {...props({ characterId: "ch9" as Id<"characters"> })} />);
    expect(screen.getByRole("button", { name: "Hide cards" })).toHaveAttribute("aria-expanded", "true");
  });

  it("without storage (a private window) the hand renders shown and Hide still works for the visit", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    withHand([BOLT]);
    render(<HandBody {...props()} />);
    expect(screen.getByRole("button", { name: "Use Bolt Beacon" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hide cards" }));
    expect(screen.getByRole("button", { name: "Show cards (1)" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show cards (1)" }));
    expect(screen.getByRole("button", { name: "Use Bolt Beacon" })).toBeInTheDocument();
  });

  it("on the Combat Map page the hand docks into the map board; elsewhere it renders in place", () => {
    withHand([BOLT]);
    queries["combatCards:handSharing"] = { playersSeeHands: true, hidden: [] };
    const main = document.createElement("main");
    main.className = "cm-main";
    main.innerHTML = '<aside class="cm-aside"></aside><div class="cm-area"><section class="cm-board" aria-label="Battle map"></section></div>';
    document.body.appendChild(main);
    try {
      render(<Hand {...playerPanel(ASH)} />, { container: main.querySelector("aside")! });
      const board = screen.getByRole("region", { name: "Battle map" });
      expect(within(board).getByRole("region", { name: "Your hand" })).toBeInTheDocument();
      expect(main.querySelector("aside .cmh-hand")).toBeNull();
    } finally {
      main.remove();
    }
  });
});

describe("the card result", () => {
  it("shows the player's dice and verdicts, manual steps with Done, and never an enemy's numbers", () => {
    const onDone = vi.fn();
    const last = {
      kind: "resolved" as const,
      cardName: "Cinder Grasp",
      names: new Map([[BANDIT as string, "Bandit"]]),
      done: [],
      result: resolved({ prompts: [{ kind: "manual", text: "They are On Fire.", tokenIds: [] }, { kind: "move", text: "Move them within Close range.", tokenIds: [] }] }),
    };
    const { rerender } = render(<CardResult last={last} onDone={onDone} />);
    const prompts = screen.getAllByTestId("combat-card-prompt");
    expect(prompts).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Done: They are On Fire." }));
    expect(onDone).toHaveBeenCalledWith(0);
    rerender(<CardResult last={{ ...last, done: [0] }} onDone={onDone} />);
    expect(screen.getAllByTestId("combat-card-prompt")).toHaveLength(1);
    expect(screen.getByRole("region", { name: "Card result" })).not.toHaveTextContent(/\b(HP|Stress|Difficulty|threshold)\b/);
  });
});

describe("panel memory across the 760 px layout switch (user answer 2026-10-22)", () => {
  function Result({ label }: { label: string }) {
    const [last, setLast] = usePanelMemory<string | null>("attack:ch1", null);
    return (
      <div data-testid={label}>
        <span>{last ?? "none"}</span>
        <button type="button" onClick={() => setLast("Bandit: Hit")}>
          Attack
        </button>
      </div>
    );
  }
  function Panel() {
    const [phone, setPhone] = useState(false);
    return (
      <PanelMemoryProvider>
        <button type="button" onClick={() => setPhone((p) => !p)}>
          Resize
        </button>
        {phone ? <Result label="sheet" /> : <Result label="cards" />}
      </PanelMemoryProvider>
    );
  }

  it("keeps the last result when the desktop cards turn into the bottom sheet and back", () => {
    render(<Panel />);
    fireEvent.click(within(screen.getByTestId("cards")).getByRole("button", { name: "Attack" }));
    expect(screen.getByTestId("cards")).toHaveTextContent("Bandit: Hit");
    fireEvent.click(screen.getByRole("button", { name: "Resize" }));
    expect(screen.getByTestId("sheet")).toHaveTextContent("Bandit: Hit");
    fireEvent.click(screen.getByRole("button", { name: "Resize" }));
    expect(screen.getByTestId("cards")).toHaveTextContent("Bandit: Hit");
  });

  it("without a provider the value stays in the component (the GM column)", () => {
    render(<Result label="alone" />);
    fireEvent.click(screen.getByRole("button", { name: "Attack" }));
    expect(screen.getByTestId("alone")).toHaveTextContent("Bandit: Hit");
  });
});
