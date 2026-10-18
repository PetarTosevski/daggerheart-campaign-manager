import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import { ANCESTRIES, ARMOR, COMMUNITIES, cardsForDomains, getClass, subclassesForClass, WEAPONS } from "../../src/lib/srd/index";
import { errorCode, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

const EMAILS = "gm@example.com,p1@example.com,p2@example.com,out@example.com";

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

/** A Witherwild campaign with a GM and two players; p1 owns the active Ash. */
async function setup() {
  const t = makeTest();
  const ids = await t.run(async (ctx) => ({
    gm: await ctx.db.insert("users", { email: "gm@example.com" }),
    p1: await ctx.db.insert("users", { email: "p1@example.com" }),
    p2: await ctx.db.insert("users", { email: "p2@example.com" }),
    out: await ctx.db.insert("users", { email: "out@example.com" }),
  }));
  const as = (id: string) => t.withIdentity({ subject: `${id}|s` });
  const [gm, p1, p2] = [as(ids.gm), as(ids.p1), as(ids.p2)];
  const { campaignId } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Party", idempotencyKey: key() });
  const code = await gm.mutation(api.members.rotateJoinCode, { campaignId });
  await p1.mutation(api.members.joinByCode, { code });
  await p2.mutation(api.members.joinByCode, { code });
  const ash = (await p1.mutation(api.characters.create, { campaignId, draft: draft("Ash"), idempotencyKey: key() })).characterId;
  const create = (who: typeof gm, name: string) => codeOf(who.mutation(api.characters.create, { campaignId, draft: draft(name), idempotencyKey: key() }));
  const allow = (value: boolean) => gm.mutation(api.sessions.allowExtraCharacters, { campaignId, allow: value, idempotencyKey: key() });
  const start = () => gm.mutation(api.sessions.start, { campaignId, idempotencyKey: key() });
  const end = () => gm.mutation(api.sessions.end, { campaignId, idempotencyKey: key() });
  const active = async (owner: typeof ids.p1) =>
    (await gm.query(api.characters.listByCampaign, { campaignId })).filter((c) => c.ownerId === owner && c.status === "active").map((c) => c.sheet.name);
  return { gm, p1, p2, ids, campaignId, ash, create, allow, start, end, active };
}

async function codeOf(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return errorCode(e);
  }
}

describe("XC1: extra active characters for the current session", () => {
  useAllowlist(EMAILS);

  it("a running session without the allowance keeps one active character per player", async () => {
    const { p1, create, start } = await setup();
    await start();
    expect(await create(p1, "Birch")).toBe("INVALID");
  });

  it("while allowed: create, bring back and hand-over skip the rule; after End the extras stay and the rule applies again", async () => {
    const { gm, p1, p2, ids, campaignId, ash, create, allow, start, end, active } = await setup();
    await start();
    await allow(true);
    expect(await create(p1, "Birch")).toBe("ok");
    expect(await active(ids.p1)).toEqual(["Ash", "Birch"]);

    // Bench and bring back, and a hand-over onto a player who already has one.
    await p1.mutation(api.characters.setStatus, { characterId: ash, status: "away" });
    await p1.mutation(api.characters.setStatus, { characterId: ash, status: "active" });
    const cedar = (await p2.mutation(api.characters.create, { campaignId, draft: draft("Cedar"), idempotencyKey: key() })).characterId;
    await gm.mutation(api.characters.assignOwner, { characterId: cedar, ownerId: ids.p1 });
    expect(await active(ids.p1)).toEqual(["Ash", "Birch", "Cedar"]);

    await end();
    expect(await active(ids.p1)).toEqual(["Ash", "Birch", "Cedar"]);
    expect(await create(p1, "Dune")).toBe("INVALID");
    await p1.mutation(api.characters.setStatus, { characterId: ash, status: "away" });
    expect(await codeOf(p1.mutation(api.characters.setStatus, { characterId: ash, status: "active" }))).toBe("INVALID");

    // A new session doesn't inherit the allowance.
    await start();
    expect(await create(p1, "Dune")).toBe("INVALID");
  });

  it("switching it off mid-session restores the rule", async () => {
    const { p1, create, allow, start } = await setup();
    await start();
    await allow(true);
    await allow(false);
    expect(await create(p1, "Birch")).toBe("INVALID");
  });
});
