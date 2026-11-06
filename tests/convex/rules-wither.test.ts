// Rule switch W1 `witherTokens` (Witherwild, CB p.261; plan rule-switches RW): Book adds a Wither token and rolls the
// Fear Die on Severe damage from a Withered source; Manual adds nothing and posts a GM-only note.
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet } from "../../convex/lib/characterSheet";
import { witherOnDamage } from "../../src/lib/domain/wither/index";
import { ANCESTRIES, ARMOR, COMMUNITIES, cardsForDomains, getClass, subclassesForClass, WEAPONS } from "../../src/lib/srd/index";
import { key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

const EMAILS = "gm@example.com,p1@example.com";
const page = { paginationOpts: { numItems: 20, cursor: null } };

function draft(name: string) {
  const cls = getClass("warrior")!;
  return {
    classId: cls.id,
    subclassId: subclassesForClass("warrior")[0].id,
    ancestry: { kind: "single", id: ANCESTRIES.find((a) => a.source === "core")!.id },
    communityId: COMMUNITIES.find((c) => c.source === "core")!.id,
    traits: { agility: 2, strength: 1, finesse: 1, instinct: 0, presence: 0, knowledge: -1 },
    name,
    pronouns: "",
    description: "",
    primaryWeaponId: WEAPONS.find((w) => w.slot === "primary" && w.tier === 1 && w.source === "core" && w.category === "physical" && !w.classId)!.id,
    armorId: ARMOR.find((a) => a.source === "core" && a.tier === 1)!.id,
    potion: "Minor Health Potion",
    classItem: "",
    background: [],
    experiences: ["Sellsword", "Lockpick"],
    domainCards: cardsForDomains(cls.domains, 1).filter((c) => c.level === 1).slice(0, 2).map((c) => c.id),
    connections: [],
  };
}

async function setup(mode: "book" | "manual") {
  const t = makeTest();
  const ids = await t.run(async (ctx) => ({
    gm: await ctx.db.insert("users", { email: "gm@example.com" }),
    p1: await ctx.db.insert("users", { email: "p1@example.com" }),
  }));
  const as = (id: string) => t.withIdentity({ subject: `${id}|s` });
  const [gm, p1] = [as(ids.gm), as(ids.p1)];
  const { campaignId } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Party", idempotencyKey: key() });
  const code = await gm.mutation(api.members.rotateJoinCode, { campaignId });
  await p1.mutation(api.members.joinByCode, { code });
  const a = (await p1.mutation(api.characters.create, { campaignId, draft: draft("Mira"), idempotencyKey: key() })).characterId;
  if (mode === "manual") await gm.mutation(api.ruleSettings.set, { campaignId, change: { key: "witherTokens", value: "manual" } });
  const sheetOf = (id: Id<"characters">) => t.run(async (ctx) => readSheet((await ctx.db.get("characters", id))!.sheet));
  const ruleRows = () => t.run((ctx) => ctx.db.query("actionLog").withIndex("by_campaign_at", (q) => q.eq("campaignId", campaignId)).order("desc").take(20));
  return { t, gm, p1, campaignId, a, sheetOf, ruleRows };
}

/** Makes the next Fear Die (d12) rolls show `values` (convex/lib/dice.ts draws one Uint32 per roll). */
function fearDie(...values: number[]) {
  const original = crypto.getRandomValues.bind(crypto);
  vi.spyOn(crypto, "getRandomValues").mockImplementation(<T extends ArrayBufferView | null>(array: T): T => {
    if (array instanceof Uint32Array && array.length === 1 && values.length > 0) {
      array[0] = values.shift()! - 1;
      return array;
    }
    return original(array as never) as T;
  });
}

describe("witherOnDamage (pure)", () => {
  it("Book gains on Severe Withered damage only; the default is Book", () => {
    expect(witherOnDamage("severe", true)).toBe("gain");
    expect(witherOnDamage("severe", true, "book")).toBe("gain");
    expect(witherOnDamage("major", true)).toBe("none");
    expect(witherOnDamage("severe", false)).toBe("none");
  });

  it("Manual notes instead of gaining", () => {
    expect(witherOnDamage("severe", true, "manual")).toBe("note");
    expect(witherOnDamage("minor", true, "manual")).toBe("none");
    expect(witherOnDamage("severe", false, "manual")).toBe("none");
  });
});

describe("W1 Wither tokens rule switch", () => {
  useAllowlist(EMAILS);
  afterEach(() => vi.restoreAllMocks());

  it("Book: Severe Withered damage adds a token and rolls the Fear Die; no rule note", async () => {
    const { gm, a, sheetOf, ruleRows } = await setup("book");
    fearDie(12);
    const result = await gm.mutation(api.characters.applyDamage, { characterId: a, damage: 999, useArmorSlot: false, withered: true, idempotencyKey: key() });
    expect(result.wither).toMatchObject({ tokens: 1, fearDie: 12, scarred: false });
    expect((await sheetOf(a)).wither).toBe(1);
    const rows = await ruleRows();
    expect(rows.filter((r) => r.kind === "rule")).toEqual([]);
    expect(rows.filter((r) => r.kind === "wither")).toHaveLength(1);
  });

  it("Manual: no token, no roll; the GM gets a note, players don't", async () => {
    const { gm, p1, campaignId, a, sheetOf, ruleRows } = await setup("manual");
    const before = await sheetOf(a);
    const result = await p1.mutation(api.characters.applyDamage, { characterId: a, damage: 999, useArmorSlot: false, withered: true, idempotencyKey: key() });
    expect(result.severity).toBe("severe");
    expect(result.wither).toBeUndefined();
    const after = await sheetOf(a);
    expect(after).toMatchObject({ wither: 0, scars: before.scars });
    expect(after.hp).toBeGreaterThan(before.hp);

    const rows = await ruleRows();
    expect(rows.filter((r) => r.kind === "wither")).toEqual([]);
    const notes = rows.filter((r) => r.kind === "rule");
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      ruleId: "witherTokens",
      visibility: "gm",
      undoable: false,
      summary: "Mira took Severe damage from a Withered source: add a Wither token and roll?",
    });
    expect(notes[0].roll).toBeUndefined();

    const gmFeed = (await gm.query(api.feed.list, { campaignId, ...page })).page;
    expect(gmFeed.some((e) => e.kind === "rule")).toBe(true);
    const playerFeed = (await p1.query(api.feed.list, { campaignId, ...page })).page;
    expect(playerFeed.some((e) => e.kind === "rule")).toBe(false);
  });

  it("Manual: non-Severe or non-Withered damage posts no note", async () => {
    const { gm, a, ruleRows } = await setup("manual");
    await gm.mutation(api.characters.applyDamage, { characterId: a, damage: 1, useArmorSlot: false, withered: true, idempotencyKey: key() });
    await gm.mutation(api.characters.applyDamage, { characterId: a, damage: 999, useArmorSlot: false, idempotencyKey: key() });
    expect((await ruleRows()).filter((r) => r.kind === "rule")).toEqual([]);
  });

  it("Manual: the GM's own + Wither still adds a token and rolls", async () => {
    const { gm, campaignId, a, sheetOf } = await setup("manual");
    fearDie(12);
    const gain = await gm.mutation(api.wither.gain, { campaignId, characterId: a, idempotencyKey: key() });
    expect(gain).toMatchObject({ tokens: 1, fearDie: 12 });
    expect((await sheetOf(a)).wither).toBe(1);
  });
});
