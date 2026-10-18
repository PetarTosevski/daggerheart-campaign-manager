import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { MAX_CUSTOM } from "../../convex/lib/encounters";
import { blank, fromSrd, validateCustom } from "../../src/lib/adversaries/custom";
import { ADVERSARIES } from "../../src/lib/srd/adversaries";
import { errorCode, key, OTHER_EMAIL, setupWithCampaign, useAllowlist } from "./helpers";

// D8 A5: custom adversaries. GM-only: anonymous UNAUTHENTICATED, outsider NOT_FOUND, player FORBIDDEN, for every
// function (TE2's matrix does not exist yet; hardening H25 folds these rows in).

type Setup = Awaited<ReturnType<typeof setupWithCampaign>>;
type Client = Setup["gm"];

const BEAR = ADVERSARIES.find((a) => a.id === "bear")!;
/** The editable fields only (validateCustom returns a fresh object without `basedOn`). */
const BEAR_COPY = validateCustom(fromSrd(BEAR));

const code = (p: Promise<unknown>) => p.then(() => "ok", (e: unknown) => errorCode(e));

async function withCustom() {
  const ctx = await setupWithCampaign();
  const create = (adversary = BEAR_COPY, client: Client = ctx.gm, basedOn: string | null = "bear") =>
    client.mutation(api.customAdversaries.create, { campaignId: ctx.campaignId, adversary, ...(basedOn ? { basedOn } : {}), idempotencyKey: key() });
  const list = () => ctx.gm.query(api.customAdversaries.list, { campaignId: ctx.campaignId });
  const { customId } = await create({ ...BEAR_COPY, name: "Cave Bear" });
  return { ...ctx, customId, create, list };
}

function calls(campaignId: Id<"campaigns">, customId: string) {
  return {
    list: (c: Client) => c.query(api.customAdversaries.list, { campaignId }),
    create: (c: Client) => c.mutation(api.customAdversaries.create, { campaignId, adversary: BEAR_COPY, idempotencyKey: key() }),
    update: (c: Client) => c.mutation(api.customAdversaries.update, { campaignId, customId, patch: { hp: 9 } }),
    remove: (c: Client) => c.mutation(api.customAdversaries.remove, { campaignId, customId }),
  };
}

describe("customAdversaries: access", () => {
  useAllowlist();

  it("refuses anonymous callers, outsiders and players on every function, and lets the GM run each", async () => {
    const { t, gm, other, campaignId, customId } = await withCustom();
    const all = calls(campaignId, customId);
    const names = Object.keys(all) as (keyof typeof all)[];
    expect(names).toHaveLength(4);
    for (const name of names) expect([name, await code(all[name](t as unknown as Client))]).toEqual([name, "UNAUTHENTICATED"]);
    for (const name of names) expect([name, await code(all[name](other))]).toEqual([name, "NOT_FOUND"]);
    await gm.mutation(api.members.invite, { campaignId, email: OTHER_EMAIL });
    for (const name of names) expect([name, await code(all[name](other))]).toEqual([name, "FORBIDDEN"]);
    for (const name of names) expect([name, await code(all[name](gm))]).toEqual([name, "ok"]);
  });

  it("gives NOT_FOUND for another campaign's custom id and for a malformed id", async () => {
    const a = await withCustom();
    const { campaignId: mine } = await a.gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Other", idempotencyKey: key() });
    const cross = calls(mine, a.customId);
    expect(await a.gm.query(api.customAdversaries.list, { campaignId: mine })).toEqual([]);
    for (const name of ["update", "remove"] as const) expect([name, await code(cross[name](a.gm))]).toEqual([name, "NOT_FOUND"]);
    expect(await code(a.gm.mutation(api.customAdversaries.update, { campaignId: a.campaignId, customId: "nope", patch: { hp: 3 } }))).toBe("NOT_FOUND");
  });
});

describe("customAdversaries: editing", () => {
  useAllowlist();

  it("creates a duplicate with its origin, lists by name, and creates a blank one", async () => {
    const { create, list } = await withCustom();
    await create(blank(3, "Solo"), undefined, null);
    const rows = await list();
    expect(rows.map((r) => [r.name, r.tier, r.type, r.basedOn])).toEqual([
      ["Cave Bear", 1, "Bruiser", "bear"],
      ["New adversary", 3, "Solo", undefined],
    ]);
    expect(rows[0]).toMatchObject({ hp: 7, stress: 2, difficulty: 14, thresholds: { major: 9, severe: 17 } });
    expect(rows[1]).toMatchObject({ difficulty: 17, thresholds: { major: 20, severe: 32 }, attack: { modifier: 3 } });
  });

  it("applies a create once per idempotency key and refuses an unknown origin", async () => {
    const { gm, campaignId, list, create } = await withCustom();
    const args = { campaignId, adversary: { ...BEAR_COPY, name: "Twice" }, idempotencyKey: key() };
    const first = await gm.mutation(api.customAdversaries.create, args);
    expect(await gm.mutation(api.customAdversaries.create, args)).toEqual(first);
    expect((await list()).filter((r) => r.name === "Twice")).toHaveLength(1);
    expect(await code(create(BEAR_COPY, gm, "no-such-adversary"))).toBe("ADVERSARY_UNKNOWN");
  });

  it("validates names, numbers, lists and text lengths with ENCOUNTER_RULE", async () => {
    const { create } = await withCustom();
    const bad = [
      { name: " " },
      { name: "x".repeat(81) },
      { hp: 0 },
      { hp: 31 },
      { stress: 21 },
      { stress: -1 },
      { tier: 5 },
      { difficulty: 2.5 },
      { thresholds: { major: 17, severe: 9 } },
      { description: "x".repeat(2001) },
      { attack: { ...BEAR_COPY.attack, range: "Next door" } },
      { features: Array.from({ length: 21 }, (_, i) => ({ name: `F${i}`, kind: "passive" as const, text: "" })) },
      { features: [{ name: "Long", kind: "action" as const, text: "x".repeat(2001) }] },
      { experiences: Array.from({ length: 7 }, (_, i) => ({ name: `E${i}`, value: 1 })) },
    ];
    for (const patch of bad) expect([patch, await code(create({ ...BEAR_COPY, ...patch }))]).toEqual([patch, "ENCOUNTER_RULE"]);
    // Every SRD stat block can be duplicated and saved, the longest feature text included.
    expect(await code(create(validateCustom(fromSrd(ADVERSARIES.find((a) => a.id === "gobstalker")!))))).toBe("ok");
  });

  it(`refuses a custom adversary past ${MAX_CUSTOM} with CUSTOM_ADVERSARY_LIMIT`, async () => {
    const { t, campaignId, create } = await withCustom();
    await t.run(async (ctx) => {
      for (let i = 1; i < MAX_CUSTOM; i++) await ctx.db.insert("customAdversaries", { campaignId, ...BEAR_COPY, name: `Bear ${i}`, createdAt: i, updatedAt: i });
    });
    expect(await code(create())).toBe("CUSTOM_ADVERSARY_LIMIT");
  });

  it("updates only the sent fields, clears hordePerHp, and checks the merged block", async () => {
    const { gm, campaignId, customId, list } = await withCustom();
    const update = (patch: Record<string, unknown>) => gm.mutation(api.customAdversaries.update, { campaignId, customId, patch });
    await update({ hp: 9, name: " Cave Bear " });
    expect((await list())[0]).toMatchObject({ name: "Cave Bear", hp: 9, stress: 2, basedOn: "bear", motives: BEAR.motives });
    await update({ type: "Horde", hordePerHp: 3 });
    expect((await list())[0]).toMatchObject({ type: "Horde", hordePerHp: 3 });
    await update({ type: "Bruiser" });
    expect((await list())[0]!.hordePerHp).toBeUndefined();
    await update({ type: "Horde", hordePerHp: 2 });
    await update({ hordePerHp: null });
    expect((await list())[0]!.hordePerHp).toBeUndefined();
    await update({ features: [{ name: "Thick Hide", kind: "passive", text: "Resists physical damage." }] });
    expect((await list())[0]!.features).toEqual([{ name: "Thick Hide", kind: "passive", text: "Resists physical damage." }]);
    expect(await code(update({ thresholds: { major: 20, severe: 10 } }))).toBe("ENCOUNTER_RULE");
    expect(await code(update({ hp: 0 }))).toBe("ENCOUNTER_RULE");
  });
});

describe("customAdversaries: encounters", () => {
  useAllowlist();

  it("adds this campaign's custom adversary to an encounter, and refuses another campaign's (ADVERSARY_UNKNOWN)", async () => {
    const { gm, campaignId, customId } = await withCustom();
    await gm.mutation(api.customAdversaries.update, { campaignId, customId, patch: { hp: 9 } });
    const { encounterId } = await gm.mutation(api.encounters.create, { campaignId, name: "Den", idempotencyKey: key() });
    const add = (target: Id<"campaigns">, encounter: string, id: Id<"customAdversaries">) =>
      gm.mutation(api.encounters.addAdversary, {
        campaignId: target,
        encounterId: encounter,
        source: { kind: "custom", customId: id },
        count: 1,
        summoned: false,
        idempotencyKey: key(),
      });
    await add(campaignId, encounterId, customId);
    const view = (await gm.query(api.encounters.get, { campaignId, encounterId }))!;
    expect(view.instances.map((i) => [i.label, i.name, i.stats.hpMax])).toEqual([["Cave Bear", "Cave Bear", 9]]);

    const { campaignId: other } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Other", idempotencyKey: key() });
    const { encounterId: otherEncounter } = await gm.mutation(api.encounters.create, { campaignId: other, name: "Elsewhere", idempotencyKey: key() });
    expect(await code(add(other, otherEncounter, customId))).toBe("ADVERSARY_UNKNOWN");
  });

  it("refuses to delete a custom adversary the running encounter uses; drafts keep their snapshot", async () => {
    const { gm, campaignId, customId, list } = await withCustom();
    const { encounterId } = await gm.mutation(api.encounters.create, { campaignId, name: "Den", idempotencyKey: key() });
    await gm.mutation(api.encounters.addAdversary, {
      campaignId,
      encounterId,
      source: { kind: "custom", customId },
      count: 2,
      summoned: false,
      idempotencyKey: key(),
    });
    await gm.mutation(api.encounters.start, { campaignId, encounterId });
    const remove = () => gm.mutation(api.customAdversaries.remove, { campaignId, customId });
    expect(await code(remove())).toBe("ENCOUNTER_RULE");
    await gm.mutation(api.encounters.end, { campaignId, encounterId });
    expect(await code(remove())).toBe("ok");
    expect(await list()).toEqual([]);
    const view = (await gm.query(api.encounters.get, { campaignId, encounterId }))!;
    expect(view.instances.map((i) => [i.label, i.name, i.stats.hpMax])).toEqual([
      ["Cave Bear", null, 7],
      ["Cave Bear 2", null, 7],
    ]);
  });
});
