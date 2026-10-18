import { describe, expect, it, vi } from "vitest";

import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { emptyEntry } from "../../src/lib/codex/schema";
import { initialMapState, type MapToken } from "../../src/lib/world/map-state";
import { errorCode, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

async function setup(frameId: "witherwild" | "beast-feast" = "witherwild") {
  const t = makeTest();
  const ids = await t.run(async (ctx) => ({
    gm: await ctx.db.insert("users", { email: "gm@example.com" }),
    p1: await ctx.db.insert("users", { email: "p1@example.com" }),
    out: await ctx.db.insert("users", { email: "out@example.com" }),
  }));
  const as = (id: string) => t.withIdentity({ subject: `${id}|s` });
  const gm = as(ids.gm);
  const p1 = as(ids.p1);
  const out = as(ids.out);
  const { campaignId } = await gm.mutation(api.campaigns.create, { frameId, name: "Codex", idempotencyKey: key() });
  const code = await gm.mutation(api.members.rotateJoinCode, { campaignId });
  await p1.mutation(api.members.joinByCode, { code });
  return { t, ids, gm, p1, out, campaignId };
}

type T = Awaited<ReturnType<typeof setup>>["t"];

const fail = (p: Promise<unknown>) => p.catch((e: unknown) => e);

function token(id: number, over: Partial<MapToken> = {}): MapToken {
  return { id, type: "landmark", x: 55, y: 40, name: `Pin ${id}`, notes: "", hidden: false, location: true, ...over };
}

/** The map's markers as rows (a split, version 2 map), replacing any there. */
async function putTokens(t: T, campaignId: Id<"campaigns">, tokens: MapToken[]) {
  await t.run(async (ctx) => {
    const rows = await ctx.db
      .query("mapTokens")
      .withIndex("by_campaign_token", (q) => q.eq("campaignId", campaignId))
      .collect();
    for (const row of rows) await ctx.db.delete(row._id);
    for (const { id, ...fields } of tokens) await ctx.db.insert("mapTokens", { campaignId, tokenId: id, ...fields });
  });
}

/** A version 1 map document (one whole `MapState`, markers inline), as stored before the split. */
async function putV1Map(t: T, campaignId: Id<"campaigns">, tokens: MapToken[]) {
  await t.run(async (ctx) => {
    await ctx.db.insert("maps", { campaignId, data: { ...initialMapState("witherwild"), tokens, nextId: tokens.length + 1 }, updatedAt: 0 });
  });
}

/** convex-test files carry no content type, so attach the way `attachImage` would. */
async function attach(t: T, entryId: Id<"codexEntries">, uploadedBy: Id<"users">, shown = false) {
  return t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob(["img"], { type: "image/jpeg" }));
    const entry = (await ctx.db.get(entryId))!;
    await ctx.db.insert("files", { storageId, campaignId: entry.campaignId, uploadedBy, kind: "codexImage", refId: entryId, createdAt: 0 });
    const data = entry.data as { images: { storageId: string; shown: boolean }[]; cover: string | null };
    await ctx.db.patch(entryId, { data: { ...data, images: [...data.images, { storageId, shown }], cover: data.cover ?? storageId } });
    return storageId;
  });
}

/** Turns the campaign into one from before H15: no counter, and (by default) no entries. */
async function makeLegacy(t: T, campaignId: Id<"campaigns">, { keepEntries = false } = {}) {
  await t.run(async (ctx) => {
    for (const row of await ctx.db.query("codexCounters").collect()) if (row.campaignId === campaignId) await ctx.db.delete(row._id);
    if (keepEntries) return;
    for (const row of await ctx.db.query("codexEntries").collect()) if (row.campaignId === campaignId) await ctx.db.delete(row._id);
  });
}

const counter = (t: T, campaignId: Id<"campaigns">) =>
  t.run((ctx) =>
    ctx.db
      .query("codexCounters")
      .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
      .unique(),
  );

describe("codex", () => {
  useAllowlist("gm@example.com,p1@example.com,out@example.com");

  it("a new campaign starts with the frame's characters, all secret, with their true allegiance", async () => {
    const { t, gm, p1, campaignId } = await setup();
    const list = await gm.query(api.codex.list, { campaignId });
    expect(list.role).toBe("gm");
    expect(list.entries.map((e) => e.name)).toEqual(["Kreil Dirn", "The Fanewraith", "Archmage Phylax", "Nikta, the Great Owl"]);
    expect(list.entries[0]).toMatchObject({ known: false, allegiance: "Haven", allegianceShown: "unknown" });
    expect(await counter(t, campaignId)).toMatchObject({ entries: 4, seeded: true });
    expect((await p1.query(api.codex.list, { campaignId })).entries).toEqual([]);
    // Seeding again adds nothing.
    expect(await gm.mutation(api.codex.seed, { campaignId })).toEqual({ created: 0 });
    expect((await gm.query(api.codex.list, { campaignId })).entries).toHaveLength(4);
    expect(errorCode(await fail(p1.mutation(api.codex.seed, { campaignId })))).toBe("FORBIDDEN");
  });

  it("non-Witherwild frames seed unassigned characters and use Allies / Enemies / Neutral", async () => {
    const { gm, campaignId } = await setup("beast-feast");
    const list = await gm.query(api.codex.list, { campaignId });
    expect(list.entries.map((e) => e.name)).toEqual(["Carat", "Doug Dougle", "Hylaeus the Forest Mage"]);
    expect(list.role === "gm" && list.entries.map((e) => e.allegiance)).toEqual(["", "", ""]);
    const [first] = list.entries;
    await gm.mutation(api.codex.update, { entryId: first._id, patch: { allegiance: "Enemies", allegianceShown: "Allies" } });
    expect(errorCode(await fail(gm.mutation(api.codex.update, { entryId: first._id, patch: { allegiance: "Haven" } })))).toBe("INVALID");
  });

  it("codex.seed seeds an older campaign once, and never one that was already seeded", async () => {
    const { t, gm, campaignId } = await setup();
    await makeLegacy(t, campaignId);
    expect(await gm.mutation(api.codex.seed, { campaignId })).toEqual({ created: 4 });
    expect(await gm.mutation(api.codex.seed, { campaignId })).toEqual({ created: 0 });
    expect(await counter(t, campaignId)).toMatchObject({ entries: 4, seeded: true });

    // Seeded by the old page effect (its `codex:seed` operation), then emptied by the GM: stays empty.
    const other = await setup();
    await makeLegacy(other.t, other.campaignId);
    await other.t.run(async (ctx) => {
      await ctx.db.insert("operations", {
        scopeKey: `campaign:${other.campaignId}`,
        idempotencyKey: "codex:seed",
        kind: "codex_seed",
        requestHash: "x",
        result: { created: 4 },
        campaignId: other.campaignId,
        createdBy: other.ids.gm,
        createdAt: 0,
      });
    });
    expect(await other.gm.mutation(api.codex.seed, { campaignId: other.campaignId })).toEqual({ created: 0 });
    expect((await other.gm.query(api.codex.list, { campaignId: other.campaignId })).entries).toEqual([]);
  });

  it("players see only known entries and only their public fields, the role included", async () => {
    const { gm, p1, campaignId } = await setup();
    const { entryId: known } = await gm.mutation(api.codex.create, { campaignId, kind: "character", idempotencyKey: key() });
    const { entryId: secret } = await gm.mutation(api.codex.create, { campaignId, kind: "character", idempotencyKey: key() });
    await gm.mutation(api.codex.update, {
      entryId: known,
      patch: { name: "Kreil", role: "Spymaster", known: true, pdesc: "A quiet man.", gmn: "Works for the Fanewraith.", allegiance: "Fanewick", allegianceShown: "Haven" },
    });
    await gm.mutation(api.codex.update, { entryId: secret, patch: { name: "Hidden One", gmn: "Secret", pdesc: "Secret pdesc" } });

    const view = await p1.query(api.codex.list, { campaignId });
    expect(view.role).toBe("player");
    expect(view.entries).toHaveLength(1);
    const [e] = view.entries;
    expect(e).toMatchObject({ _id: known, name: "Kreil", role: "Spymaster", allegianceShown: "Haven", tokenId: null, images: [] });
    expect(Object.keys(e).sort()).toEqual(["_id", "allegianceShown", "cover", "createdAt", "images", "kind", "name", "region", "role", "tokenId"]);
    const raw = JSON.stringify(view);
    expect(raw).not.toContain("Works for the Fanewraith");
    expect(raw).not.toContain("Fanewick");
    expect(raw).not.toContain("Hidden One");
    expect(raw).not.toContain("A quiet man.");
    expect("pins" in view).toBe(false);

    // The long text comes from entryText: GM notes only for the GM, nothing of unknown entries.
    expect(await p1.query(api.codex.entryText, { entryId: known })).toEqual({ role: "player", pdesc: "A quiet man." });
    expect(await p1.query(api.codex.entryText, { entryId: secret })).toBeNull();
    expect(await gm.query(api.codex.entryText, { entryId: known })).toEqual({ role: "gm", pdesc: "A quiet man.", gmn: "Works for the Fanewraith." });
    // The GM list carries no long text either.
    const gmRaw = JSON.stringify(await gm.query(api.codex.list, { campaignId }));
    expect(gmRaw).not.toContain("Works for the Fanewraith");
    expect(gmRaw).not.toContain("A quiet man.");
  });

  it("editing the long text writes only the text row, never the entry the list reads", async () => {
    const { t, gm, campaignId } = await setup();
    const { entryId } = await gm.mutation(api.codex.create, { campaignId, kind: "character", idempotencyKey: key() });
    const before = await t.run((ctx) => ctx.db.get(entryId));
    await gm.mutation(api.codex.update, { entryId, patch: { gmn: "Notes", pdesc: "Seen" } });
    await gm.mutation(api.codex.update, { entryId, patch: { gmn: "More notes" } });
    expect(await t.run((ctx) => ctx.db.get(entryId))).toEqual(before);
    expect(await gm.query(api.codex.entryText, { entryId })).toEqual({ role: "gm", pdesc: "Seen", gmn: "More notes" });
    expect(await t.run(async (ctx) => (await ctx.db.query("codexEntryText").collect()).length)).toBe(1);
    expect((before!.data as { schemaVersion?: number }).schemaVersion).toBe(2);
  });

  it("players can't change anything and outsiders can't see the campaign", async () => {
    const { gm, p1, out, campaignId } = await setup();
    const { entryId } = await gm.mutation(api.codex.create, { campaignId, kind: "location", idempotencyKey: key() });
    const forbidden = [
      () => p1.mutation(api.codex.create, { campaignId, kind: "character", idempotencyKey: key() }),
      () => p1.mutation(api.codex.update, { entryId, patch: { name: "x" } }),
      () => p1.mutation(api.codex.setPin, { entryId, tokenId: null }),
      () => p1.mutation(api.codex.remove, { entryId }),
      () => p1.mutation(api.codex.imageUploadUrl, { entryId }),
      () => p1.mutation(api.codex.importPins, { campaignId, idempotencyKey: key() }),
      () => p1.mutation(api.codex.setImageShown, { entryId, storageId: "x", shown: true }),
      () => p1.mutation(api.codex.setCover, { entryId, storageId: "x" }),
      () => p1.mutation(api.codex.removeImage, { entryId, storageId: "x" }),
    ];
    for (const call of forbidden) expect(errorCode(await fail(call()))).toBe("FORBIDDEN");
    expect(errorCode(await fail(out.query(api.codex.list, { campaignId })))).toBe("NOT_FOUND");
    expect(await out.query(api.codex.entryText, { entryId })).toBeNull();
    expect(errorCode(await fail(out.mutation(api.codex.update, { entryId, patch: { name: "x" } })))).toBe("NOT_FOUND");
    expect(errorCode(await fail(out.mutation(api.codex.imageUploadUrl, { entryId })))).toBe("NOT_FOUND");
    expect(errorCode(await fail(out.mutation(api.codex.create, { campaignId, kind: "character", idempotencyKey: key() })))).toBe("NOT_FOUND");
  });

  it("validates edits: typed fields, lengths, allegiances and regions of the frame", async () => {
    const { gm, campaignId } = await setup();
    const { entryId } = await gm.mutation(api.codex.create, { campaignId, kind: "character", idempotencyKey: key() });
    // Unknown fields and wrong types fail the argument validator.
    for (const patch of [{ tokenId: 3 }, { images: [] }, { known: "yes" }]) {
      await expect(gm.mutation(api.codex.update, { entryId, patch: patch as never })).rejects.toThrow(/Validator|validator/);
    }
    const bad = [{ name: "x".repeat(121) }, { gmn: "x".repeat(8001) }, { pdesc: "x".repeat(8001) }, { allegiance: "Allies" }, { allegianceShown: "Nope" }, { region: "Mars" }];
    for (const patch of bad) {
      expect(errorCode(await fail(gm.mutation(api.codex.update, { entryId, patch })))).toBe("INVALID");
    }
    await gm.mutation(api.codex.update, { entryId, patch: { allegiance: "Neutral", allegianceShown: "unknown", region: "Colonies" } });
  });

  it("caps a campaign at 500 entries through the counter; create is idempotent and remove frees room", async () => {
    const { t, gm, campaignId } = await setup();
    const k = key();
    const a = await gm.mutation(api.codex.create, { campaignId, kind: "character", idempotencyKey: k });
    expect(await gm.mutation(api.codex.create, { campaignId, kind: "character", idempotencyKey: k })).toEqual(a);
    expect(errorCode(await fail(gm.mutation(api.codex.create, { campaignId, kind: "location", idempotencyKey: k })))).toBe("IDEMPOTENCY_MISMATCH");
    expect(await counter(t, campaignId)).toMatchObject({ entries: 5 });
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("codexCounters")
        .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
        .unique();
      await ctx.db.patch(row!._id, { entries: 500 });
    });
    expect(errorCode(await fail(gm.mutation(api.codex.create, { campaignId, kind: "character", idempotencyKey: key() })))).toBe("INVALID");
    await gm.mutation(api.codex.remove, { entryId: a.entryId });
    expect(await counter(t, campaignId)).toMatchObject({ entries: 499 });
    await gm.mutation(api.codex.create, { campaignId, kind: "character", idempotencyKey: key() });
  });

  it("an older campaign without a counter is counted once, by its entries", async () => {
    const { t, gm, campaignId } = await setup();
    await makeLegacy(t, campaignId, { keepEntries: true });
    await gm.mutation(api.codex.create, { campaignId, kind: "location", idempotencyKey: key() });
    expect(await counter(t, campaignId)).toMatchObject({ entries: 5, seeded: true });
  });

  it("map pins: only existing tokens, region from the pin, hidden tokens never reach players", async () => {
    const { t, gm, p1, campaignId } = await setup();
    const { entryId } = await gm.mutation(api.codex.create, { campaignId, kind: "location", idempotencyKey: key() });
    await gm.mutation(api.codex.update, { entryId, patch: { name: "Gate", known: true, region: "Fanewick" } });
    expect(await gm.mutation(api.codex.setPin, { entryId, tokenId: 7 })).toEqual({ tokenId: null });

    await putTokens(t, campaignId, [token(1, { x: 55, y: 40 }), token(2, { hidden: true, x: 55, y: 40 })]);
    expect(await gm.mutation(api.codex.setPin, { entryId, tokenId: 1 })).toEqual({ tokenId: 1 });
    const gmView = await gm.query(api.codex.list, { campaignId });
    expect(gmView.entries[0]).toMatchObject({ tokenId: 1, region: "Haven", regionAuto: true });
    expect(gmView.role === "gm" && gmView.pins.map((p) => p.id)).toEqual([1, 2]);
    expect((await p1.query(api.codex.list, { campaignId })).entries[0]).toMatchObject({ tokenId: 1, region: "Haven" });

    await gm.mutation(api.codex.setPin, { entryId, tokenId: 2 });
    const hidden = await p1.query(api.codex.list, { campaignId });
    expect(hidden.entries[0]).toMatchObject({ tokenId: null, region: "Fanewick" });
    expect(JSON.stringify(hidden)).not.toContain("Pin 2");

    // A pin whose token was deleted from the map counts as no pin.
    await putTokens(t, campaignId, [token(1)]);
    expect((await gm.query(api.codex.list, { campaignId })).entries[0]).toMatchObject({ tokenId: null, regionAuto: false, region: "Fanewick" });
  });

  it("map pins also come from a map not split into rows yet", async () => {
    const { t, gm, campaignId } = await setup();
    await putV1Map(t, campaignId, [token(4)]);
    const { entryId } = await gm.mutation(api.codex.create, { campaignId, kind: "location", idempotencyKey: key() });
    expect(await gm.mutation(api.codex.setPin, { entryId, tokenId: 4 })).toEqual({ tokenId: 4 });
    const view = await gm.query(api.codex.list, { campaignId });
    expect(view.role === "gm" && view.pins.map((p) => p.id)).toEqual([4]);
    expect(view.entries[0]).toMatchObject({ tokenId: 4 });
  });

  it("imports a location for each map pin not linked yet, its notes as GM notes", async () => {
    const { t, gm, campaignId } = await setup();
    await putTokens(t, campaignId, [token(1, { notes: "Trap" }), token(2, { hidden: true, notes: "Lair" }), token(3, { location: false })]);
    const { entryId } = await gm.mutation(api.codex.create, { campaignId, kind: "location", idempotencyKey: key() });
    await gm.mutation(api.codex.setPin, { entryId, tokenId: 1 });
    expect(await gm.mutation(api.codex.importPins, { campaignId, idempotencyKey: key() })).toEqual({ added: 2 });
    expect(await gm.mutation(api.codex.importPins, { campaignId, idempotencyKey: key() })).toEqual({ added: 0 });
    const list = await gm.query(api.codex.list, { campaignId });
    const byPin = Object.fromEntries(list.entries.map((e) => [e.tokenId, e]));
    expect(byPin[2]).toMatchObject({ name: "Pin 2", known: false });
    expect(byPin[3]).toMatchObject({ name: "Pin 3", known: false });
    expect(await gm.query(api.codex.entryText, { entryId: byPin[2]._id })).toEqual({ role: "gm", pdesc: "", gmn: "Lair" });
    expect(await counter(t, campaignId)).toMatchObject({ entries: 7 });
  });

  it("images: players get only revealed ones; revealing marks the entry known", async () => {
    const { t, ids, gm, p1, campaignId } = await setup();
    const { entryId } = await gm.mutation(api.codex.create, { campaignId, kind: "character", idempotencyKey: key() });
    const hiddenImg = await attach(t, entryId, ids.gm);
    const shownImg = await attach(t, entryId, ids.gm);
    expect((await p1.query(api.codex.list, { campaignId })).entries).toEqual([]);

    await gm.mutation(api.codex.setImageShown, { entryId, storageId: shownImg, shown: true });
    const view = await p1.query(api.codex.list, { campaignId });
    expect(view.entries).toHaveLength(1);
    // Players get opaque per-entry image keys, never storage ids.
    expect(view.entries[0].images).toEqual([{ key: "0", url: expect.any(String) }]);
    expect(view.entries[0].cover).toBe("0");
    expect(JSON.stringify(view)).not.toContain(hiddenImg);
    expect(JSON.stringify(view)).not.toContain(shownImg);

    const gmView = await gm.query(api.codex.list, { campaignId });
    expect(gmView.entries[0].images.map((g) => g.url)).toEqual([expect.any(String), expect.any(String)]);
    expect(gmView.entries[0].cover).toBe(hiddenImg);
    await gm.mutation(api.codex.setCover, { entryId, storageId: shownImg });
    expect((await gm.query(api.codex.list, { campaignId })).entries[0].cover).toBe(shownImg);
    expect(errorCode(await fail(gm.mutation(api.codex.setCover, { entryId, storageId: "nope" })))).toBe("NOT_FOUND");
  });

  it("images: an image another entry's file row claims gets no URL", async () => {
    const { t, ids, gm, campaignId } = await setup();
    const { entryId: a } = await gm.mutation(api.codex.create, { campaignId, kind: "character", idempotencyKey: key() });
    const { entryId: b } = await gm.mutation(api.codex.create, { campaignId, kind: "character", idempotencyKey: key() });
    const img = await attach(t, a, ids.gm);
    await t.run(async (ctx) => {
      const entry = (await ctx.db.get(b))!;
      await ctx.db.patch(b, { data: { ...(entry.data as object), images: [{ storageId: img, shown: true }] } });
    });
    const list = await gm.query(api.codex.list, { campaignId });
    expect(list.entries.find((e) => e._id === b)!.images).toEqual([{ key: img, storageId: img, shown: true, url: null }]);
    expect(list.entries.find((e) => e._id === a)!.images[0].url).toEqual(expect.any(String));
  });

  it("images: only images, never claimed twice or across entries, removed files are deleted", async () => {
    const { t, ids, gm, campaignId } = await setup();
    const { entryId: a } = await gm.mutation(api.codex.create, { campaignId, kind: "character", idempotencyKey: key() });
    const { entryId: b } = await gm.mutation(api.codex.create, { campaignId, kind: "location", idempotencyKey: key() });
    const { campaignId: otherCampaign } = await gm.mutation(api.campaigns.create, { frameId: "beast-feast", name: "Other", idempotencyKey: key() });
    const { entryId: c } = await gm.mutation(api.codex.create, { campaignId: otherCampaign, kind: "character", idempotencyKey: key() });

    expect(await gm.mutation(api.codex.imageUploadUrl, { entryId: a })).toEqual(expect.any(String));
    const text = await t.run((ctx) => ctx.storage.store(new Blob(["hi"], { type: "text/plain" })));
    expect(await gm.mutation(api.codex.attachImage, { entryId: a, storageId: text })).toEqual({ error: expect.any(String) });
    expect(await t.run((ctx) => ctx.storage.getUrl(text))).toBeNull();

    const img = await attach(t, a, ids.gm);
    for (const entryId of [a, b, c]) {
      expect(errorCode(await fail(gm.mutation(api.codex.attachImage, { entryId, storageId: img })))).toBe("NOT_FOUND");
    }
    // Another entry can't remove (and so delete) a file it doesn't own.
    expect(errorCode(await fail(gm.mutation(api.codex.removeImage, { entryId: b, storageId: img })))).toBe("NOT_FOUND");
    expect(await t.run((ctx) => ctx.storage.getUrl(img))).not.toBeNull();

    await gm.mutation(api.codex.removeImage, { entryId: a, storageId: img });
    expect(await t.run((ctx) => ctx.storage.getUrl(img))).toBeNull();
    expect((await gm.query(api.codex.list, { campaignId })).entries.find((e) => e._id === a)!.images).toEqual([]);

    const kept = await attach(t, b, ids.gm);
    await gm.mutation(api.codex.update, { entryId: b, patch: { gmn: "gone soon" } });
    await gm.mutation(api.codex.remove, { entryId: b });
    expect(await t.run((ctx) => ctx.storage.getUrl(kept))).toBeNull();
    expect(await t.run((ctx) => ctx.db.query("files").collect())).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("codexEntryText").collect())).toEqual([]);
    expect(await gm.query(api.codex.entryText, { entryId: b })).toBeNull();
  });

  it("images: at most 8 per entry", async () => {
    const { t, ids, gm, campaignId } = await setup();
    const { entryId } = await gm.mutation(api.codex.create, { campaignId, kind: "character", idempotencyKey: key() });
    for (let i = 0; i < 8; i++) await attach(t, entryId, ids.gm);
    expect(errorCode(await fail(gm.mutation(api.codex.imageUploadUrl, { entryId })))).toBe("INVALID");
    const extra = await t.run((ctx) => ctx.storage.store(new Blob(["x"], { type: "image/png" })));
    expect(await gm.mutation(api.codex.attachImage, { entryId, storageId: extra })).toEqual({ error: expect.any(String) });
    expect(await t.run((ctx) => ctx.storage.getUrl(extra))).toBeNull();
    expect(await t.run(async (ctx) => (await ctx.db.query("files").collect()).length)).toBe(8);
  });

  it("imageUploadUrl is rate-limited per user", async () => {
    const { gm, campaignId } = await setup();
    const { entryId } = await gm.mutation(api.codex.create, { campaignId, kind: "character", idempotencyKey: key() });
    let code: unknown;
    for (let i = 0; i < 30 && code === undefined; i++) code = errorCode(await fail(gm.mutation(api.codex.imageUploadUrl, { entryId })));
    expect(code).toBe("RATE_LIMITED");
  });
});

describe("codex: entries stored before the text split (version 1)", () => {
  useAllowlist("gm@example.com,p1@example.com,out@example.com");

  /** A version 1 entry: no `schemaVersion`, its text inline. */
  async function legacyEntry(t: T, campaignId: Id<"campaigns">) {
    return t.run((ctx) =>
      ctx.db.insert("codexEntries", {
        campaignId,
        kind: "character",
        data: emptyEntry({ name: "Old", role: "Elder", known: true, pdesc: "Seen once.", gmn: "Is a dragon." }),
        createdAt: Date.now(),
        updatedAt: 0,
      }),
    );
  }

  it("reads as before; the first edit moves its text to a text row", async () => {
    const { t, gm, p1, campaignId } = await setup();
    const entryId = await legacyEntry(t, campaignId);
    expect((await p1.query(api.codex.list, { campaignId })).entries).toMatchObject([{ name: "Old", role: "Elder" }]);
    expect(JSON.stringify(await p1.query(api.codex.list, { campaignId }))).not.toContain("Is a dragon.");
    expect(await p1.query(api.codex.entryText, { entryId })).toEqual({ role: "player", pdesc: "Seen once." });
    expect(await gm.query(api.codex.entryText, { entryId })).toEqual({ role: "gm", pdesc: "Seen once.", gmn: "Is a dragon." });

    await gm.mutation(api.codex.update, { entryId, patch: { name: "Older" } });
    const row = (await t.run((ctx) => ctx.db.get(entryId)))!;
    expect(row.data).toMatchObject({ schemaVersion: 2, name: "Older" });
    expect(row.data).not.toHaveProperty("gmn");
    expect(await gm.query(api.codex.entryText, { entryId })).toEqual({ role: "gm", pdesc: "Seen once.", gmn: "Is a dragon." });
  });

  it("an edit to the text alone keeps the other text", async () => {
    const { t, gm, campaignId } = await setup();
    const entryId = await legacyEntry(t, campaignId);
    await gm.mutation(api.codex.update, { entryId, patch: { pdesc: "Seen twice." } });
    expect(await gm.query(api.codex.entryText, { entryId })).toEqual({ role: "gm", pdesc: "Seen twice.", gmn: "Is a dragon." });
  });

  it("migrations/codex:splitText splits every version 1 entry once; countEntries backfills counters", async () => {
    vi.useFakeTimers();
    try {
      const { t, gm, campaignId } = await setup();
      const entryId = await legacyEntry(t, campaignId);
      await makeLegacy(t, campaignId, { keepEntries: true });
      for (const fn of ["migrations/codex:splitText", "migrations/codex:countEntries"]) {
        await t.mutation(internal.migrations.run.run, { fn, batchSize: 2 });
        await t.finishAllScheduledFunctions(vi.runAllTimers);
      }
      const rows = await t.run((ctx) => ctx.db.query("codexEntries").collect());
      expect(rows.every((r) => (r.data as { schemaVersion?: number }).schemaVersion === 2)).toBe(true);
      expect(await t.run((ctx) => ctx.db.query("codexEntryText").collect())).toMatchObject([{ entryId, pdesc: "Seen once.", gmn: "Is a dragon." }]);
      expect(await counter(t, campaignId)).toMatchObject({ entries: 5, seeded: true });
      expect(await gm.query(api.codex.entryText, { entryId })).toEqual({ role: "gm", pdesc: "Seen once.", gmn: "Is a dragon." });

      // Running again changes nothing.
      for (const fn of ["migrations/codex:splitText", "migrations/codex:countEntries"]) {
        await t.mutation(internal.migrations.run.run, { fn, reset: true });
        await t.finishAllScheduledFunctions(vi.runAllTimers);
      }
      expect(await t.run(async (ctx) => (await ctx.db.query("codexEntryText").collect()).length)).toBe(1);
      expect(await t.run(async (ctx) => (await ctx.db.query("codexCounters").collect()).length)).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
