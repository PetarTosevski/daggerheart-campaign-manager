import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, internal } from "../../convex/_generated/api";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { ANCESTRIES, ARMOR, COMMUNITIES, cardsForDomains, getClass, getDomainCard, subclassesForClass, WEAPONS } from "../../src/lib/srd/index";
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

  it("moveCard (CA4b): the GM moves and recalls for any character, logged as the GM for it; players only their own", async () => {
    const { t, gm, p1, p2, ids, campaignId } = await setup();
    const { characterId } = await p1.mutation(api.characters.create, { campaignId, draft: draft(), idempotencyKey: key() });
    // A card with a Recall Cost, owned and in the vault.
    const card = getDomainCard("bolt-beacon")!;
    expect(card.recallCost).toBeGreaterThan(0);
    await t.run(async (ctx) => {
      const s = readSheet((await ctx.db.get("characters", characterId))!.sheet);
      await saveSheet(ctx, characterId, { ...s, stress: 0, domainCards: { owned: [...s.domainCards.owned, card.id], loadout: s.domainCards.loadout } });
    });
    const strangerId = await t.run((ctx) => ctx.db.insert("users", { email: "x@example.com" }));
    const stranger = t.withIdentity({ subject: `${strangerId}|s` });
    const move = (to: "loadout" | "vault") => ({ characterId, cardId: card.id, to });
    const codeOf = (p: Promise<unknown>) => p.then(() => "ok", (e: unknown) => errorCode(e));
    const rows = () => t.run((ctx) => ctx.db.query("actionLog").collect());

    expect(await codeOf(t.mutation(api.characters.moveCard, move("loadout")))).toBe("UNAUTHENTICATED");
    expect(await codeOf(stranger.mutation(api.characters.moveCard, move("loadout")))).toBe("NOT_FOUND");
    expect(await codeOf(p2.mutation(api.characters.moveCard, move("loadout")))).toBe("FORBIDDEN");
    expect(await rows()).toEqual([]);

    // The GM recalls it: the Recall Cost is paid and the row names the GM as actor and the character.
    await gm.mutation(api.characters.moveCard, move("loadout"));
    const after = (await p1.query(api.characters.get, { characterId }))!.sheet;
    expect(after.domainCards.loadout).toContain(card.id);
    expect(after.stress).toBe(card.recallCost);
    const [recall] = await rows();
    expect(recall).toMatchObject({ actorId: ids.gm, characterId, kind: "feature", visibility: "public", undoable: true, summary: `GM for ${after.name} recalls ${card.name} (${card.recallCost} Stress)` });
    await gm.mutation(api.actionLog.undo, { entryId: recall!._id, idempotencyKey: key() });
    expect((await p1.query(api.characters.get, { characterId }))!.sheet).toMatchObject({ stress: 0 });

    // The player recalls their own: the Stress is logged with them as actor; vaulting their own card writes no row.
    await p1.mutation(api.characters.moveCard, move("loadout"));
    const mine = (await rows()).find((r) => r.actorId === ids.p1)!;
    expect(mine.summary).toBe(`${after.name} recalls ${card.name} (${card.recallCost} Stress)`);
    await p1.mutation(api.characters.moveCard, move("vault"));
    expect((await rows()).filter((r) => r.actorId === ids.p1)).toHaveLength(1);
    // The GM vaults it for them: logged.
    await gm.mutation(api.characters.moveCard, move("loadout"));
    await gm.mutation(api.characters.moveCard, move("vault"));
    expect((await rows()).some((r) => r.actorId === ids.gm && r.summary === `GM for ${after.name} vaults ${card.name}`)).toBe(true);
  });

  it("strangers can't see characters; only the GM deletes", async () => {
    const { t, gm, p1, campaignId } = await setup();
    const { characterId } = await p1.mutation(api.characters.create, { campaignId, draft: draft(), idempotencyKey: key() });
    const strangerId = await t.run((ctx) => ctx.db.insert("users", { email: "x@example.com" }));
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
    const { t, gm, p1, p2, campaignId } = await setup();
    const good = (await p1.mutation(api.characters.create, { campaignId, draft: draft(), idempotencyKey: key() })).characterId;
    const bad = (await p2.mutation(api.characters.create, { campaignId, draft: draft({ name: "Bryn" }), idempotencyKey: key() })).characterId;
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

  it("M3: from dead or away only the GM sets a character active; any change clears away", async () => {
    const { t, gm, p1, campaignId } = await setup();
    const { characterId } = await p1.mutation(api.characters.create, { campaignId, draft: draft(), idempotencyKey: key() });
    await p1.mutation(api.characters.setStatus, { characterId, status: "dead" });
    expect(errorCode(await p1.mutation(api.characters.setStatus, { characterId, status: "active" }).catch((e) => e))).toBe("FORBIDDEN");
    expect(errorCode(await p1.mutation(api.characters.setStatus, { characterId, status: "retired" }).catch((e) => e))).toBe("FORBIDDEN");
    await gm.mutation(api.characters.setStatus, { characterId, status: "active" });
    expect((await p1.query(api.characters.get, { characterId }))!.status).toBe("active");

    await t.run((ctx) => ctx.db.patch(characterId, { status: "away", away: { reason: "infirmary" } }));
    expect(errorCode(await p1.mutation(api.characters.setStatus, { characterId, status: "active" }).catch((e) => e))).toBe("FORBIDDEN");
    await gm.mutation(api.characters.setStatus, { characterId, status: "active" });
    const back = await t.run((ctx) => ctx.db.get(characterId));
    expect(back).toMatchObject({ status: "active" });
    expect(back!.away).toBeUndefined();
    // An active character's owner still retires or kills them.
    await p1.mutation(api.characters.setStatus, { characterId, status: "retired" });
  });

  it("M5: at most 50 characters per campaign", async () => {
    const { t, gm, p1, campaignId } = await setup();
    const { characterId: first } = await gm.mutation(api.characters.create, { campaignId, draft: draft(), idempotencyKey: key() });
    await t.run(async (ctx) => {
      const c = (await ctx.db.get(first))!;
      // Dead player characters: they count towards the campaign's cap only.
      for (let i = 0; i < 49; i++) {
        await ctx.db.insert("characters", { campaignId: c.campaignId, ownerId: c.ownerId, createdBy: c.createdBy, status: "dead", sheet: c.sheet, createdAt: 0, updatedAt: 0 });
      }
    });
    expect((await gm.query(api.characters.listByCampaign, { campaignId })).length).toBe(50);
    expect(errorCode(await gm.mutation(api.characters.create, { campaignId, draft: draft(), idempotencyKey: key() }).catch((e) => e))).toBe("INVALID");
    expect(errorCode(await p1.mutation(api.characters.create, { campaignId, draft: draft(), idempotencyKey: key() }).catch((e) => e))).toBe("INVALID");
  });

  it("X6: one active character per player (create and hand-over); dead and away ones don't count; the GM's own are exempt", async () => {
    const { t, gm, p1, p2, ids, campaignId } = await setup();
    const { characterId: first } = await p1.mutation(api.characters.create, { campaignId, draft: draft({ name: "First" }), idempotencyKey: key() });
    const second = await p1.mutation(api.characters.create, { campaignId, draft: draft(), idempotencyKey: key() }).catch((e) => e);
    expect(errorCode(second)).toBe("INVALID");
    expect(errorCode(await gm.mutation(api.characters.create, { campaignId, draft: draft(), ownerId: ids.p1, idempotencyKey: key() }).catch((e) => e))).toBe("INVALID");
    // Another player and the GM are unaffected; the GM holds any number of unassigned characters.
    await p2.mutation(api.characters.create, { campaignId, draft: draft(), idempotencyKey: key() });
    const { characterId: spare } = await gm.mutation(api.characters.create, { campaignId, draft: draft(), idempotencyKey: key() });
    await gm.mutation(api.characters.create, { campaignId, draft: draft(), idempotencyKey: key() });
    // Handing an active character to a player who already has one is refused; a dead one goes through.
    expect(errorCode(await gm.mutation(api.characters.assignOwner, { characterId: spare, ownerId: ids.p1 }).catch((e) => e))).toBe("INVALID");
    await gm.mutation(api.characters.setStatus, { characterId: spare, status: "dead" });
    await gm.mutation(api.characters.assignOwner, { characterId: spare, ownerId: ids.p1 });

    // Away (benched or a Castle High death move) and dead characters free the slot.
    await p1.mutation(api.characters.setStatus, { characterId: first, status: "away" });
    const { characterId: benchedNew } = await p1.mutation(api.characters.create, { campaignId, draft: draft(), idempotencyKey: key() });
    await t.run((ctx) => ctx.db.patch(benchedNew, { status: "away", away: { reason: "infirmary" } }));
    const { characterId: third } = await p1.mutation(api.characters.create, { campaignId, draft: draft(), idempotencyKey: key() });
    await p1.mutation(api.characters.setStatus, { characterId: third, status: "dead" });
    await p1.mutation(api.characters.create, { campaignId, draft: draft(), idempotencyKey: key() });
  });

  it("X6: the owner benches and brings back their own character; the GM does both for anyone", async () => {
    const { t, gm, p1, p2, campaignId } = await setup();
    const { characterId: a } = await p1.mutation(api.characters.create, { campaignId, draft: draft({ name: "Ash" }), idempotencyKey: key() });
    // Only the owner or the GM.
    expect(errorCode(await p2.mutation(api.characters.setStatus, { characterId: a, status: "away" }).catch((e) => e))).toBe("FORBIDDEN");
    await p1.mutation(api.characters.setStatus, { characterId: a, status: "away" });
    const benched = await t.run((ctx) => ctx.db.get(a));
    expect(benched).toMatchObject({ status: "away", away: { reason: "benched" } });
    // Views show a bench as `benched`, not as a death-move reason.
    const view = await p1.query(api.characters.get, { characterId: a });
    expect(view).toMatchObject({ status: "away", benched: true });
    expect(view!.away).toBeUndefined();

    // A new character takes the slot; the benched one can't come back until it is sent away.
    const { characterId: b } = await p1.mutation(api.characters.create, { campaignId, draft: draft({ name: "Brin" }), idempotencyKey: key() });
    expect(errorCode(await p1.mutation(api.characters.setStatus, { characterId: a, status: "active" }).catch((e) => e))).toBe("INVALID");
    expect(errorCode(await gm.mutation(api.characters.setStatus, { characterId: a, status: "active" }).catch((e) => e))).toBe("INVALID");
    await p1.mutation(api.characters.setStatus, { characterId: b, status: "away" });
    await p1.mutation(api.characters.setStatus, { characterId: a, status: "active" });
    const back = await t.run((ctx) => ctx.db.get(a));
    expect(back).toMatchObject({ status: "active" });
    expect(back!.away).toBeUndefined();

    // The GM benches and brings back a player's character.
    await gm.mutation(api.characters.setStatus, { characterId: a, status: "away" });
    await gm.mutation(api.characters.setStatus, { characterId: a, status: "active" });
    // Only an active character is sent away; a dead one isn't benched by anyone.
    await gm.mutation(api.characters.setStatus, { characterId: b, status: "dead" });
    expect(errorCode(await gm.mutation(api.characters.setStatus, { characterId: b, status: "away" }).catch((e) => e))).toBe("INVALID");
    expect(errorCode(await p1.mutation(api.characters.setStatus, { characterId: b, status: "away" }).catch((e) => e))).toBe("FORBIDDEN");
    // The GM's own characters are exempt: the GM brings back any number.
    const { characterId: g1 } = await gm.mutation(api.characters.create, { campaignId, draft: draft(), idempotencyKey: key() });
    await gm.mutation(api.characters.setStatus, { characterId: g1, status: "away" });
    await gm.mutation(api.characters.create, { campaignId, draft: draft(), idempotencyKey: key() });
    await gm.mutation(api.characters.setStatus, { characterId: g1, status: "active" });
  });

  it("X6: a Castle High away character returns only through the GM, and only into a free slot", async () => {
    const { t, gm, p1, campaignId } = await setup("castle-high");
    const { characterId: a } = await p1.mutation(api.characters.create, { campaignId, draft: draft(), idempotencyKey: key() });
    await t.run((ctx) => ctx.db.patch(a, { status: "away", away: { reason: "sentHome" } }));
    // The owner can't bring back a death-move away character, nor bench them.
    expect(errorCode(await p1.mutation(api.characters.setStatus, { characterId: a, status: "active" }).catch((e) => e))).toBe("FORBIDDEN");
    expect(errorCode(await p1.mutation(api.deathMoves.returnFromAway, { characterId: a, idempotencyKey: key() }).catch((e) => e))).toBe("FORBIDDEN");
    const { characterId: b } = await p1.mutation(api.characters.create, { campaignId, draft: draft(), idempotencyKey: key() });
    // The GM can't return them while the player has another active character.
    expect(errorCode(await gm.mutation(api.deathMoves.returnFromAway, { characterId: a, idempotencyKey: key() }).catch((e) => e))).toBe("INVALID");
    await p1.mutation(api.characters.setStatus, { characterId: b, status: "away" });
    await gm.mutation(api.deathMoves.returnFromAway, { characterId: a, idempotencyKey: key() });
    expect((await t.run((ctx) => ctx.db.get(a)))!.status).toBe("active");
  });

  it("M5: characters.create is rate-limited per user (30 in a burst)", async () => {
    // The GM, whose own characters count only towards the campaign's cap of 50.
    const { gm, campaignId } = await setup();
    const codes: unknown[] = [];
    for (let i = 0; i < 31; i++) {
      codes.push(await gm.mutation(api.characters.create, { campaignId, draft: draft(), idempotencyKey: key() }).then(() => "ok", (e) => errorCode(e)));
    }
    expect(codes.slice(0, 30).every((c) => c === "ok")).toBe(true);
    expect(codes[30]).toBe("RATE_LIMITED");
  });

  it("L2: applyDamage is keyed: a replay with the same key marks the damage once", async () => {
    const { p1, campaignId } = await setup();
    const { characterId } = await p1.mutation(api.characters.create, { campaignId, draft: draft(), idempotencyKey: key() });
    const k = key();
    const first = await p1.mutation(api.characters.applyDamage, { characterId, damage: 999, useArmorSlot: false, idempotencyKey: k });
    const again = await p1.mutation(api.characters.applyDamage, { characterId, damage: 999, useArmorSlot: false, idempotencyKey: k });
    expect(again).toEqual(first);
    expect((await p1.query(api.characters.get, { characterId }))!.sheet.hp).toBe(3);
    expect(
      errorCode(await p1.mutation(api.characters.applyDamage, { characterId, damage: 1, useArmorSlot: false, idempotencyKey: k }).catch((e) => e)),
    ).toBe("IDEMPOTENCY_MISMATCH");
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
