import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, internal } from "../../convex/_generated/api";
import { ANCESTRIES, ARMOR, COMMUNITIES, cardsForDomains, getClass, subclassesForClass, WEAPONS } from "../../src/lib/srd/index";
import { errorCode, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

function draft(overrides: Record<string, unknown> = {}) {
  const cls = getClass("warrior")!;
  const sub = subclassesForClass("warrior")[0];
  const cards = cardsForDomains(cls.domains, 1).filter((c) => c.level === 1).slice(0, 2).map((c) => c.id);
  const primary = WEAPONS.find((w) => w.slot === "primary" && w.tier === 1 && w.source === "core" && w.category === "physical" && !w.classId)!;
  return {
    classId: cls.id,
    subclassId: sub.id,
    ancestry: { kind: "single", id: ANCESTRIES.find((a) => a.source === "core")!.id },
    communityId: COMMUNITIES.find((c) => c.source === "core")!.id,
    traits: { agility: 2, strength: 1, finesse: 1, instinct: 0, presence: 0, knowledge: -1 },
    name: "Ash",
    pronouns: "they/them",
    description: "",
    primaryWeaponId: primary.id,
    armorId: ARMOR.find((a) => a.source === "core" && a.tier === 1)!.id,
    potion: "Minor Health Potion",
    classItem: "",
    background: [],
    experiences: ["Sellsword", "Lockpick"],
    domainCards: cards,
    connections: [],
    ...overrides,
  };
}

async function setup(frameId: "witherwild" | "castle-high" = "witherwild") {
  const t = makeTest();
  const ids = await t.run(async (ctx) => ({
    gm: await ctx.db.insert("users", { email: "gm@example.com" }),
    p1: await ctx.db.insert("users", { email: "p1@example.com" }),
    p2: await ctx.db.insert("users", { email: "p2@example.com" }),
  }));
  const as = (id: string) => t.withIdentity({ subject: `${id}|s` });
  const gm = as(ids.gm);
  const p1 = as(ids.p1);
  const p2 = as(ids.p2);
  const { campaignId } = await gm.mutation(api.campaigns.create, { frameId, name: "Party", idempotencyKey: key() });
  const code = await gm.mutation(api.members.rotateJoinCode, { campaignId });
  await p1.mutation(api.members.joinByCode, { code });
  await p2.mutation(api.members.joinByCode, { code });
  return { t, ids, gm, p1, p2, campaignId };
}

describe("characters", () => {
  useAllowlist("gm@example.com,p1@example.com,p2@example.com");

  it("a player creates their own character with the class's starting values", async () => {
    const { p1, ids, campaignId } = await setup();
    const { characterId } = await p1.mutation(api.characters.create, { campaignId, draft: draft(), idempotencyKey: key() });
    const c = await p1.query(api.characters.get, { characterId });
    const cls = getClass("warrior")!;
    expect(c).toMatchObject({ ownerId: ids.p1, canEdit: true, mine: true, status: "active" });
    expect(c!.sheet).toMatchObject({
      level: 1,
      evasion: cls.startingEvasion,
      hpMax: cls.startingHp,
      stressMax: 6,
      hope: 2,
      proficiency: 1,
      gold: { handfuls: 1, bags: 0, chest: false },
      experiences: [
        { name: "Sellsword", value: 2 },
        { name: "Lockpick", value: 2 },
      ],
    });
    expect(c!.sheet.domainCards.loadout).toHaveLength(2);
    expect(c!.sheet.inventory.map((i) => i.name)).toContain("Minor Health Potion");
  });

  it("rejects an invalid trait spread, wrong domain cards, and missing steps", async () => {
    const { p1, campaignId } = await setup();
    const bad = [
      draft({ traits: { agility: 2, strength: 2, finesse: 1, instinct: 0, presence: 0, knowledge: -1 } }),
      draft({ domainCards: ["not-a-card", "also-not"] }),
      draft({ name: " " }),
      draft({ experiences: ["One", ""] }),
    ];
    for (const d of bad) {
      expect(errorCode(await p1.mutation(api.characters.create, { campaignId, draft: d, idempotencyKey: key() }).catch((e) => e))).toBe(
        "INVALID",
      );
    }
  });

  it("refuses Hope & Fear content unless the campaign uses it", async () => {
    const { gm, p1, campaignId } = await setup("witherwild");
    const witch = getClass("witch")!;
    const hf = draft({
      classId: "witch",
      subclassId: subclassesForClass("witch")[0].id,
      domainCards: cardsForDomains(witch.domains, 1).filter((c) => c.level === 1).slice(0, 2).map((c) => c.id),
      primaryWeaponId: WEAPONS.find((w) => w.slot === "primary" && w.tier === 1 && w.source === "core" && w.category === "magic")!.id,
    });
    expect(errorCode(await p1.mutation(api.characters.create, { campaignId, draft: hf, idempotencyKey: key() }).catch((e) => e))).toBe(
      "INVALID",
    );
    await gm.mutation(api.campaigns.setOption, { campaignId, option: "hopeAndFear", enabled: true });
    await p1.mutation(api.characters.create, { campaignId, draft: hf, idempotencyKey: key() });
  });

  it("everyone reads every sheet; only the owner and the GM edit", async () => {
    const { gm, p1, p2, campaignId } = await setup();
    const { characterId } = await p1.mutation(api.characters.create, { campaignId, draft: draft(), idempotencyKey: key() });
    const seen = await p2.query(api.characters.listByCampaign, { campaignId });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ canEdit: false, mine: false });
    expect(seen[0].sheet.traits.agility).toBe(2);
    expect(errorCode(await p2.mutation(api.characters.updateSheet, { characterId, patch: { notes: "x" } }).catch((e) => e))).toBe(
      "FORBIDDEN",
    );
    await gm.mutation(api.characters.updateSheet, { characterId, patch: { notes: "GM note" } });
    await p1.mutation(api.characters.updateSheet, { characterId, patch: { pronouns: "she/her" } });
    const c = await p1.query(api.characters.get, { characterId });
    expect(c!.sheet).toMatchObject({ notes: "GM note", pronouns: "she/her" });
  });

  it("the GM creates a character for a player and can hand it over", async () => {
    const { gm, p1, ids, campaignId } = await setup();
    const { characterId } = await gm.mutation(api.characters.create, { campaignId, draft: draft(), ownerId: ids.p1, idempotencyKey: key() });
    expect((await p1.query(api.characters.get, { characterId }))!.mine).toBe(true);
    await gm.mutation(api.characters.assignOwner, { characterId, ownerId: ids.gm });
    expect((await p1.query(api.characters.get, { characterId }))!.canEdit).toBe(false);
    expect(
      errorCode(await p1.mutation(api.characters.create, { campaignId, draft: draft(), ownerId: ids.gm, idempotencyKey: key() }).catch((e) => e)),
    ).toBe("FORBIDDEN");
  });

  it("Stress beyond full marks exactly one Hit Point; Hope is capped by scars", async () => {
    const { p1, campaignId } = await setup();
    const { characterId } = await p1.mutation(api.characters.create, { campaignId, draft: draft(), idempotencyKey: key() });
    await p1.mutation(api.characters.adjustResource, { characterId, resource: "stress", delta: 5 });
    const r = await p1.mutation(api.characters.adjustResource, { characterId, resource: "stress", delta: 3 });
    expect(r).toMatchObject({ stress: 6, hp: 1 });
    await p1.mutation(api.characters.adjustResource, { characterId, resource: "hope", delta: 6 });
    const s = await p1.mutation(api.characters.adjustResource, { characterId, resource: "scars", delta: 2 });
    expect(s).toMatchObject({ scars: 2, hope: 4 });
  });

  it("vaulted cards cost their Recall Cost in Stress to bring back, except during a rest", async () => {
    const { p1, campaignId } = await setup();
    const { characterId } = await p1.mutation(api.characters.create, { campaignId, draft: draft(), idempotencyKey: key() });
    const card = (await p1.query(api.characters.get, { characterId }))!.sheet.domainCards.loadout[0];
    await p1.mutation(api.characters.moveCard, { characterId, cardId: card, to: "vault" });
    await p1.mutation(api.characters.moveCard, { characterId, cardId: card, to: "loadout", duringRest: true });
    const c = await p1.query(api.characters.get, { characterId });
    expect(c!.sheet.domainCards.loadout).toContain(card);
    expect(c!.sheet.stress).toBe(0);
  });

  it("strangers can't see characters; only the GM deletes", async () => {
    const { t, gm, p1, campaignId } = await setup();
    const { characterId } = await p1.mutation(api.characters.create, { campaignId, draft: draft(), idempotencyKey: key() });
    const strangerId = await t.run((ctx) => ctx.db.insert("users", { email: "x@example.com" }));
    process.env.ALLOWED_EMAILS += ",x@example.com";
    const stranger = t.withIdentity({ subject: `${strangerId}|s` });
    expect(await stranger.query(api.characters.get, { characterId })).toBeNull();
    expect(errorCode(await p1.mutation(api.characters.remove, { characterId }).catch((e) => e))).toBe("FORBIDDEN");
    await gm.mutation(api.characters.remove, { characterId });
    expect(await gm.query(api.characters.listByCampaign, { campaignId })).toEqual([]);
  });

  it("portraits: only images, a file can't be reused by another character, and only own uploads are deleted", async () => {
    const { t, p1, p2, campaignId } = await setup();
    const a = (await p1.mutation(api.characters.create, { campaignId, draft: draft(), idempotencyKey: key() })).characterId;
    const b = (await p2.mutation(api.characters.create, { campaignId, draft: draft({ name: "Bryn" }), idempotencyKey: key() })).characterId;
    const image = await t.run((ctx) => ctx.storage.store(new Blob(["png"], { type: "image/png" })));
    const text = await t.run((ctx) => ctx.storage.store(new Blob(["hi"], { type: "text/plain" })));

    // convex-test records no content type, so a stored file always fails the image check here
    // (production uploads carry it); attach the image the way attachPortrait would.
    // A rejected file is reported and deleted (a throw would roll the deletion back).
    expect(await p1.mutation(api.characters.attachPortrait, { characterId: a, storageId: text })).toEqual({ error: expect.any(String) });
    expect(await t.run((ctx) => ctx.storage.get(text))).toBeNull();
    await t.run(async (ctx) => {
      const c = (await ctx.db.get(a))!;
      await ctx.db.insert("files", { storageId: image, campaignId: c.campaignId, uploadedBy: c.ownerId, kind: "portrait", refId: a, createdAt: 0 });
      await ctx.db.patch(a, { sheet: { ...c.sheet, portrait: { kind: "upload", storageId: image } } });
    });
    expect((await p1.query(api.characters.get, { characterId: a }))!.portraitUrl).toEqual(expect.any(String));
    // Other players get the URL but never the storage id (the owner and the GM get the id to edit).
    const seen = (await p2.query(api.characters.get, { characterId: a }))!;
    expect(seen.portraitUrl).toEqual(expect.any(String));
    expect(seen.sheet.portrait).toEqual({ kind: "upload", storageId: "hidden" });
    expect(JSON.stringify(await p2.query(api.characters.listByCampaign, { campaignId }))).not.toContain(image);
    expect((await p1.query(api.characters.get, { characterId: a }))!.sheet.portrait).toEqual({ kind: "upload", storageId: image });

    // Another player can't claim or point at that file.
    expect(errorCode(await p2.mutation(api.characters.attachPortrait, { characterId: b, storageId: image }).catch((e) => e))).toBe("NOT_FOUND");
    expect(
      errorCode(
        await p2
          .mutation(api.characters.updateSheet, { characterId: b, patch: { portrait: { kind: "upload", storageId: image } } })
          .catch((e) => e),
      ),
    ).toBe("INVALID");
    // Switching to design art deletes the character's own upload.
    await p1.mutation(api.characters.updateSheet, {
      characterId: a,
      patch: { portrait: { kind: "asset", asset: "0".repeat(32) } },
    });
    expect(await t.run((ctx) => ctx.storage.getUrl(image))).toBeNull();
  });

  it("stores a versioned sheet whose inventory items and Experiences carry ids", async () => {
    const { t, p1, campaignId } = await setup();
    const { characterId } = await p1.mutation(api.characters.create, { campaignId, draft: draft(), idempotencyKey: key() });
    const stored = await t.run(async (ctx) => (await ctx.db.get(characterId))!.sheet);
    expect(stored.schemaVersion).toBe(2);
    const ids = [...stored.inventory, ...stored.experiences].map((x: { id: string }) => x.id);
    expect(ids.every((id) => typeof id === "string" && id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("one corrupt sheet doesn't fail the party list: it comes back marked, the rest as usual", async () => {
    const { t, gm, p1, campaignId } = await setup();
    const good = (await p1.mutation(api.characters.create, { campaignId, draft: draft(), idempotencyKey: key() })).characterId;
    const bad = (await p1.mutation(api.characters.create, { campaignId, draft: draft({ name: "Bryn" }), idempotencyKey: key() })).characterId;
    await t.run(async (ctx) => {
      const c = (await ctx.db.get(bad))!;
      await ctx.db.patch(bad, { sheet: { ...c.sheet, hp: "lots" } });
    });
    const list = await gm.query(api.characters.listByCampaign, { campaignId });
    expect(list).toHaveLength(2);
    expect(list.find((c) => c._id === good)).toMatchObject({ canEdit: true, sheet: { name: "Ash" } });
    expect(list.find((c) => c._id === good)!.corrupt).toBeUndefined();
    expect(list.find((c) => c._id === bad)).toMatchObject({ corrupt: true, canEdit: false, sheet: { name: "Bryn" } });
    // Reading or editing the corrupt one alone still says so.
    expect(errorCode(await gm.query(api.characters.get, { characterId: bad }).catch((e) => e))).toBe("CHARACTER_CORRUPT");
    expect(errorCode(await gm.mutation(api.characters.addInventory, { characterId: bad, name: "Rope" }).catch((e) => e))).toBe("CHARACTER_CORRUPT");
    // A sheet from an unknown future version is corrupt too.
    await t.run(async (ctx) => {
      const c = (await ctx.db.get(good))!;
      await ctx.db.patch(good, { sheet: { ...c.sheet, schemaVersion: 99 } });
    });
    expect((await gm.query(api.characters.listByCampaign, { campaignId })).every((c) => c.corrupt)).toBe(true);
  });

  it("portraitUploadUrl is rate-limited per user", async () => {
    const { p1, campaignId } = await setup();
    const { characterId } = await p1.mutation(api.characters.create, { campaignId, draft: draft(), idempotencyKey: key() });
    const codes: unknown[] = [];
    for (let i = 0; i < 21; i++) {
      codes.push(await p1.mutation(api.characters.portraitUploadUrl, { characterId }).then(() => "ok", (e) => errorCode(e)));
    }
    expect(codes.slice(0, 20).every((c) => c === "ok")).toBe(true);
    expect(codes[20]).toBe("RATE_LIMITED");
  });

  it("players can't see an uploaded portrait's storage id in get or listByCampaign", async () => {
    const { t, p1, p2, campaignId } = await setup();
    const { characterId } = await p1.mutation(api.characters.create, { campaignId, draft: draft(), idempotencyKey: key() });
    const image = await t.run((ctx) => ctx.storage.store(new Blob(["png"], { type: "image/png" })));
    await t.run(async (ctx) => {
      const c = (await ctx.db.get(characterId))!;
      await ctx.db.insert("files", { storageId: image, campaignId: c.campaignId, uploadedBy: c.ownerId, kind: "portrait", refId: characterId, createdAt: 0 });
      await ctx.db.patch(characterId, { sheet: { ...c.sheet, portrait: { kind: "upload", storageId: image } } });
    });
    for (const seen of [await p2.query(api.characters.get, { characterId }), ...(await p2.query(api.characters.listByCampaign, { campaignId }))]) {
      expect(seen!.sheet.portrait).toEqual({ kind: "upload", storageId: "hidden" });
      expect(seen!.portraitUrl).toEqual(expect.any(String));
    }
  });
});

describe("migrations/characters:versionSheets", () => {
  useAllowlist("gm@example.com,p1@example.com,p2@example.com");
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("backfills schemaVersion and the ids an unmigrated read already showed; skips corrupt sheets; is idempotent", async () => {
    const { t, gm, p1, campaignId } = await setup();
    const { characterId } = await p1.mutation(api.characters.create, { campaignId, draft: draft(), idempotencyKey: key() });
    // Rewrite it as a version 1 sheet: no schemaVersion, string inventory, Experiences without ids.
    const corruptId = await t.run(async (ctx) => {
      const c = (await ctx.db.get(characterId))!;
      const { schemaVersion: _version, ...rest } = c.sheet;
      void _version;
      await ctx.db.patch(characterId, {
        sheet: {
          ...rest,
          inventory: ["Torch", "Rope"],
          experiences: [
            { name: "Sellsword", value: 2 },
            { name: "Lockpick", value: 3 },
          ],
        },
      });
      const { campaignId: cid, ownerId, createdBy } = c;
      return ctx.db.insert("characters", { campaignId: cid, ownerId, createdBy, status: "active", sheet: { name: "Broken" }, createdAt: 0, updatedAt: 0 });
    });
    const before = (await gm.query(api.characters.get, { characterId }))!.sheet;
    expect(before.inventory).toEqual([
      { id: "inv-0", name: "Torch" },
      { id: "inv-1", name: "Rope" },
    ]);
    expect(before.experiences).toEqual([
      { id: "exp-0", name: "Sellsword", value: 2 },
      { id: "exp-1", name: "Lockpick", value: 3 },
    ]);

    await t.mutation(internal.migrations.characters.versionSheets, { batchSize: 1 });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const stored = await t.run(async (ctx) => (await ctx.db.get(characterId))!.sheet);
    expect(stored).toMatchObject({ schemaVersion: 2, inventory: before.inventory, experiences: before.experiences });
    expect((await gm.query(api.characters.get, { characterId }))!.sheet).toEqual(before);
    expect(await t.run(async (ctx) => (await ctx.db.get(corruptId))!.sheet)).toEqual({ name: "Broken" });

    await t.mutation(internal.migrations.characters.versionSheets, { reset: true });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.run(async (ctx) => (await ctx.db.get(characterId))!.sheet)).toEqual(stored);
  });
});
