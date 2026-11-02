/**
 * The HUD's weapon attack picker (plan combat-hud H3.2; boards CmpPicking 'Weapon attack', CmpPromptsPlayer 'With this
 * attack', 'Forced attack', 'Lead by Example', 'Your hit can defeat 2 more Minions'): the pure model (labels, costs,
 * blocked reasons, the attack's arguments, extra targets, forced rows, Minion picks) and the panel through H3.0's
 * pick session (weapon tiles, roll chips, riders with cost pills, one primary, the result line, a forced attack locked,
 * Lead by Example, the Minion pick and Skip). Convex is mocked.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { vi } from "vitest";

import { HudPick, HudPickLayer, PickProvider } from "@/components/combat-map/hud/pick";
import {
  attackArgs,
  attackBlocked,
  attackLabel,
  attackReports,
  attackRule,
  costOf,
  forcedRows,
  HudAttack,
  initialData,
  minionPicks,
  mostTargets,
  payLine,
  reportOf,
  type AttackData,
  type AttackInput,
} from "@/components/combat-map/hud/pick-attack";
import { HudProvider } from "@/components/combat-map/hud/state";
import type { CombatPageState, MapLayerProps } from "@/components/combat-map/slots";
import type { RiderOption } from "@/components/combat-map/actions/attack/riders";
import { WEAPONS } from "@/lib/srd/equipment";

import type { Id } from "../../../convex/_generated/dataModel";

const queries: Record<string, unknown> = {};
const calls: { name: string; args: Record<string, unknown> }[] = [];
const results: Record<string, unknown> = {};
const functionName = (ref: unknown) => String((ref as Record<symbol, unknown>)[Symbol.for("functionName")] ?? ref);

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown, args: unknown) => {
    if (args === "skip") return undefined;
    const name = functionName(ref);
    const v = queries[name];
    // riders per slot: `combatActions:riders` holds { primary, secondary }.
    if (name === "combatActions:riders" && v && typeof v === "object" && !Array.isArray(v)) return (v as Record<string, unknown>)[(args as { slot: string }).slot] ?? [];
    return v;
  },
  useMutation: (ref: unknown) => {
    const name = functionName(ref);
    const run = async (args: Record<string, unknown>) => {
      calls.push({ name, args });
      return results[name];
    };
    return Object.assign(run, { withOptimisticUpdate: () => run });
  },
}));

afterEach(() => {
  for (const k of Object.keys(queries)) delete queries[k];
  for (const k of Object.keys(results)) delete results[k];
  calls.length = 0;
  attackReports.set(null);
});

const CAMPAIGN = "c1" as Id<"campaigns">;
const MAP = "map1" as Id<"combatMaps">;
const CHARACTER = "mossc" as Id<"characters">;
const tok = (s: string) => s as Id<"combatTokens">;
const MOSS = tok("moss");
const ORIEL = tok("oriel");
const LT = tok("lt");
const BANDIT = tok("bandit");
const SNIPER = tok("sniper");

const state = { campaignId: CAMPAIGN, role: "player", mode: "play", map: { _id: MAP, name: "Forest Camp", live: true }, selectedTokenId: null, onSelectToken: () => {}, previewCharacterId: null, onPreview: () => {} } as unknown as CombatPageState;
const layer = { ...state, viewport: { cell: 40, zoom: 1, w: 30, h: 20, pad: 0, toSquares: () => ({ x: 0, y: 0 }), showNames: false } } as unknown as MapLayerProps;

const SHEET = {
  name: "Moss",
  classId: "druid",
  subclassId: "warden-of-the-elements",
  subclassRank: "foundation",
  level: 1,
  ancestry: { kind: "single", id: "human" },
  communityId: "wildborne",
  traits: { agility: 0, strength: 1, finesse: 0, instinct: 2, presence: 0, knowledge: -1 },
  experiences: [
    { id: "x1", name: "Forest Guide", value: 2 },
    { id: "x2", name: "Herbalist", value: 1 },
  ],
  hope: 1,
  proficiency: 1,
  primaryWeaponId: "shortstaff",
  secondaryWeaponId: "round-shield",
  domainCards: { loadout: [], vault: [] },
  effects: [],
  classState: {},
};

const RIDER: RiderOption = {
  source: "card",
  id: "marked-for-death",
  useId: "u1",
  name: "Marked for Death",
  phase: "before",
  when: "Before the roll",
  ready: true,
  resetLabel: null,
  costs: ["1 Stress"],
  limit: null,
  numbers: [],
  options: [],
  situations: [],
  addTargets: null,
};

function seed() {
  queries["combatVision:playerView"] = {
    state: "ok",
    mapId: MAP,
    characterId: CHARACTER,
    tokenId: MOSS,
    pcs: [
      { _id: MOSS, name: "Moss", x: 5, y: 10, size: 1, stats: { conditions: [] } },
      { _id: ORIEL, name: "Oriel", x: 6, y: 13, size: 1, stats: { conditions: [] } },
    ],
    others: [
      { _id: LT, name: "Lieutenant", side: "enemy", x: 14, y: 10, size: 1, face: 0, revealed: false },
      { _id: BANDIT, name: "Bandit", side: "enemy", x: 6, y: 10, size: 1, face: 0, revealed: false },
      { _id: SNIPER, name: "Sniper", side: "enemy", x: 24, y: 14, size: 1, face: 0, revealed: false },
    ],
  };
  queries["combatActions:targets"] = [
    { tokenId: LT, band: "far", inRange: false, lineOfSight: true, cover: false },
    { tokenId: BANDIT, band: "melee", inRange: true, lineOfSight: true, cover: false },
    { tokenId: SNIPER, band: "veryFar", inRange: false, lineOfSight: true, cover: false },
  ];
  queries["characters:get"] = { sheet: SHEET };
  queries["combatActions:riders"] = { primary: [RIDER], secondary: [] };
  queries["combatRequests:forcedAttacks"] = [];
  queries["combatRequests:mine"] = [];
}

function renderHud() {
  return render(
    <HudProvider>
      <PickProvider>
        <div className="hud-map">
          <HudPickLayer {...layer} />
        </div>
        <HudPick state={state} />
        <HudAttack state={state} />
      </PickProvider>
    </HudProvider>,
  );
}

const weapon = (id: string) => WEAPONS.find((w) => w.id === id)!;

function input(over: Partial<AttackInput> = {}): AttackInput {
  return {
    characterId: CHARACTER,
    weapons: [
      { slot: "primary", weapon: weapon("shortstaff") },
      { slot: "secondary", weapon: weapon("round-shield") },
    ],
    proficiency: 1,
    roller: { experiences: SHEET.experiences, hope: 1 },
    riders: { primary: [RIDER], secondary: [] },
    traitPick: {},
    traitDefault: { primary: "instinct", secondary: "strength" },
    traitValues: SHEET.traits,
    spirit: {},
    extraTargets: 0,
    hints: [],
    forced: null,
    forcedRows: null,
    picked: [],
    attack: async () => ({ status: "awaiting" }),
    onReport: () => {},
    render: () => null,
    ...over,
  };
}
const data = (over: Partial<AttackData> = {}): AttackData => ({ ...initialData(input()), ...over });

describe("the attack picker's model", () => {
  it("names the action: 'Attack the Bandit with Shortstaff', PCs without 'the', none picked", () => {
    expect(attackLabel("Shortstaff", [{ name: "Bandit", side: "enemy" }])).toBe("Attack the Bandit with Shortstaff");
    expect(attackLabel("Shortstaff", [{ name: "Oriel", side: "pc" }])).toBe("Attack Oriel with Shortstaff");
    expect(attackLabel("Shortstaff", [])).toBe("Attack with Shortstaff");
    expect(attackLabel("Shortstaff", [{ name: "Bandit", side: "enemy" }, { name: "Sniper", side: "enemy" }])).toBe("Attack the Bandit and the Sniper with Shortstaff");
  });

  it("reads cost badges as pills and sums the footer: riders and Experiences", () => {
    expect(costOf("1 Stress")).toEqual({ amount: 1, resource: "stress" });
    expect(costOf("3 Hope")).toEqual({ amount: 3, resource: "hope" });
    expect(costOf("2 handfuls of gold")).toBeNull();
    expect(payLine([RIDER], data())).toBeNull();
    const d = data({ roll: { experienceIds: ["x1"], edge: 0, help: 0 }, riders: { "card|marked-for-death|u1": { on: true, numbers: {}, options: {}, situations: [], extra: [] } } });
    expect(payLine([RIDER], d)).toBe("With 1 rider · Spends 1 Hope, 1 Stress");
  });

  it("blocks the primary (CmpBlocked layer 1): Hope short, an unanswered rider option, no weapon", () => {
    expect(attackBlocked(input(), [RIDER], data({ roll: { experienceIds: ["x1", "x2"], edge: 0, help: 0 } }))).toBe("Needs 2 Hope · you have 1");
    const kick: RiderOption = { ...RIDER, id: "kick", name: "Kick", options: [{ id: "o", label: "Knock back or damage", options: [{ id: "a", label: "Knock back" }] }] };
    expect(attackBlocked(input(), [kick], data({ riders: { "card|kick|u1": { on: true, numbers: {}, options: {}, situations: [], extra: [] } } }))).toBe("Kick: Knock back or damage");
    expect(attackBlocked(input({ weapons: [] }), [], data())).toBe("No weapon equipped");
  });

  it("builds combatActions.attack's arguments: disadvantage, trait only when offered, riders, Lead by Example's first option", () => {
    const hints = [{ tokenId: BANDIT, band: "melee" as const, inRange: true, lineOfSight: true, cover: false, benefits: [{ label: "Lead by Example", options: [{ id: "stress", label: "Clear a Stress" }, { id: "hope", label: "Gain a Hope" }] }] }];
    const d = data({ roll: { experienceIds: ["x1"], edge: -2, help: 1 }, trait: "agility", riders: { "card|marked-for-death|u1": { on: true, numbers: {}, options: {}, situations: [], extra: [] } } });
    const args = attackArgs(input({ hints }), d, { targetIds: [BANDIT] });
    expect(args).toMatchObject({ targetTokenIds: [BANDIT], slot: "primary", experienceIds: ["x1"], advantage: 0, disadvantage: 2, help: 1, benefit: "stress" });
    expect(args.riders).toEqual([{ source: "card", id: "marked-for-death", useId: "u1", choices: [] }]);
    expect(args).not.toHaveProperty("trait");
    expect(attackArgs(input({ hints, traitPick: { primary: true } }), { ...d, benefit: "hope" }, { targetIds: [BANDIT] })).toMatchObject({ trait: "agility", benefit: "hope" });
    expect(attackArgs(input({ hints }), d, { targetIds: [LT] })).not.toHaveProperty("benefit");
  });

  it("takes extra targets (dcm-y3e, Parallela) and Spirit Weapon's one more; a forced attack is locked", () => {
    expect(mostTargets(input(), data())).toBe(1);
    expect(attackRule(input({ extraTargets: 1 }), data()).max).toBe(2);
    expect(mostTargets(input({ extraTargets: 1, spirit: { primary: true } }), data({ spirit: true }))).toBe(3);
    const forced = { requestId: "r1" as Id<"combatRequests">, instanceLabel: "Gobstalker", feature: "Beguile", targets: [{ tokenId: ORIEL, name: "Oriel" }] };
    expect(attackRule(input({ forced }), data())).toMatchObject({ locked: true, max: 1, min: 1, text: "Gobstalker’s Beguile: the target is locked" });
    const bands = new Map([[ORIEL as string, { band: "veryClose" as const, side: "pc" as const }]]);
    expect(forcedRows(forced, bands)).toEqual([{ tokenId: ORIEL, name: "Oriel", side: "pc", band: "veryClose", reach: "in" }]);
    expect(attackArgs(input({ forced }), data(), { targetIds: [ORIEL] }).forcedRequestId).toBe("r1");
  });

  it("reports Hit / Miss / Defeated by name and the player's own damage; pending shows nothing here", () => {
    const names = new Map([[BANDIT as string, "Bandit"]]);
    expect(reportOf(CHARACTER, "Shortstaff", { status: "resolved", damage: { total: 9 }, targets: [{ tokenId: BANDIT, hit: true, defeated: false }] }, names)).toMatchObject({ verdicts: [{ name: "Bandit", verdict: "Hit" }], damage: 9 });
    expect(reportOf(CHARACTER, "Shortstaff", { status: "pending", requestId: "r" as Id<"combatRequests"> }, names)).toBeNull();
    expect(reportOf(CHARACTER, "Shortstaff", { status: "awaiting" }, names)?.note).toMatch(/Map tools/);
  });

  it("sends each picked Minion token as many times as its count, within what it holds", () => {
    const offer = {
      requestId: "m" as Id<"combatRequests">,
      entryId: "e" as Id<"actionLog">,
      extra: 2,
      candidates: [
        { instanceId: "i1" as Id<"encounterAdversaries">, tokenId: tok("a"), name: "Lackey A", available: 1 },
        { instanceId: "i2" as Id<"encounterAdversaries">, tokenId: tok("b"), name: "Lackeys", available: 3 },
      ],
    };
    expect(minionPicks(offer, [tok("a")], { counts: {} })).toEqual(["i1"]);
    expect(minionPicks(offer, [tok("a"), tok("b")], { counts: { i2: 2 } })).toEqual(["i1", "i2", "i2"]);
  });
});

describe("the attack picker in the HUD", () => {
  it("weapon tiles, roll chips, riders with cost pills, one primary; the send and the result line", async () => {
    seed();
    results["combatActions:attack"] = { status: "resolved", damage: { total: 9 }, targets: [{ tokenId: BANDIT, hit: true, defeated: false }] };
    renderHud();
    fireEvent.click(screen.getByTestId("hud-attack-open"));
    const panel = screen.getByRole("dialog", { name: "Shortstaff" });
    const tiles = within(panel).getAllByTestId("hud-attack-weapon");
    expect(tiles.map((t) => t.textContent)).toEqual(["ShortstaffInstinct · Close · 1d8+1 mag", "Round ShieldStrength · Melee · 1d4 phy"]);
    expect(tiles[0]).toHaveAttribute("aria-pressed", "true");
    expect(within(panel).getByTestId("hud-pick-go")).toHaveTextContent("Attack with Shortstaff");

    fireEvent.click(within(panel).getAllByTestId("hud-pick-row").find((r) => r.dataset.token === BANDIT)!);
    expect(within(panel).getByTestId("hud-pick-go")).toHaveTextContent("Attack the Bandit with Shortstaff");

    fireEvent.click(within(panel).getByRole("button", { name: /Forest Guide \+2/ }));
    fireEvent.click(within(panel).getByRole("switch", { name: /Marked for Death/ }));
    expect(within(panel).getByTestId("hud-pick-pay")).toHaveTextContent("With 1 rider · Spends 1 Hope, 1 Stress");
    fireEvent.click(within(panel).getByRole("button", { name: "More Advantage" }));

    await act(async () => fireEvent.click(within(panel).getByTestId("hud-pick-go")));
    const sent = calls.find((c) => c.name === "combatActions:attack")!.args;
    expect(sent).toMatchObject({ campaignId: CAMPAIGN, characterId: CHARACTER, mapId: MAP, slot: "primary", targetTokenIds: [BANDIT], experienceIds: ["x1"], advantage: 1, disadvantage: 0, modifier: 0, options: [] });
    expect(sent.riders).toEqual([{ source: "card", id: "marked-for-death", useId: "u1", choices: [] }]);
    expect(screen.queryByTestId("hud-pick")).toBeNull();
    expect(screen.getByTestId("hud-attack-result")).toHaveTextContent("Bandit: Hit · your damage 9");
    expect(screen.getByTestId("hud-attack-result").textContent).not.toMatch(/HP|Difficulty/);
  });

  it("switching to the off-hand weapon changes the header, the rule's slot and the riders", () => {
    seed();
    renderHud();
    fireEvent.click(screen.getByTestId("hud-attack-open"));
    fireEvent.click(screen.getAllByTestId("hud-attack-weapon")[1]!);
    const panel = screen.getByRole("dialog", { name: "Round Shield" });
    expect(within(panel).getAllByTestId("hud-attack-weapon")[1]).toHaveAttribute("aria-pressed", "true");
    expect(within(panel).queryByTestId("hud-attack-riders")).toBeNull();
    expect(within(panel).getByTestId("hud-pick-go")).toHaveTextContent("Attack with Round Shield");
  });

  it("out of range: the send goes to the GM (pending) and the panel closes without a result", async () => {
    seed();
    results["combatActions:attack"] = { status: "pending", requestId: "req1", outOfRange: [{ tokenId: SNIPER, band: "veryFar" }] };
    renderHud();
    fireEvent.click(screen.getByTestId("hud-attack-open"));
    const panel = screen.getByRole("dialog", { name: "Shortstaff" });
    fireEvent.click(within(panel).getAllByTestId("hud-pick-row").find((r) => r.dataset.token === SNIPER)!);
    expect(within(panel).getByTestId("hud-pick-pay")).toHaveTextContent("the GM approves first");
    await act(async () => fireEvent.click(within(panel).getByTestId("hud-pick-go")));
    expect(screen.queryByTestId("hud-pick")).toBeNull();
    expect(screen.queryByTestId("hud-attack-result")).toBeNull();
  });

  it("a forced attack: the card names the target, the panel locks it, the send answers the request", async () => {
    seed();
    queries["combatRequests:forcedAttacks"] = [{ requestId: "f1", characterId: CHARACTER, characterName: "Moss", createdAt: 1, instanceLabel: "Gobstalker", feature: "Beguile", targets: [{ tokenId: ORIEL, name: "Oriel" }] }];
    results["combatActions:attack"] = { status: "resolved", damage: null, targets: [{ tokenId: ORIEL, hit: false, defeated: false }] };
    renderHud();
    const card = screen.getByTestId("hud-attack-forced");
    expect(card).toHaveTextContent("Forced attack");
    expect(card).toHaveTextContent("Beguile · you must attack");
    expect(card).toHaveTextContent("Target: Oriel");
    fireEvent.click(within(card).getByRole("button", { name: "Attack Oriel" }));
    const panel = screen.getByRole("dialog", { name: "Shortstaff" });
    expect(within(panel).getByTestId("hud-pick-rule")).toHaveTextContent("Gobstalker’s Beguile: the target is locked");
    const rows = within(panel).getAllByTestId("hud-pick-row");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(rows[0]!);
    expect(rows[0]).toHaveAttribute("aria-pressed", "true");
    expect(within(panel).getByTestId("hud-pick-go")).toHaveTextContent("Attack Oriel with Shortstaff");
    await act(async () => fireEvent.click(within(panel).getByTestId("hud-pick-go")));
    expect(calls.find((c) => c.name === "combatActions:attack")!.args).toMatchObject({ forcedRequestId: "f1", targetTokenIds: [ORIEL] });
    expect(screen.getByTestId("hud-attack-result")).toHaveTextContent("Oriel: Miss");
  });

  it("Lead by Example: the picked target's benefit is a radio row before the roll", async () => {
    seed();
    queries["combatActions:targets"] = [
      { tokenId: BANDIT, band: "melee", inRange: true, lineOfSight: true, cover: false, benefits: [{ label: "Lead by Example", options: [{ id: "stress", label: "Clear a Stress" }, { id: "hope", label: "Gain a Hope" }] }] },
    ];
    results["combatActions:attack"] = { status: "awaiting" };
    renderHud();
    fireEvent.click(screen.getByTestId("hud-attack-open"));
    const panel = screen.getByRole("dialog", { name: "Shortstaff" });
    expect(within(panel).queryByTestId("hud-attack-benefit")).toBeNull();
    fireEvent.click(within(panel).getAllByTestId("hud-pick-row").find((r) => r.dataset.token === BANDIT)!);
    const lbe = within(panel).getByTestId("hud-attack-benefit");
    expect(within(lbe).getByRole("radio", { name: "Clear a Stress" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(within(lbe).getByRole("radio", { name: "Gain a Hope" }));
    await act(async () => fireEvent.click(within(panel).getByTestId("hud-pick-go")));
    expect(calls.find((c) => c.name === "combatActions:attack")!.args).toMatchObject({ benefit: "hope" });
    expect(screen.getByTestId("hud-attack-result")).toHaveTextContent("Your roll waits");
  });

  it("the Minion offer: Pick Minions opens the rows, 'Defeat 2' sends them; Skip sends none", async () => {
    seed();
    const offer = {
      kind: "minionOffer",
      requestId: "m1",
      characterId: CHARACTER,
      characterName: "Moss",
      createdAt: 1,
      entryId: "e1",
      extra: 2,
      candidates: [
        { instanceId: "i1", tokenId: LT, name: "Lackey A", available: 1 },
        { instanceId: "i2", tokenId: SNIPER, name: "Lackey B", available: 1 },
      ],
    };
    queries["combatRequests:mine"] = [offer];
    renderHud();
    const card = screen.getByTestId("hud-attack-minions");
    expect(card).toHaveTextContent("Your hit can defeat 2 more Minions");
    fireEvent.click(within(card).getByRole("button", { name: "Pick Minions" }));
    const panel = screen.getByTestId("hud-pick");
    expect(panel).toHaveAccessibleName("Your hit can defeat 2 more Minions");
    for (const r of within(panel).getAllByTestId("hud-pick-row")) fireEvent.click(r);
    expect(within(panel).getByTestId("hud-pick-go")).toHaveTextContent("Defeat 2");
    await act(async () => fireEvent.click(within(panel).getByTestId("hud-pick-go")));
    expect(calls.find((c) => c.name === "combatActions:pickMinions")!.args).toMatchObject({ entryId: "e1", instanceIds: ["i1", "i2"] });

    calls.length = 0;
    await act(async () => fireEvent.click(within(screen.getByTestId("hud-attack-minions")).getByRole("button", { name: "Skip" })));
    expect(calls.find((c) => c.name === "combatActions:pickMinions")!.args).toMatchObject({ instanceIds: [] });
  });

  it("the GM gets no attack button or prompts", () => {
    seed();
    render(
      <HudProvider>
        <PickProvider>
          <HudAttack state={{ ...state, role: "gm" } as CombatPageState} />
        </PickProvider>
      </HudProvider>,
    );
    expect(screen.queryByTestId("hud-attack-open")).toBeNull();
  });
});
