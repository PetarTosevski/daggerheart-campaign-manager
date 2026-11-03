/**
 * The Hand's model on the Combat Map (plan combat-actions CA6): what a card use asks first (the dialog only when the
 * card needs a choice), the choices list sent to combatCards.useCard, badges and recall labels, the roll options sent
 * with a rolling card (F8-I1), where a dragged card lands and when it aims on the map (HF1), and which creatures are out
 * of the card's range (DA6); the card result (U1); and the GM's switch "Players can see each other's cards" (F7-H4).
 *
 * Plan combat-hud H8.1 deleted the classic Hand (column card, docked fan, Use dialog, GM hand, panel memory). The HUD
 * covers what their tests checked: tests/unit/hud/hand-states.test.tsx and tests/e2e/hud-hand.spec.ts (fan states, Hide
 * cards, Roll options, Use, vault recall, the GM's lock and another player's read-only hand), tests/unit/hud/
 * card-pick.test.tsx and tests/e2e/hud-card-pick.spec.ts (the card picker: rule, rows, riders, out of range, squares),
 * tests/unit/hud/sheet-panel.test.tsx ("Hide my hand") and tests/e2e/hud-gm-playfor.spec.ts (the GM's Play-for).
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HandSharingSwitch } from "@/components/combat-map/settings/hand-sharing";
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
  outOfRange,
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

describe("F7-H4: the GM's sharing switch", () => {
  it("the GM's switch 'Players can see each other's cards' is on by default and calls setPlayersSeeHands", async () => {
    queries["combatCardsReads:handSharing"] = { playersSeeHands: true, hidden: [] };
    render(<HandSharingSwitch campaignId={"c1" as Id<"campaigns">} />);
    const sw = screen.getByRole("switch", { name: "Players can see each other's cards" });
    expect(sw).toBeChecked();
    await act(async () => fireEvent.click(sw));
    expect(calls.find((c) => c.name === "campaigns:setPlayersSeeHands")?.args).toEqual({ campaignId: "c1", enabled: false });
  });
});

type Rect = { left: number; top: number; right: number; bottom: number };
/** The map's viewport is 800 x 600 at the origin; the hand's tray covers its bottom 150 px. */
const TABLE: Rect = { left: 0, top: 0, right: 800, bottom: 600 };
const TRAY: Rect = { left: 0, top: 450, right: 800, bottom: 600 };

describe("HF1: where a dragged card lands", () => {
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

// ---------------------------------------------------------------- DA6 (plan drawer-answers, user answers 2026-10-30)

type PlacedCreature = { tokenId: Id<"combatTokens">; name: string; side: "self" | "pc" | "enemy"; at?: { x: number; y: number; size: number } };
const SELF_AT: PlacedCreature = { tokenId: ASH, name: "You", side: "self", at: { x: 5, y: 5, size: 1 } };
const MIRA_AT: PlacedCreature = { tokenId: MIRA, name: "Mira", side: "pc", at: { x: 5, y: 6, size: 1 } };
const BANDIT_AT: PlacedCreature = { tokenId: BANDIT, name: "Bandit", side: "enemy", at: { x: 6, y: 5, size: 1 } };
const ARCHER_AT: PlacedCreature = { tokenId: ARCHER, name: "Archer", side: "enemy", at: { x: 13, y: 5, size: 1 } };
/** Ash at (5,5); Mira and the Bandit next to Ash (Melee); the Archer 8 squares away (Far). */
const PLACED: PlacedCreature[] = [SELF_AT, MIRA_AT, BANDIT_AT, ARCHER_AT];

describe("DA6: out-of-range creatures", () => {
  it("outOfRange mirrors the server: from the actor, around yourself with areaRange, around a target from the first target", () => {
    const melee = { side: "enemy" as const, max: 3, range: "melee" };
    expect(outOfRange(melee, PLACED, [], BANDIT_AT)).toBe(false);
    expect(outOfRange(melee, PLACED, [], ARCHER_AT)).toBe(true);
    // The actor and creatures without a known position are never greyed; "weapon" and "unlimited" neither.
    expect(outOfRange(melee, PLACED, [], SELF_AT)).toBe(false);
    expect(outOfRange(melee, PLACED, [], { ...ARCHER_AT, at: undefined })).toBe(false);
    expect(outOfRange({ ...melee, range: "weapon" }, PLACED, [], ARCHER_AT)).toBe(false);
    expect(outOfRange({ ...melee, range: "unlimited" }, PLACED, [], ARCHER_AT)).toBe(false);
    // Far reaches 8 squares.
    expect(outOfRange({ ...melee, range: "far" }, PLACED, [], ARCHER_AT)).toBe(false);
    // Around yourself: the area's radius.
    expect(outOfRange({ ...melee, range: "far", area: "aroundSelf", areaRange: "veryClose" }, PLACED, [], ARCHER_AT)).toBe(true);
    // Around a target: the first target from the actor, the others from the first target.
    const fireball = { side: "any" as const, max: null, range: "far", area: "aroundTarget" as const, areaRange: "veryClose" as const };
    expect(outOfRange(fireball, PLACED, [], ARCHER_AT)).toBe(false);
    expect(outOfRange(fireball, PLACED, [ARCHER], MIRA_AT)).toBe(true);
    expect(outOfRange(fireball, PLACED, [BANDIT], MIRA_AT)).toBe(false);
  });
});
