/**
 * The Hand on the Combat Map (plan combat-actions CA6): what a card use asks first (the dialog only when the card needs
 * a choice), the choices list sent to combatCards.useCard, badges and recall labels; the Hand itself with Convex mocked:
 * Use on combat cards (once per click, picked targets), no button on passive cards, exhausted cards greyed with their
 * reset label, Recall from the vault (free during an open rest), the GM's locked view, the after-the-roll choice
 * resubmitted; the result view (U1); and the panel memory that keeps results across the 760 px layout switch.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { PanelMemoryProvider, usePanelMemory } from "@/components/combat-map/actions/attack/memory";
import { HandBody, type BodyProps } from "@/components/combat-map/actions/hand";
import {
  answerChoices,
  cardBadges,
  choicesOf,
  formFor,
  formProblem,
  initialValues,
  needsDialog,
  playableUses,
  recallLabel,
  type HandCard,
  type ResolvedUse,
} from "@/components/combat-map/actions/hand/model";
import { CardResult } from "@/components/combat-map/actions/hand/result";
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
  it("Bolt Beacon fires at once with an enemy picked on the map; without one the dialog asks for the target", () => {
    const form = formFor(use("bolt-beacon"));
    expect(form.targets).toEqual({ side: "enemy", max: 1, range: "far" });
    expect(needsDialog(form, { spells: 1, pickedEnemies: 1, gm: false })).toBe(false);
    expect(needsDialog(form, { spells: 1, pickedEnemies: 0, gm: false })).toBe(true);
    expect(choicesOf(form, initialValues(form, [BANDIT]))).toEqual([]);
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
    const vault = screen.getByRole("list", { name: "Vault" });
    expect(within(vault).getByRole("button", { name: "Recall: 2 Stress, Book of Ava" })).toBeEnabled();
  });

  it("Use on Bolt Beacon with the Bandit picked fires useCard once, with no dialog, and shows Hit", async () => {
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
