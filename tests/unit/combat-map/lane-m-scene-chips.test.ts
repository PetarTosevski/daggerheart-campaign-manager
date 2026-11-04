// dcm-bxp.129: the Scene card's suggestion chips (src/components/combat-map/generate/scene-chips.ts) and the card's
// use of them: a chip fills the whole description box; setting chips follow the Setting picker; frame chips show only
// in that frame's campaigns. convex/react is replaced by the query results held here.
import { fireEvent, render, screen, within } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../../../convex/_generated/dataModel";
import { FRAME_CHIPS, SETTING_CHIPS, sceneChips } from "../../../src/components/combat-map/generate/scene-chips";
import { PUBLISHED_FRAME_IDS } from "../../../src/lib/frames";
import { DEFAULT_SETTING, SETTING_IDS } from "../../../src/lib/sprite-packs/settings";

let results: Record<string, unknown> = {};

vi.mock("convex/react", () => {
  const fn = () => Promise.resolve(null);
  return {
    useQuery: (ref: unknown, args: unknown) => (args === "skip" ? undefined : results[getFunctionName(ref as never)]),
    useAction: () => fn,
    useMutation: () => Object.assign(fn, { withOptimisticUpdate: () => fn }),
  };
});

const { ScenePanel } = await import("../../../src/components/combat-map/generate");

const CAMPAIGN = "c1" as Id<"campaigns">;
const PACK = "p1" as Id<"spritePacks">;

function settings(packs: { _id: Id<"spritePacks">; name: string; extends: { id: string; label: string } | null }[] = []) {
  return { builtin: SETTING_IDS.map((id) => ({ id, label: id })), packs };
}

beforeEach(() => {
  results = { "campaigns:get": { _id: CAMPAIGN, frameId: "custom" }, "combatMapStyle:settings": settings() };
});

function renderPanel() {
  render(createElement(ScenePanel, { campaignId: CAMPAIGN, map: null, onMapCreated: () => {} }));
  return within(screen.getByRole("group", { name: "Suggested scenes" }));
}

describe("scene chip data", () => {
  it("gives every built-in setting exactly its four chips", () => {
    expect(Object.keys(SETTING_CHIPS).sort()).toEqual([...SETTING_IDS].sort());
    for (const id of SETTING_IDS) expect(SETTING_CHIPS[id], id).toHaveLength(4);
  });

  it("gives every published frame four to six chips", () => {
    expect(Object.keys(FRAME_CHIPS).sort()).toEqual([...PUBLISHED_FRAME_IDS].sort());
    for (const id of PUBLISHED_FRAME_IDS) {
      expect(FRAME_CHIPS[id].length, id).toBeGreaterThanOrEqual(4);
      expect(FRAME_CHIPS[id].length, id).toBeLessThanOrEqual(6);
    }
  });

  it("has non-empty, unique labels and texts within each list", () => {
    for (const list of [...Object.values(SETTING_CHIPS), ...Object.values(FRAME_CHIPS)]) {
      for (const chip of list) {
        expect(chip.label.trim()).not.toBe("");
        expect(chip.text.trim()).not.toBe("");
      }
      expect(new Set(list.map((c) => c.label)).size).toBe(list.length);
    }
  });

  it("puts the setting's chips first, then the frame's; none for custom or unknown ids", () => {
    expect(sceneChips("forest", "witherwild")).toEqual([...SETTING_CHIPS.forest, ...FRAME_CHIPS.witherwild]);
    expect(sceneChips("forest", "custom")).toEqual(SETTING_CHIPS.forest);
    expect(sceneChips(null, undefined)).toEqual([]);
    expect(sceneChips("toString", "constructor")).toEqual([]);
  });
});

describe("Scene card chips", () => {
  it("fills the whole description box with the chip's text, which stays editable", () => {
    const group = renderPanel();
    const box = screen.getByRole("textbox", { name: "Describe the battlefield" });
    fireEvent.change(box, { target: { value: "something I typed" } });
    const chip = SETTING_CHIPS[DEFAULT_SETTING][1]!;
    fireEvent.click(group.getByRole("button", { name: chip.label }));
    expect(box).toHaveProperty("value", chip.text);
    fireEvent.change(box, { target: { value: `${chip.text} At night.` } });
    expect(box).toHaveProperty("value", `${chip.text} At night.`);
  });

  it("shows the default setting's chips under Let Claude choose, and the picked setting's after a pick", () => {
    const group = renderPanel();
    expect(group.getAllByRole("button").map((b) => b.textContent)).toEqual(SETTING_CHIPS[DEFAULT_SETTING].map((c) => c.label));
    fireEvent.change(screen.getByRole("combobox", { name: "Setting" }), { target: { value: "b:swamp" } });
    expect(group.getAllByRole("button").map((b) => b.textContent)).toEqual(SETTING_CHIPS.swamp.map((c) => c.label));
  });

  it("uses the built-in setting a pack adds to, and no setting chips for a pack with its own setting", () => {
    results["combatMapStyle:settings"] = settings([{ _id: PACK, name: "Bog pack", extends: { id: "swamp", label: "Swamp" } }]);
    const group = renderPanel();
    fireEvent.change(screen.getByRole("combobox", { name: "Setting" }), { target: { value: `p:${PACK}` } });
    expect(group.getAllByRole("button").map((b) => b.textContent)).toEqual(SETTING_CHIPS.swamp.map((c) => c.label));
  });

  it("adds the frame's chips only in that frame's campaigns", () => {
    results["campaigns:get"] = { _id: CAMPAIGN, frameId: "beast-feast" };
    results["combatMapStyle:settings"] = settings([{ _id: PACK, name: "Own pack", extends: null }]);
    const group = renderPanel();
    const labels = () => group.getAllByRole("button").map((b) => b.textContent);
    expect(labels()).toEqual([...SETTING_CHIPS[DEFAULT_SETTING], ...FRAME_CHIPS["beast-feast"]].map((c) => c.label));
    fireEvent.change(screen.getByRole("combobox", { name: "Setting" }), { target: { value: `p:${PACK}` } });
    expect(labels()).toEqual(FRAME_CHIPS["beast-feast"].map((c) => c.label));
  });
});
