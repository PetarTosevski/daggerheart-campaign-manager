/**
 * Combat HUD HD2 (plan .omc/plans/combat-hud.yaml; user answer 4a 2026-11-01): `combatHud.sheet`, the sheet panel's data.
 * Any party member views any PC's sheet; only the cards in hand follow hand sharing, so the query never returns a card.
 * Access per role is in the authz matrix (tests/convex/authz/hud.entries.ts); here: the modes, what each holds, the
 * conditions' and effects' sources and durations.
 */
import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { VANISHING_ACT } from "../../convex/migrations/vanishingActMarker";
import { DOMAIN_CARDS } from "../../src/lib/srd/domain-cards";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { allowWorldEmails, buildWorld, type World } from "./authz/world";
import { errorCode, key } from "./helpers";

allowWorldEmails();

function editor(w: World) {
  return (characterId: Id<"characters">, patch: (s: CharacterSheet) => Partial<CharacterSheet>) =>
    w.t.run(async (ctx) => {
      const s = readSheet((await ctx.db.get("characters", characterId))!.sheet);
      await saveSheet(ctx, characterId, { ...s, ...patch(s) });
    });
}

const sheetOf = (w: World, characterId: Id<"characters">) => w.t.run(async (ctx) => readSheet((await ctx.db.get("characters", characterId))!.sheet));

describe("combatHud.sheet", () => {
  it("gives the player own mode, the GM gm mode and every other member view mode, with the same numbers", async () => {
    const w = await buildWorld();
    const args = { characterId: w.characterA };
    const own = await w.as("player").query(api.combatHud.sheet, args);
    const view = await w.as("otherPlayer").query(api.combatHud.sheet, args);
    const gm = await w.as("gm").query(api.combatHud.sheet, args);
    const granted = await w.as("grantee").query(api.combatHud.sheet, args);
    expect([own.mode, view.mode, gm.mode, granted.mode]).toEqual(["own", "view", "gm", "own"]);
    const s = await sheetOf(w, w.characterA);
    expect(own).toMatchObject({
      characterId: w.characterA,
      name: "Ash",
      className: "Warrior",
      level: 1,
      trackers: { hp: { marked: 0, max: s.hpMax }, stress: { marked: 0, max: s.stressMax }, hope: { value: s.hope, max: 6 }, armor: { marked: 0 } },
      experiences: s.experiences.map((e) => ({ id: e.id, name: e.name, value: e.value })),
    });
    expect(own.evasion).toBeGreaterThan(0);
    expect(own.armorScore).toBe(own.trackers.armor.max);
    expect(own.thresholds.severe).toBeGreaterThan(own.thresholds.major);
    // View mode: the same numbers, features and lists; only the Use data is left out.
    const { mode: _a, features: ownFeatures, ...ownRest } = own;
    const { mode: _b, features: viewFeatures, ...viewRest } = view;
    void _a;
    void _b;
    expect(viewRest).toEqual(ownRest);
    const withoutUses = (fs: typeof ownFeatures) => fs.map((f) => ({ ...f, uses: null }));
    expect(withoutUses(viewFeatures)).toEqual(withoutUses(ownFeatures));
    expect(viewFeatures.every((f) => f.uses === null)).toBe(true);
    expect(own.features.length).toBeGreaterThan(0);
    expect(own.features.every((f) => f.uses !== null)).toBe(true);
    expect(gm.features.every((f) => f.uses !== null)).toBe(true);
  });

  it("lists the warrior's features with their badges", async () => {
    const w = await buildWorld();
    const { features } = await w.as("otherPlayer").query(api.combatHud.sheet, { characterId: w.characterA });
    const byName = new Map(features.map((f) => [f.name, f]));
    expect(byName.get("No Mercy")).toMatchObject({ source: "hope", cost: "3 Hope", used: false });
    // Combat Training (CB p.45 "add your level to physical damage") applies by itself: `auto` (the board's "Passive" badge).
    expect(byName.get("Combat Training")).toMatchObject({ kind: "auto", cost: null, limit: null });
    for (const f of features) expect(f.text.length).toBeGreaterThan(0);
  });

  it("never returns a card, and reads while the hand is hidden or the GM's switch is off (only cards follow sharing)", async () => {
    const w = await buildWorld();
    await w.t.run(async (ctx) => {
      await ctx.db.patch("characters", w.characterA, { handHidden: true });
      await ctx.db.patch("campaigns", w.campaignId, { playersSeeHands: false });
    });
    // The classic drawer follows hand sharing; the sheet panel does not (answer 4a).
    const refused = await w
      .as("otherPlayer")
      .query(api.combatFeatures.drawer, { campaignId: w.campaignId, characterId: w.characterA })
      .catch((e: unknown) => e);
    expect(errorCode(refused)).toBe("FORBIDDEN");
    const view = await w.as("otherPlayer").query(api.combatHud.sheet, { characterId: w.characterA });
    expect(view.mode).toBe("view");
    const s = await sheetOf(w, w.characterA);
    const cards = DOMAIN_CARDS.filter((c) => s.domainCards.owned.includes(c.id));
    expect(cards.length).toBeGreaterThan(0);
    for (const sheet of [view, await w.as("player").query(api.combatHud.sheet, { characterId: w.characterA })]) {
      const json = JSON.stringify(sheet);
      for (const c of cards) {
        expect(json).not.toContain(c.id);
        expect(json).not.toContain(c.name);
      }
      expect(json).not.toMatch(/loadout|vault|domainCards/);
    }
  });

  it("gives conditions their source and duration, and lasting effects their duration in words", async () => {
    const w = await buildWorld();
    const edit = editor(w);
    await edit(w.characterA, () => ({
      conditions: ["hidden", "vulnerable"],
      effects: [
        { id: "fx-1", source: "Rogue's Dodge", text: "+2 Evasion", until: "hit", mods: { evasion: 2 } },
        { id: "fx-2", source: "Vicious Entangle", text: "Entangled; ends when they break free with a successful Instinct Roll", until: "manual" },
        { id: "fx-3", source: "No Mercy", text: "+1 to attack rolls", until: "rest" },
      ],
    }));
    const base = (await w.as("otherPlayer").query(api.combatHud.sheet, { characterId: w.characterB })).evasion;
    const sheet = await w.as("otherPlayer").query(api.combatHud.sheet, { characterId: w.characterA });
    expect(sheet.conditions).toEqual([
      { id: "hidden", label: "Hidden", source: null, until: "until an adversary would see you, you move into their sight, or you attack" },
      { id: "vulnerable", label: "Vulnerable", source: null, until: null },
    ]);
    expect(sheet.effects).toEqual([
      { id: "fx-1", source: "Rogue's Dodge", text: "+2 Evasion", until: "until you are hit", ends: "hit" },
      {
        id: "fx-2",
        source: "Vicious Entangle",
        text: "Entangled; ends when they break free with a successful Instinct Roll",
        until: "until they break free with a successful Instinct Roll",
        ends: "manual",
      },
      { id: "fx-3", source: "No Mercy", text: "+1 to attack rolls", until: "until the next rest", ends: "rest" },
    ]);
    // Active effects count in Evasion (Ash and Bryn are the same warrior otherwise).
    expect(sheet.evasion).toBe(base + 2);
  });

  it("names the feature a condition came from (its marker) and does not list the marker as an effect", async () => {
    const w = await buildWorld();
    const edit = editor(w);
    await edit(w.characterA, () => ({ classId: "rogue", subclassId: "nightwalker", subclassRank: "mastery", stress: 0, conditions: [] }));
    await w.as("player").mutation(api.combatFeatures.useFeature, {
      campaignId: w.campaignId,
      characterId: w.characterA,
      featureId: VANISHING_ACT,
      targetTokenIds: [],
      choices: [],
      idempotencyKey: key(),
    } as never);
    const sheet = await w.as("otherPlayer").query(api.combatHud.sheet, { characterId: w.characterA });
    const cloaked = sheet.conditions.find((c) => c.id === "cloaked");
    expect(cloaked).toMatchObject({ label: "Cloaked", source: "Vanishing Act" });
    expect(cloaked?.until).toMatch(/^until /);
    expect(sheet.effects.some((e) => e.text.split("; ")[0] === "cloaked")).toBe(false);
    expect(sheet.className).toBe("Rogue");
  });

  it("refuses an outsider and an unknown character with NOT_FOUND", async () => {
    const w = await buildWorld();
    const outsider = await w
      .as("outsider")
      .query(api.combatHud.sheet, { characterId: w.characterA })
      .catch((e: unknown) => e);
    expect(errorCode(outsider)).toBe("NOT_FOUND");
    await w.t.run((ctx) => ctx.db.delete("characters", w.characterB));
    const gone = await w
      .as("gm")
      .query(api.combatHud.sheet, { characterId: w.characterB })
      .catch((e: unknown) => e);
    expect(errorCode(gone)).toBe("NOT_FOUND");
  });
});
