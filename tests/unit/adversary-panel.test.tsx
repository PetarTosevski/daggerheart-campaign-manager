/**
 * The Combat Map's hit flashes and the adversary model the HUD reads (plan combat-actions AA5) with Convex mocked: the
 * flashes (rows already in the feed don't replay; hits, misses and roll-less features flash the tokens the row's
 * `targets` name by id, followups-7 H3; adversary tokens for the GM only; GM rows and undone rows never do), the range /
 * sight rows (CB p.103-104, Q2), and the incoming-hit prompt for a PC the GM owns (user answer 2026-10-22).
 *
 * Plan combat-hud H8.2 deleted the GM column's adversary controls and "Adversary actions" Resolutions card: the HUD
 * stat block (tests/unit/hud/statblock-panel.test.tsx "Attack opens the purple session…", "a feature with PC targets
 * opens the purple panel…", "rows: in range, out of range…, out of sight", FearConfirm tests) and the HUD Resolutions
 * (tests/unit/hud/queue-cards.test.tsx "Resolutions", tests/unit/hud/queue-model.test.tsx "resolutionRows") cover them.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HitFlashLayer } from "@/components/combat-map/actions/adversary/flash";
import { adversaryResolutionsOf, attackBand, newActionFlashes, rangeRows } from "@/components/combat-map/actions/adversary/model";
import { GmOwnHits } from "@/components/combat-map/actions/reactions";
import type { ActionsLayerProps, ActionsSlotProps } from "@/components/combat-map/slots";

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

const CAMPAIGN = "c1" as Id<"campaigns">;
const MAP = { _id: "m1" as Id<"combatMaps">, name: "Old road", live: true, source: "generated" as const, w: 20, h: 20 };

const state = (over: Partial<ActionsSlotProps> = {}): ActionsSlotProps => ({
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

describe("action rows: flashes by target id (followups-7 H3)", () => {
  const tokens = [
    { _id: "t-mira", x: 2, y: 3, size: 1 },
    { _id: "t-tabby", x: 8, y: 3, size: 1 },
    { _id: "t-wolf", x: 5, y: 5, size: 2 },
  ];
  type Target = { tokenId: string; side: "pc" | "adversary"; tone: "hit" | "miss" | "effect" };
  const row = (id: string, summary: string, over: Partial<{ kind: string; visibility: string; undone: boolean; targets: Target[] }> = {}) => ({
    _id: id,
    kind: "adversary",
    visibility: "public",
    summary,
    undone: false,
    ...over,
  });

  it("flashes each target token by id for new public action rows only", () => {
    const rows = [
      row("r3", "Bandit hit Mira; missed Tabby", {
        targets: [
          { tokenId: "t-mira", side: "pc", tone: "hit" },
          { tokenId: "t-tabby", side: "pc", tone: "miss" },
        ],
      }),
      row("r2", "Bandit → Mira 9 phy", { visibility: "gm", targets: [{ tokenId: "t-mira", side: "pc", tone: "hit" }] }),
      row("r1", "Bandit hit Tabby", { undone: true, targets: [{ tokenId: "t-tabby", side: "pc", tone: "hit" }] }),
      row("r0", "Bandit hit Mira", { targets: [{ tokenId: "t-mira", side: "pc", tone: "hit" }] }),
    ];
    const flashes = newActionFlashes(rows, new Set(["r0"]), tokens, false);
    expect(flashes.map((f) => [f.tokenId, f.tone, f.label])).toEqual([
      ["t-mira", "hit", "Hit"],
      ["t-tabby", "miss", "Miss"],
    ]);
    expect(flashes[0]).toMatchObject({ x: 2, y: 3, size: 1, key: "r3:t-mira" });
    expect(newActionFlashes([row("r4", "Bandit hit Mira", { kind: "combat", targets: [{ tokenId: "t-mira", side: "pc", tone: "hit" }] })], new Set(), tokens, false)).toEqual([]);
  });

  it("matches ids, never names: a row without targets flashes nothing, an unknown token id is skipped", () => {
    expect(newActionFlashes([row("r5", "Bandit hit Mira")], new Set(), tokens, true)).toEqual([]);
    expect(newActionFlashes([row("r6", "Bandit hit Mira", { targets: [{ tokenId: "t-gone", side: "pc", tone: "hit" }] })], new Set(), tokens, true)).toEqual([]);
    // A name with ", " in it is just text: the id decides.
    const comma = newActionFlashes([row("r7", "Bandit hit Mira, the Bold", { targets: [{ tokenId: "t-mira", side: "pc", tone: "hit" }] })], new Set(), tokens, false);
    expect(comma.map((f) => f.tokenId)).toEqual(["t-mira"]);
  });

  it("adversary tokens touched by a feature flash for the GM only", () => {
    const rows = [
      row("r8", "Leader used Rally on Wolf, Mira", {
        targets: [
          { tokenId: "t-wolf", side: "adversary", tone: "effect" },
          { tokenId: "t-mira", side: "pc", tone: "effect" },
        ],
      }),
    ];
    expect(newActionFlashes(rows, new Set(), tokens, true).map((f) => [f.tokenId, f.label, f.size])).toEqual([
      ["t-wolf", "!", 2],
      ["t-mira", "!", 1],
    ]);
    expect(newActionFlashes(rows, new Set(), tokens, false).map((f) => f.tokenId)).toEqual(["t-mira"]);
  });

  it("a PC the feature changed without naming them flashes '!' for players and the GM (followups-8 I2)", () => {
    const rows = [row("r9", "Demon used All Must Fall", { targets: [{ tokenId: "t-tabby", side: "pc", tone: "effect" }] })];
    for (const gm of [false, true]) {
      expect(newActionFlashes(rows, new Set(), tokens, gm).map((f) => [f.tokenId, f.tone, f.label])).toEqual([["t-tabby", "effect", "!"]]);
    }
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

const layer = (role: "gm" | "player"): ActionsLayerProps => ({
  ...state({ role }),
  viewport: { cell: 40, zoom: 1, w: 20, h: 20, pad: 0, toSquares: () => ({ x: 0, y: 0 }), showNames: false },
});
type FeedTarget = { tokenId: string; side: "pc" | "adversary"; tone: "hit" | "miss" | "effect" };
const feed = (rows: { _id: string; kind: string; visibility: string; summary: string; undone?: boolean; targets?: FeedTarget[] }[]) => ({
  page: rows.map((r) => ({ at: 1, actorId: "u", canUndo: false, undone: false, ...r })),
  isDone: true,
  continueCursor: "",
});

describe("HitFlashLayer", () => {
  const MIRA_HIT: FeedTarget[] = [{ tokenId: "t-mira", side: "pc", tone: "hit" }];

  it("doesn't replay old rows, flashes a new hit on the PC token, and drops it after its animation", () => {
    queries["combatTokensReads:party"] = [{ _id: "t-mira", name: "Mira", x: 2, y: 3, size: 1 }];
    queries["feed:list"] = feed([{ _id: "old", kind: "adversary", visibility: "public", summary: "Bandit hit Mira", targets: MIRA_HIT }]);
    const { rerender } = render(<HitFlashLayer {...layer("player")} />);
    rerender(<HitFlashLayer {...layer("player")} />);
    expect(screen.queryByTestId("combat-hit-flash")).toBeNull();

    queries["feed:list"] = feed([
      { _id: "new", kind: "adversary", visibility: "public", summary: "Bandit hit Mira", targets: MIRA_HIT },
      { _id: "old", kind: "adversary", visibility: "public", summary: "Bandit hit Mira", targets: MIRA_HIT },
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

  it("the GM reads every token and sees an adversary token a feature touched flash", () => {
    queries["combatTokensReads:list"] = [
      { _id: "t-mira", name: "Mira", x: 2, y: 3, size: 1 },
      { _id: "t-wolf", name: "Wolf", x: 6, y: 1, size: 1 },
    ];
    queries["feed:list"] = feed([]);
    const { rerender } = render(<HitFlashLayer {...layer("gm")} />);
    rerender(<HitFlashLayer {...layer("gm")} />);
    queries["feed:list"] = feed([{ _id: "rally", kind: "adversary", visibility: "public", summary: "Leader used Rally on Wolf", targets: [{ tokenId: "t-wolf", side: "adversary", tone: "effect" }] }]);
    rerender(<HitFlashLayer {...layer("gm")} />);
    const flash = screen.getByTestId("combat-hit-flash");
    expect(flash.getAttribute("data-tone")).toBe("effect");
    expect(flash.style.left).toBe("240px");
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
    queries["charactersReads:listByCampaign"] = [
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
    queries["charactersReads:listByCampaign"] = [{ _id: "gm-pc", mine: true, canEdit: true, status: "active", updatedAt: 1, sheet: { name: "Rook" } }];
    queries["adversaryActions:pending"] = [hit];
    const { container } = render(<GmOwnHits campaignId={CAMPAIGN} role="player" />);
    expect(container.innerHTML).toBe("");
  });
});
