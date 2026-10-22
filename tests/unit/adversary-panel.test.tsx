/**
 * The GM's adversary controls on the Combat Map and the hit flashes (plan combat-actions AA5) with Convex mocked: the
 * action-row parser and the flashes (rows already in the feed don't replay; hits, misses and roll-less features flash
 * the named PC tokens; GM rows and undone rows never do), the range / sight rows (CB p.103-104, Q2), the panel acting
 * for the selected adversary token with the Encounter tab's own controls (Attack fired once with the picked targets; a
 * PC out of sight not offered; the adversary stays picked when a PC token is selected), the GM's adversary
 * resolutions with Undo (U4), and the incoming-hit prompt for a PC the GM owns (user answer 2026-10-22).
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdversaryControls } from "@/components/combat-map/actions/adversary/controls";
import { HitFlashLayer } from "@/components/combat-map/actions/adversary/flash";
import { adversaryResolutionsOf, attackBand, newActionFlashes, parseActionRow, rangeRows } from "@/components/combat-map/actions/adversary/model";
import { AdversaryResolutions } from "@/components/combat-map/actions/adversary/resolutions";
import { GmOwnHits } from "@/components/combat-map/actions/reactions";
import type { AdversaryPanelProps, ActionsLayerProps } from "@/components/combat-map/slots";

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

vi.mock("@/components/party/dice/dice3d", () => ({ play3d: async () => false }));

/** Line of sight for the panel: Tabby (x >= 10) is behind a wall. The real `sightOn` is tested on its own below. */
vi.mock("@/components/combat-map/actions/adversary/sight", async (importActual) => {
  const actual = await importActual<typeof import("@/components/combat-map/actions/adversary/sight")>();
  return { ...actual, useLiveSight: () => (_from: unknown, to: { x: number }) => ({ lineOfSight: to.x < 10, cover: false }) };
});

afterEach(() => {
  calls.length = 0;
  for (const k of Object.keys(results)) delete results[k];
  for (const k of Object.keys(queries)) delete queries[k];
});

const CAMPAIGN = "c1" as Id<"campaigns">;
const MAP = { _id: "m1" as Id<"combatMaps">, name: "Old road", live: true, source: "generated" as const, w: 20, h: 20 };

const state = (over: Partial<AdversaryPanelProps> = {}): AdversaryPanelProps => ({
  campaignId: CAMPAIGN,
  role: "gm",
  mode: "play",
  map: MAP,
  selectedTokenId: null,
  onSelectToken: () => {},
  previewCharacterId: null,
  onPreview: () => {},
  ...over,
});

describe("action rows (AA2's public text)", () => {
  it("reads hits and misses of one roll, with or without a feature", () => {
    expect(parseActionRow("Bandit hit Mira")).toEqual({ attacker: "Bandit", feature: null, marks: [{ name: "Mira", tone: "hit" }] });
    expect(parseActionRow("Jagged Knife Bandit used Bite: hit Mira, Tabby; missed Ash")).toEqual({
      attacker: "Jagged Knife Bandit",
      feature: "Bite",
      marks: [
        { name: "Mira", tone: "hit" },
        { name: "Tabby", tone: "hit" },
        { name: "Ash", tone: "miss" },
      ],
    });
    expect(parseActionRow("Bandit missed Mira")?.marks).toEqual([{ name: "Mira", tone: "miss" }]);
  });

  it("reads a feature with no roll as an effect, and ignores rows that aren't actions", () => {
    expect(parseActionRow("Bandit used Roar on Mira, Tabby")?.marks).toEqual([
      { name: "Mira", tone: "effect" },
      { name: "Tabby", tone: "effect" },
    ]);
    expect(parseActionRow("Bandit used Roar")).toEqual({ attacker: "Bandit", feature: "Roar", marks: [] });
    expect(parseActionRow("Mira took Bandit's hit")).toBeNull();
    expect(parseActionRow("Tabby uses I Am Your Shield for Mira")).toBeNull();
  });

  const tokens = [
    { _id: "t-mira", name: "Mira", x: 2, y: 3, size: 1 },
    { _id: "t-tabby", name: "Tabby", x: 8, y: 3, size: 1 },
  ];
  const row = (id: string, summary: string, over: Partial<{ kind: string; visibility: string; undone: boolean }> = {}) => ({
    _id: id,
    kind: "adversary",
    visibility: "public",
    summary,
    undone: false,
    ...over,
  });

  it("flashes each named PC token for new public action rows only", () => {
    const rows = [
      row("r3", "Bandit hit Mira; missed Tabby"),
      row("r2", "Bandit → Mira 9 phy", { visibility: "gm" }),
      row("r1", "Bandit hit Tabby", { undone: true }),
      row("r0", "Bandit hit Mira"),
    ];
    const flashes = newActionFlashes(rows, new Set(["r0"]), tokens);
    expect(flashes.map((f) => [f.tokenId, f.tone, f.label])).toEqual([
      ["t-mira", "hit", "Hit"],
      ["t-tabby", "miss", "Miss"],
    ]);
    expect(flashes[0]).toMatchObject({ x: 2, y: 3, size: 1, key: "r3:t-mira" });
    expect(newActionFlashes([row("r4", "Bandit hit Mira", { kind: "combat" })], new Set(), tokens)).toEqual([]);
  });

  it("lists the GM's adversary rows for Resolutions", () => {
    const rows = [row("a", "x", { visibility: "gm" }), row("b", "y"), row("c", "z", { kind: "combat", visibility: "gm" }), row("d", "w", { visibility: "gm" })];
    expect(adversaryResolutionsOf(rows, 1).map((r) => r._id)).toEqual(["a"]);
    expect(adversaryResolutionsOf(rows, 8).map((r) => r._id)).toEqual(["a", "d"]);
  });
});

describe("range and sight (CB p.103-104, Q2)", () => {
  it("gives the band from the adversary, line of sight and whether the attack reaches", () => {
    const sight = (_f: unknown, to: { x: number }) => ({ lineOfSight: to.x < 10, cover: to.x === 3 });
    const rows = rangeRows(
      { x: 2, y: 2 },
      [
        { characterId: "mira", name: "Mira", x: 3, y: 2 },
        { characterId: "tabby", name: "Tabby", x: 12, y: 2 },
      ],
      sight,
      "Melee",
    );
    expect(rows).toEqual([
      { characterId: "mira", name: "Mira", band: "melee", sight: "cover", inAttackRange: true },
      { characterId: "tabby", name: "Tabby", band: "far", sight: "blocked", inAttackRange: false },
    ]);
    expect(rangeRows({ x: 0, y: 0 }, [{ characterId: "m", name: "M", x: 5, y: 0 }], null, "Very Far")[0]).toMatchObject({ band: "close", sight: "unknown", inAttackRange: true });
    expect(attackBand("Very Close")).toBe("veryClose");
    expect(attackBand("Special")).toBeNull();
  });

  it("checks line of sight on the layout's painted blockers", async () => {
    const { sightOn } = await vi.importActual<typeof import("@/components/combat-map/actions/adversary/sight")>("@/components/combat-map/actions/adversary/sight");
    const w = 10;
    const wall = Array.from({ length: 8 * w }, (_, i) => (i % w === 5 ? "#" : ".")).join("");
    const layout = { w, h: 8, base: "grass", areas: [], objects: [], source: "generated", cells: [] as { layer: "block"; tile: number; cells: string }[] };
    const open = sightOn(layout as unknown as Parameters<typeof sightOn>[0]);
    expect(open({ x: 1, y: 3 }, { x: 8, y: 3 }).lineOfSight).toBe(true);
    const walled = sightOn({ ...layout, cells: [{ layer: "block", tile: 0, cells: wall }] } as unknown as Parameters<typeof sightOn>[0]);
    expect(walled({ x: 1, y: 3 }, { x: 8, y: 3 }).lineOfSight).toBe(false);
  });
});

const BEAR = {
  _id: "cb1",
  name: "Bear",
  tier: 1,
  type: "Bruiser",
  description: "A large bear.",
  motives: "Maul",
  difficulty: 14,
  thresholds: { major: 9, severe: 17 },
  hp: 7,
  stress: 2,
  attack: { modifier: 1, name: "Claws", range: "Melee", damage: "1d8+3 phy" },
  experiences: [],
  features: [
    { name: "Overwhelming Force", kind: "passive", text: "Knock back." },
    { name: "Roar", kind: "action", text: "Spend a Fear to roar.", fearCost: 1 },
  ],
};
const TOKENS = [
  { _id: "t-bear", kind: "adversary", instanceId: "i1", name: "Bear", x: 5, y: 5, size: 1 },
  { _id: "t-mira", kind: "pc", characterId: "mira", name: "Mira", x: 6, y: 5, size: 1 },
  { _id: "t-tabby", kind: "pc", characterId: "tabby", name: "Tabby", x: 15, y: 5, size: 1 },
];
const INSTANCE = {
  _id: "i1",
  label: "Bear",
  hp: 1,
  stress: 0,
  stats: { hpMax: 7, stressMax: 2 },
  defeated: false,
  spotlights: 0,
  spotlightTurn: 0,
  source: { kind: "custom", customId: "cb1" },
};

function seedEncounter() {
  queries["combatTokens:list"] = TOKENS;
  queries["combatMaps:list"] = [MAP];
  queries["encounters:list"] = { active: [{ _id: "e1", status: "running", name: "Road" }], ended: [] };
  queries["encounters:get"] = { encounter: { _id: "e1", status: "running", gmTurn: 1, name: "Road" }, instances: [INSTANCE] };
  queries["encounterTracking:customBlocks"] = [BEAR];
  queries["campaigns:fear"] = 3;
  queries["characters:listByCampaign"] = [
    { _id: "mira", status: "active", sheet: { name: "Mira" } },
    { _id: "tabby", status: "active", sheet: { name: "Tabby" } },
  ];
  queries["adversaryActions:windows"] = [];
}

describe("AdversaryControls", () => {
  it("asks for an adversary token, or a running encounter", () => {
    seedEncounter();
    const { rerender } = render(<AdversaryControls {...state()} />);
    expect(screen.getByTestId("adversary-hint").textContent).toMatch(/Select an adversary token/);
    queries["encounters:list"] = { active: [], ended: [] };
    rerender(<AdversaryControls {...state({ selectedTokenId: "t-bear" as Id<"combatTokens"> })} />);
    expect(screen.getByText(/No encounter is running/)).toBeTruthy();
  });

  it("acts for the selected adversary with the Encounter tab's controls; a PC out of sight isn't offered", async () => {
    seedEncounter();
    results["adversaryActions:attack"] = [
      { status: "resolved", groupId: "g", entryId: "e", roll: { kind: "action", dice: [{ sides: 20, value: 12, role: "d20" }], modifier: 1, total: 13, outcome: "none", manual: false }, success: true, targets: [{ characterId: "mira", hit: true, requestId: "r1", damage: 8, resolved: false }], fearDelta: 0, prompts: [], offers: [] },
    ];
    const { rerender } = render(<AdversaryControls {...state({ selectedTokenId: "t-bear" as Id<"combatTokens"> })} />);
    const sel = screen.getByTestId("adversary-selected");
    expect(within(sel).getByRole("heading", { name: "Bear" })).toBeTruthy();
    const ranges = within(sel).getByRole("list", { name: "Range and sight" });
    expect(ranges.textContent).toMatch(/Mira\s*Melee\s*In sight/);
    expect(ranges.textContent).toMatch(/Tabby\s*Far\s*No line of sight\s*beyond Claws \(Melee\)/);

    const panel = within(sel).getByRole("region", { name: "Adversary actions" });
    const targets = within(panel).getByRole("group", { name: "Targets" });
    expect(within(targets).queryByRole("button", { name: "Tabby" })).toBeNull();
    fireEvent.click(within(targets).getByRole("button", { name: "Mira" }));

    // Selecting Mira's token on the map keeps acting for the Bear.
    rerender(<AdversaryControls {...state({ selectedTokenId: "t-mira" as Id<"combatTokens"> })} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "⚔ Attack Mira with Claws" }));
    });
    const attacks = calls.filter((c) => c.name === "adversaryActions:attack");
    expect(attacks).toHaveLength(1);
    expect(attacks[0]!.args).toMatchObject({ campaignId: CAMPAIGN, instanceId: "i1", targets: ["mira"] });
    expect(screen.getByTestId("tracker-action-result").textContent).toMatch(/Mira\s*Hit\s*8 damage\s*waiting for answers/);

    // Done stops acting for it.
    fireEvent.click(screen.getByRole("button", { name: "Stop acting for Bear" }));
    expect(screen.getByTestId("adversary-hint")).toBeTruthy();
  });

  it("asks before spending Fear on a feature (Q19)", async () => {
    seedEncounter();
    results["adversaryActions:useFeature"] = [{ status: "confirmFear", fear: 1, spotlight: 0, feature: 1, experience: 0 }];
    render(<AdversaryControls {...state({ selectedTokenId: "t-bear" as Id<"combatTokens"> })} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Use Roar (1 Fear)" }));
    });
    expect(screen.getByRole("group", { name: "Spend Fear?" }).textContent).toMatch(/Spend 1 Fear\? 1 for the feature\./);
    expect(calls.filter((c) => c.name === "adversaryActions:useFeature")[0]!.args).not.toHaveProperty("spendFear");
  });
});

const layer = (role: "gm" | "player"): ActionsLayerProps => ({
  ...state({ role }),
  viewport: { cell: 40, zoom: 1, w: 20, h: 20, pad: 0, toSquares: () => ({ x: 0, y: 0 }), showNames: false },
});
const feed = (rows: { _id: string; kind: string; visibility: string; summary: string; undone?: boolean }[]) => ({
  page: rows.map((r) => ({ at: 1, actorId: "u", canUndo: false, undone: false, ...r })),
  isDone: true,
  continueCursor: "",
});

describe("HitFlashLayer", () => {
  it("doesn't replay old rows, flashes a new hit on the PC token, and drops it after its animation", () => {
    queries["combatTokens:party"] = [{ _id: "t-mira", name: "Mira", x: 2, y: 3, size: 1 }];
    queries["feed:list"] = feed([{ _id: "old", kind: "adversary", visibility: "public", summary: "Bandit hit Mira" }]);
    const { rerender } = render(<HitFlashLayer {...layer("player")} />);
    rerender(<HitFlashLayer {...layer("player")} />);
    expect(screen.queryByTestId("combat-hit-flash")).toBeNull();

    queries["feed:list"] = feed([
      { _id: "new", kind: "adversary", visibility: "public", summary: "Bandit hit Mira" },
      { _id: "old", kind: "adversary", visibility: "public", summary: "Bandit hit Mira" },
    ]);
    rerender(<HitFlashLayer {...layer("player")} />);
    const flash = screen.getByTestId("combat-hit-flash");
    expect(flash.getAttribute("data-tone")).toBe("hit");
    expect(flash.style.left).toBe("80px");
    expect(flash.style.top).toBe("120px");
    expect(flash.textContent).toBe("Hit");
    // React listens for the vendor-prefixed name where the DOM has no AnimationEvent (jsdom).
    fireEvent.animationEnd(flash);
    fireEvent(flash, new Event("webkitAnimationEnd", { bubbles: true }));
    expect(screen.queryByTestId("combat-hit-flash")).toBeNull();
  });
});

describe("AdversaryResolutions", () => {
  it("lists the GM's adversary rows with Undo, once per click", async () => {
    queries["feed:list"] = feed([
      { _id: "g1", kind: "adversary", visibility: "gm", summary: "Bear Claws: 15 vs Mira 12: hit", canUndo: true } as never,
      { _id: "p1", kind: "adversary", visibility: "public", summary: "Bear hit Mira" },
    ]);
    render(<AdversaryResolutions {...state()} />);
    const list = screen.getByRole("list", { name: "Latest adversary actions" });
    expect(within(list).getAllByTestId("combat-resolution")).toHaveLength(1);
    await act(async () => {
      fireEvent.click(within(list).getByRole("button", { name: "Undo: Bear Claws: 15 vs Mira 12: hit" }));
    });
    expect(calls.filter((c) => c.name === "actionLog:undo").map((c) => c.args.entryId)).toEqual(["g1"]);
  });

  it("renders nothing before any adversary acted", () => {
    queries["feed:list"] = feed([{ _id: "p1", kind: "combat", visibility: "gm", summary: "Mira hit Bear" }]);
    const { container } = render(<AdversaryResolutions {...state()} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("GmOwnHits (user answer 2026-10-22)", () => {
  const hit = {
    requestId: "req-1",
    attackerLabel: "Bandit",
    targetCharacterId: "gm-pc",
    targetName: "Rook",
    awaiting: true,
    cardIds: [],
    createdAt: 1,
    role: "target",
    damage: 14,
    severity: "major",
    direct: false,
    maxSlots: 1,
    armorPreview: [
      { slots: 0, severity: "major", hp: 2 },
      { slots: 1, severity: "minor", hp: 1 },
    ],
  };

  it("gives a PC the GM owns the same prompt in the GM column, and nothing for the players' PCs", () => {
    queries["characters:listByCampaign"] = [
      { _id: "gm-pc", mine: true, canEdit: true, status: "active", updatedAt: 1, sheet: { name: "Rook" } },
      { _id: "mira", mine: false, canEdit: true, status: "active", updatedAt: 1, sheet: { name: "Mira" } },
    ];
    queries["adversaryActions:pending"] = [hit];
    queries["deathMoves:state"] = { awaitingMove: false, pending: null, undoEntryId: null, lessLethal: false, awayRequested: false };
    render(<GmOwnHits campaignId={CAMPAIGN} role="gm" />);
    const cards = screen.getAllByTestId("incoming-hit");
    expect(cards).toHaveLength(1);
    expect(cards[0]!.textContent).toMatch(/You were hit\s*Bandit hit Rook\s*14 damage: Major \(2 HP\)\./);
    fireEvent.click(within(cards[0]!).getByRole("button", { name: "Mark" }));
    expect(calls.filter((c) => c.name === "adversaryActions:respond")[0]!.args).toMatchObject({ characterId: "gm-pc", choice: { kind: "armor", slots: 1 } });
  });

  it("renders nothing for a player (their prompt is in the player column)", () => {
    queries["characters:listByCampaign"] = [{ _id: "gm-pc", mine: true, canEdit: true, status: "active", updatedAt: 1, sheet: { name: "Rook" } }];
    queries["adversaryActions:pending"] = [hit];
    const { container } = render(<GmOwnHits campaignId={CAMPAIGN} role="player" />);
    expect(container.innerHTML).toBe("");
  });
});
