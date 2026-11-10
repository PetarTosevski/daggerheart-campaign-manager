import { expect, test } from "@jest/globals";

import { askAnswers, candidatesFor, targetingOf, togglePicked, blockedReason } from "../../../src/features/combat-map/play/card-use";
import { addMinion, minionIds } from "../../../src/features/combat-map/play/results";
import { attackWeapons } from "../../../src/features/combat-map/play/weapons";
import { fogRuns, withFogStroke } from "../../../src/features/combat-map/gm/fog-brush";

test("targeting follows the server's runner: self, all and none send no target; point and object need the website", () => {
  expect(targetingOf({ targets: null }).kind).toBe("none");
  expect(targetingOf({ targets: { side: "self", range: "melee", count: "one" } }).kind).toBe("none");
  expect(targetingOf({ targets: { side: "enemy", range: "close", count: "all" } }).kind).toBe("none");
  expect(targetingOf({ targets: { side: "point", range: "far", count: "one" } }).kind).toBe("website");
  expect(targetingOf({ targets: { side: "ally", range: "close", count: "one" } })).toEqual({ kind: "pick", side: "ally", min: 1, max: 1 });
  expect(targetingOf({ targets: { side: "any", range: "close", count: "upTo" } })).toEqual({ kind: "pick", side: "any", min: 1, max: null });
});

test("candidates fit the card's side", () => {
  const view = {
    tokenId: "me",
    pcs: [
      { _id: "me", name: "Briar" },
      { _id: "pc2", name: "Moss" },
    ],
    others: [
      { _id: "e1", name: "Bandit", side: "enemy" },
      { _id: "n1", name: "Crate golem", side: "neutral" },
    ],
  };
  expect(candidatesFor("enemy", view).map((c) => c.tokenId)).toEqual(["e1"]);
  expect(candidatesFor("ally", view).map((c) => c.tokenId)).toEqual(["pc2"]);
  expect(candidatesFor("selfOrAlly", view).map((c) => c.name)).toEqual(["You", "Moss"]);
  expect(candidatesFor("any", view)).toHaveLength(4);
});

test("one-target picks replace, capped picks stop at the cap", () => {
  expect(togglePicked(["a"], "b", 1)).toEqual(["b"]);
  expect(togglePicked(["a"], "a", 1)).toEqual([]);
  expect(togglePicked(["a", "b"], "c", 2)).toEqual(["a", "b"]);
  expect(togglePicked(["a"], "c", null)).toEqual(["a", "c"]);
});

test("an exhausted card or a spent use is blocked with its reset", () => {
  expect(blockedReason({ state: "exhausted", resetLabel: "until a rest" }, { ready: false, resetLabel: null })).toBe("Exhausted · until a rest");
  expect(blockedReason({ state: "ready", resetLabel: null }, { ready: false, resetLabel: "once per session" })).toBe("Used · once per session");
  expect(blockedReason({ state: "ready", resetLabel: null }, { ready: true, resetLabel: null })).toBeNull();
});

test("choose answers use the runner's ids", () => {
  const asks = [
    { kind: "choose" as const, stepId: "s1", label: "", options: [] },
    { kind: "choose" as const, stepId: "s2", label: "", options: [], chooserId: "tok-2" as never },
  ];
  expect(askAnswers(asks, { "opt:s1": "a", "by:s2:tok-2": "b" })).toEqual([
    { id: "opt:s1", value: ["a"] },
    { id: "by:s2:tok-2", value: ["b"] },
  ]);
});

test("Minion picks stay within the offer and each candidate's count", () => {
  const offer = { extra: 2, candidates: [{ instanceId: "a", tokenId: "t", name: "A", available: 1 }, { instanceId: "b", tokenId: "u", name: "B", available: 5 }] } as never;
  let counts = addMinion(offer, {}, "a", 1);
  counts = addMinion(offer, counts, "a", 1);
  expect(counts).toEqual({ a: 1 });
  counts = addMinion(offer, counts, "b", 1);
  counts = addMinion(offer, counts, "b", 1);
  expect(minionIds(counts)).toEqual(["a", "b"]);
});

test("every SRD weapon counts, tiered ones included (the server's getWeapon)", () => {
  expect(attackWeapons({ primaryWeaponId: "broadsword", secondaryWeaponId: "small-dagger" }).map((w) => w.slot)).toEqual(["primary", "secondary"]);
  expect(attackWeapons({ primaryWeaponId: "no-such-weapon" })).toEqual([]);
});

test("fog marks merge into runs, and a stroke rewrites only its tiles", () => {
  expect(fogRuns({ "0,0": "hide", "1,0": "hide", "2,0": "reveal", "0,2": "hide" })).toEqual([
    { x: 0, y: 0, w: 2, mark: "hide" },
    { x: 2, y: 0, w: 1, mark: "reveal" },
    { x: 0, y: 2, w: 1, mark: "hide" },
  ]);
  const terrain = { layer: "terrain" as const, tile: 0, cells: "a" };
  const painted = withFogStroke([terrain], 4, [0, 1], "hide");
  expect(painted[0]).toBe(terrain);
  expect(painted[1]).toMatchObject({ layer: "fog", tile: 0 });
  expect((painted[1] as { cells: string }).cells.startsWith("hh")).toBe(true);
  expect(withFogStroke(painted, 4, [0, 1], "erase")).toEqual([terrain]);
});
