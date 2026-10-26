import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { partyLevelUp } from "../../convex/lib/partyLevelUp";
import { ANCESTRIES, ARMOR, COMMUNITIES, cardsForDomains, getClass, subclassesForClass, WEAPONS } from "../../src/lib/srd/index";
import { errorCode, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

// D10 S0: "Party levels up" moved into convex/lib/partyLevelUp.ts so S6's milestone (Q5) can run the same body.
// levelUp.partyLevelUp must behave exactly as before, and the helper must do exactly what the mutation does.

const EMAILS = "gm@example.com,p1@example.com,out@example.com";

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

/**
 * A campaign with five characters covering every branch: Ash (active, level 1), Bryn (away), Cael (active, level 10),
 * Dara (active, already flagged) and Eir (active, unreadable sheet).
 */
async function setup() {
  const t = makeTest();
  const ids = await t.run(async (ctx) => ({
    gm: await ctx.db.insert("users", { email: "gm@example.com" }),
    p1: await ctx.db.insert("users", { email: "p1@example.com" }),
    out: await ctx.db.insert("users", { email: "out@example.com" }),
  }));
  const as = (id: string) => t.withIdentity({ subject: `${id}|s` });
  const [gm, p1, out] = [as(ids.gm), as(ids.p1), as(ids.out)];
  const { campaignId } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Party", idempotencyKey: key() });
  const code = await gm.mutation(api.members.rotateJoinCode, { campaignId });
  await p1.mutation(api.members.joinByCode, { code });
  const make = async (name: string) => (await gm.mutation(api.characters.create, { campaignId, draft: draft(name), idempotencyKey: key() })).characterId;
  const chars = { ash: await make("Ash"), bryn: await make("Bryn"), cael: await make("Cael"), dara: await make("Dara"), eir: await make("Eir") };
  await t.run(async (ctx) => {
    await ctx.db.patch("characters", chars.bryn, { status: "away", away: { reason: "infirmary" } });
    const cael = readSheet((await ctx.db.get("characters", chars.cael))!.sheet);
    await saveSheet(ctx, chars.cael, { ...cael, level: 10 });
    const dara = readSheet((await ctx.db.get("characters", chars.dara))!.sheet);
    await saveSheet(ctx, chars.dara, { ...dara, levelUpPending: true });
    await ctx.db.patch("characters", chars.eir, { sheet: { broken: true } });
  });
  return { t, gm, p1, out, ids, campaignId, chars };
}

type Env = Awaited<ReturnType<typeof setup>>;

/** What a party level-up leaves behind, by character name: the pending flag and the levelUp log rows. */
async function outcome({ t, campaignId, chars }: Env) {
  return t.run(async (ctx) => {
    const flags: Record<string, unknown> = {};
    for (const [name, id] of Object.entries(chars) as [string, Id<"characters">][]) {
      const row = (await ctx.db.get("characters", id))!;
      try {
        flags[name] = readSheet(row.sheet).levelUpPending;
      } catch {
        flags[name] = "unreadable";
      }
    }
    const rows = await ctx.db
      .query("actionLog")
      .withIndex("by_campaign_at", (q) => q.eq("campaignId", campaignId))
      .collect();
    const log = rows
      .filter((row) => row.kind === "levelUp")
      .map((row) => ({ summary: row.summary, visibility: row.visibility, undoable: row.undoable, grouped: typeof row.groupId === "string" }));
    const groups = new Set(rows.filter((row) => row.kind === "levelUp").map((row) => row.groupId));
    return { flags, log, groups: groups.size };
  });
}

async function failure(run: Promise<unknown>): Promise<unknown> {
  try {
    await run;
  } catch (e) {
    return errorCode(e);
  }
  throw new Error("expected the call to fail");
}

const EXPECTED = {
  flags: { ash: true, bryn: false, cael: false, dara: true, eir: "unreadable" },
  log: [
    { summary: "Ash can level up to 2.", visibility: "public", undoable: false, grouped: true },
    { summary: "Dara can level up to 2.", visibility: "public", undoable: false, grouped: true },
  ],
  groups: 1,
};

describe("party level-up (shared helper)", () => {
  useAllowlist(EMAILS);

  it("levelUp.partyLevelUp flags active PCs below level 10, one public log row each, in one group", async () => {
    const env = await setup();
    expect(await env.gm.mutation(api.levelUp.partyLevelUp, { campaignId: env.campaignId, idempotencyKey: key() })).toEqual({ flagged: 2 });
    const result = await outcome(env);
    expect(result.flags).toEqual(EXPECTED.flags);
    expect([...result.log].sort((a, b) => a.summary.localeCompare(b.summary))).toEqual(EXPECTED.log);
    expect(result.groups).toBe(EXPECTED.groups);
  });

  it("the helper does exactly what the mutation does", async () => {
    const viaMutation = await setup();
    await viaMutation.gm.mutation(api.levelUp.partyLevelUp, { campaignId: viaMutation.campaignId, idempotencyKey: key() });
    const viaHelper = await setup();
    const result = await viaHelper.t.run((ctx) => partyLevelUp(ctx, viaHelper.campaignId, viaHelper.ids.gm));
    expect(result).toEqual({ flagged: 2 });
    const sort = (o: Awaited<ReturnType<typeof outcome>>) => ({ ...o, log: [...o.log].sort((a, b) => a.summary.localeCompare(b.summary)) });
    expect(sort(await outcome(viaHelper))).toEqual(sort(await outcome(viaMutation)));
  });

  it("is idempotent per key: a retry with the same key flags nothing again", async () => {
    const env = await setup();
    const idempotencyKey = key();
    const first = await env.gm.mutation(api.levelUp.partyLevelUp, { campaignId: env.campaignId, idempotencyKey });
    const again = await env.gm.mutation(api.levelUp.partyLevelUp, { campaignId: env.campaignId, idempotencyKey });
    expect(again).toEqual(first);
    expect((await outcome(env)).log).toHaveLength(2);
  });

  it("anonymous, outsider and player are refused; the GM may", async () => {
    const env = await setup();
    const args = () => ({ campaignId: env.campaignId, idempotencyKey: key() });
    expect(await failure(env.t.mutation(api.levelUp.partyLevelUp, args()))).toBe("UNAUTHENTICATED");
    expect(await failure(env.out.mutation(api.levelUp.partyLevelUp, args()))).toBe("NOT_FOUND");
    expect(await failure(env.p1.mutation(api.levelUp.partyLevelUp, args()))).toBe("FORBIDDEN");
    expect(await env.gm.mutation(api.levelUp.partyLevelUp, args())).toEqual({ flagged: 2 });
  });
});
