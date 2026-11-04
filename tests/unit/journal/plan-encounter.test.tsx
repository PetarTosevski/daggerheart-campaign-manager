// Journal JP2 (plan .omc/plans/journal.yaml, docs/tasks/TASK-JOURNAL-JP2.md): a Combat scene's encounter card and the
// 'Battle points · Scene N' panel. convex/react returns the results held here; mutations are recorded.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { InstanceView } from "../../../src/components/adversaries/builder/types";

let results: Record<string, unknown> = {};
const calls = vi.hoisted(() => ({ list: [] as { name: string; args: Record<string, unknown> }[] }));

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown, args: unknown) => (args === "skip" ? undefined : results[getFunctionName(ref as never)]),
  useMutation: (ref: unknown) => {
    const name = getFunctionName(ref as never);
    const run = async (args: Record<string, unknown>) => {
      calls.list.push({ name, args });
      return name === "sessionPrep:createSceneEncounter" ? { encounterId: "e9" } : null;
    };
    return Object.assign(run, { withOptimisticUpdate: () => run });
  },
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { SceneEncounter, encounterChips } = await import("../../../src/components/journal/plan/encounter");
const { BattlePointsPanel } = await import("../../../src/components/journal/plan/battle-points");

const inst = (label: string, name: string | null, type: string | null, extra: Record<string, unknown> = {}) =>
  ({ _id: label, label, name, type, tier: 1, summoned: false, defeated: false, ...extra }) as unknown as InstanceView;

const INSTANCES = [
  inst("Lieutenant", "Jagged Knife Lieutenant", "Leader"),
  inst("Bandit 1", "Jagged Knife Bandit", "Standard"),
  inst("Bandit 2", "Jagged Knife Bandit", "Standard"),
  inst("Sniper", "Jagged Knife Sniper", "Ranged"),
  inst("Lackey", "Jagged Knife Lackey", "Minion", { minionCount: 4 }),
];

const ENCOUNTER = { _id: "e1", name: "Jagged Knife ambush", status: "draft", pcs: 4, adjustments: [] };

const scene = (id: string, type: string, encounter: unknown = null) => ({ id, type, text: "", encounter });
function prep(encounter: unknown, onMap = true) {
  return {
    scenes: [scene("a", "exploration"), scene("b", "combat", encounter === null ? null : { ...(encounter as object), onMap, instances: [] })],
    hooks: "",
    encounter: null,
  };
}

const ids = { campaignId: "c1" as never, sessionId: "s6" as never, sceneId: "b", sceneNumber: 3 };

beforeEach(() => {
  calls.list = [];
  results = {
    "sessionPrep:get": prep(ENCOUNTER),
    "encounters:get": { encounter: ENCOUNTER, instances: INSTANCES },
    "encounters:list": { active: [{ _id: "e2", name: "Bear den", status: "draft" }], ended: [{ _id: "e3", name: "Old fight", status: "ended" }] },
    "campaigns:get": { tier: 1 },
  };
});
afterEach(cleanup);

describe("encounterChips", () => {
  it("groups a stat block's instances with the count and Battle Points (Minions per party-sized group)", () => {
    expect(encounterChips(INSTANCES, 4).map(({ name, count, type, bp }) => ({ name, count, type, bp }))).toEqual([
      { name: "Jagged Knife Lieutenant", count: 1, type: "Leader", bp: 3 },
      { name: "Jagged Knife Bandit", count: 2, type: "Standard", bp: 4 },
      { name: "Jagged Knife Sniper", count: 1, type: "Ranged", bp: 2 },
      { name: "Jagged Knife Lackey", count: 4, type: "Minion", bp: 1 },
    ]);
  });

  it("costs summoned and unknown adversaries nothing and keeps them apart", () => {
    const chips = encounterChips([inst("Bear 1", "Bear", "Bruiser"), inst("Bear 2", "Bear", "Bruiser", { summoned: true }), inst("Ghost", null, null)], 4);
    expect(chips.map((c) => [c.name, c.count, c.bp])).toEqual([
      ["Bear", 1, 4],
      ["Bear", 1, 0],
      ["Ghost", 1, 0],
    ]);
  });
});

describe("SceneEncounter, linked", () => {
  it("shows the name, a chip per stat block, 'On the Combat Map', 'Open map' and 'Edit in Adversaries'", () => {
    render(<SceneEncounter {...ids} isGm />);
    const card = screen.getByTestId("scene-encounter");
    expect(within(card).getByRole("heading", { name: "Encounter · Jagged Knife ambush" })).toBeTruthy();
    const chips = within(screen.getByRole("list", { name: "Adversaries in this encounter" })).getAllByRole("listitem");
    expect(chips.map((c) => c.textContent)).toEqual([
      "Jagged Knife LieutenantLeader · 3",
      "Jagged Knife Bandit ×2Standard · 4",
      "Jagged Knife SniperRanged · 2",
      "Jagged Knife Lackey ×4Minion · 1",
    ]);
    expect(screen.getByTestId("scene-encounter-on-map").textContent).toBe("On the Combat Map");
    expect(screen.getByRole("link", { name: "Open map" }).getAttribute("href")).toBe("/campaigns/c1/combat-map");
    expect(screen.getByRole("link", { name: "Edit in Adversaries" }).getAttribute("href")).toBe("/campaigns/c1/adversaries?tab=encounters&encounter=e1");
    expect(screen.queryByRole("button", { name: /Add adversary/ })).toBeNull();
  });

  it("hides 'On the Combat Map' when nothing is placed and unlinks on request", async () => {
    results["sessionPrep:get"] = prep(ENCOUNTER, false);
    render(<SceneEncounter {...ids} isGm />);
    expect(screen.queryByTestId("scene-encounter-on-map")).toBeNull();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Unlink Jagged Knife ambush from this scene" })));
    expect(calls.list).toEqual([{ name: "sessionPrep:unlinkSceneEncounter", args: { campaignId: "c1", sessionId: "s6", sceneId: "b" } }]);
  });

  it("says so when the encounter has no adversaries, and shows a loading line", () => {
    results["encounters:get"] = { encounter: ENCOUNTER, instances: [] };
    const { unmount } = render(<SceneEncounter {...ids} isGm />);
    expect(screen.getByText(/No adversaries yet/)).toBeTruthy();
    unmount();
    results["sessionPrep:get"] = undefined;
    render(<SceneEncounter {...ids} isGm />);
    expect(screen.getByRole("status").textContent).toBe("Loading the encounter…");
  });

  it("renders nothing for a player or a non-Combat scene", () => {
    const { container, unmount } = render(<SceneEncounter {...ids} isGm={false} />);
    expect(container.innerHTML).toBe("");
    unmount();
    const other = render(<SceneEncounter {...ids} sceneId="a" isGm />);
    expect(other.container.innerHTML).toBe("");
  });
});

describe("SceneEncounter, none linked", () => {
  beforeEach(() => {
    results["sessionPrep:get"] = prep(null);
  });

  it("creates a draft for the scene (keyed intent)", async () => {
    render(<SceneEncounter {...ids} isGm />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Create encounter" })));
    expect(calls.list).toHaveLength(1);
    expect(calls.list[0]!.name).toBe("sessionPrep:createSceneEncounter");
    expect(calls.list[0]!.args).toMatchObject({ campaignId: "c1", sessionId: "s6", sceneId: "b" });
    expect(typeof calls.list[0]!.args.idempotencyKey).toBe("string");
  });

  it("links one of the campaign's encounters", async () => {
    render(<SceneEncounter {...ids} isGm />);
    const select = screen.getByRole("combobox", { name: "Link an encounter" });
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["Bear den (Draft)", "Old fight (Ended)"]);
    fireEvent.change(select, { target: { value: "e3" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Link" })));
    expect(calls.list).toEqual([{ name: "sessionPrep:linkSceneEncounter", args: { campaignId: "c1", sessionId: "s6", sceneId: "b", encounterId: "e3" } }]);
  });
});

describe("BattlePointsPanel", () => {
  it("shows the scene's encounter in the builder's panel, journal variant, titled with the scene number", () => {
    render(<BattlePointsPanel {...ids} isGm />);
    const panel = screen.getByTestId("bp-panel");
    expect(panel.getAttribute("data-variant")).toBe("journal");
    expect(within(panel).getByRole("heading", { name: "Battle points · Scene 3" })).toBeTruthy();
    expect(screen.getByTestId("bp-spent").textContent).toBe("10of 14 spent4 left");
  });

  it("hints when the scene has no encounter yet, and renders nothing for a player", () => {
    results["sessionPrep:get"] = prep(null);
    const { unmount } = render(<BattlePointsPanel {...ids} isGm />);
    expect(screen.getByRole("heading", { name: "Battle points · Scene 3" })).toBeTruthy();
    expect(screen.getByText(/No encounter yet/)).toBeTruthy();
    unmount();
    const player = render(<BattlePointsPanel {...ids} isGm={false} />);
    expect(player.container.innerHTML).toBe("");
  });

  it("shows a loading line and a gone encounter", () => {
    results["encounters:get"] = undefined;
    const { unmount } = render(<BattlePointsPanel {...ids} isGm />);
    expect(screen.getByRole("status").textContent).toBe("Loading the Battle Points…");
    unmount();
    results["encounters:get"] = null;
    render(<BattlePointsPanel {...ids} isGm />);
    expect(screen.getByText("This encounter no longer exists.")).toBeTruthy();
  });
});
