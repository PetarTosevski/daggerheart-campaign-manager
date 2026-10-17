import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { initialMapState, type MapToken } from "../../src/lib/world/map-state";
import { errorCode, errorData, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

async function setup() {
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
  const { campaignId } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Codex", idempotencyKey: key() });
  const code = await gm.mutation(api.members.rotateJoinCode, { campaignId });
  await p1.mutation(api.members.joinByCode, { code });
  return { t, ids, gm, p1, out, campaignId };
}

type T = Awaited<ReturnType<typeof setup>>["t"];

function token(id: number, over: Partial<MapToken> = {}): MapToken {
  return { id, type: "landmark", x: 55, y: 40, name: `Pin ${id}`, notes: "", hidden: false, location: true, ...over };
}

async function putMap(t: T, campaignId: Id<"campaigns">, tokens: MapToken[]) {
  await t.run(async (ctx) => {
    const data = { ...initialMapState("witherwild"), tokens, nextId: tokens.length + 1 };
    const row = await ctx.db
      .query("maps")
      .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
      .unique();
    if (row) await ctx.db.patch(row._id, { data });
    else await ctx.db.insert("maps", { campaignId, data, updatedAt: 0 });
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

describe("codex", () => {
  useAllowlist("gm@example.com,p1@example.com,out@example.com");

  it("seeds the frame's characters once, all secret, with their true allegiance", async () => {
    const { gm, p1, campaignId } = await setup();
    expect(await gm.mutation(api.codex.seed, { campaignId })).toEqual({ created: 4 });
    expect(await gm.mutation(api.codex.seed, { campaignId })).toEqual({ created: 4 });
    const list = await gm.query(api.codex.list, { campaignId });
    expect(list.role).toBe("gm");
    expect(list.entries).toHaveLength(4);
    expect(list.entries.map((e) => e.name)).toEqual(["Kreil Dirn", "The Fanewraith", "Archmage Phylax", "Nikta, the Great Owl"]);
    expect(list.entries[0]).toMatchObject({ known: false, allegiance: "Haven", allegianceShown: "unknown" });
    expect((await p1.query(api.codex.list, { campaignId })).entries).toEqual([]);
    expect(errorData(await p1.mutation(api.codex.seed, { campaignId }).catch((e) => e))).toBe("FORBIDDEN");
  });

  it("players see only known entries and only their public fields", async () => {
    const { gm, p1, campaignId } = await setup();
    const { entryId: known } = await gm.mutation(api.codex.create, { campaignId, kind: "character", idempotencyKey: key() });
    const { entryId: secret } = await gm.mutation(api.codex.create, { campaignId, kind: "character", idempotencyKey: key() });
    await gm.mutation(api.codex.update, {
      entryId: known,
      patch: { name: "Kreil", role: "Spymaster", known: true, pdesc: "A quiet man.", gmn: "Works for the Fanewraith.", allegiance: "Fanewick", allegianceShown: "Haven" },
    });
    await gm.mutation(api.codex.update, { entryId: secret, patch: { name: "Hidden One", gmn: "Secret" } });

    const view = await p1.query(api.codex.list, { campaignId });
    expect(view.role).toBe("player");
    expect(view.entries).toHaveLength(1);
    const [e] = view.entries;
    expect(e).toMatchObject({ _id: known, name: "Kreil", pdesc: "A quiet man.", allegianceShown: "Haven", tokenId: null, images: [] });
    expect(Object.keys(e).sort()).toEqual(["_id", "allegianceShown", "cover", "createdAt", "images", "kind", "name", "pdesc", "region", "tokenId"]);
    const raw = JSON.stringify(view);
    expect(raw).not.toContain("Works for the Fanewraith");
    expect(raw).not.toContain("Fanewick");
    expect(raw).not.toContain("Hidden One");
    expect(raw).not.toContain("Spymaster");
    expect("pins" in view).toBe(false);
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
    for (const call of forbidden) expect(errorData(await call().catch((e) => e))).toBe("FORBIDDEN");
    expect(errorData(await out.query(api.codex.list, { campaignId }).catch((e) => e))).toBe("NOT_FOUND");
    expect(errorData(await out.mutation(api.codex.update, { entryId, patch: { name: "x" } }).catch((e) => e))).toBe("NOT_FOUND");
    expect(errorData(await out.mutation(api.codex.imageUploadUrl, { entryId }).catch((e) => e))).toBe("NOT_FOUND");
    expect(errorData(await out.mutation(api.codex.create, { campaignId, kind: "character", idempotencyKey: key() }).catch((e) => e))).toBe("NOT_FOUND");
  });

  it("validates edits: lengths, unknown fields, allegiances and regions of the frame", async () => {
    const { gm, campaignId } = await setup();
    const { entryId } = await gm.mutation(api.codex.create, { campaignId, kind: "character", idempotencyKey: key() });
    const bad = [{ name: "x".repeat(121) }, { gmn: "x".repeat(8001) }, { tokenId: 3 }, { images: [] }, { allegiance: "Allies" }, { allegianceShown: "Nope" }, { region: "Mars" }, { known: "yes" }];
    for (const patch of bad) {
      expect(errorCode(await gm.mutation(api.codex.update, { entryId, patch }).catch((e) => e))).toBe("INVALID");
    }
    await gm.mutation(api.codex.update, { entryId, patch: { allegiance: "Neutral", allegianceShown: "unknown", region: "Colonies" } });
  });

  it("caps a campaign at 500 entries and create is idempotent", async () => {
    const { t, gm, campaignId } = await setup();
    const k = key();
    const a = await gm.mutation(api.codex.create, { campaignId, kind: "character", idempotencyKey: k });
    expect(await gm.mutation(api.codex.create, { campaignId, kind: "character", idempotencyKey: k })).toEqual(a);
    expect(errorData(await gm.mutation(api.codex.create, { campaignId, kind: "location", idempotencyKey: k }).catch((e) => e))).toBe("IDEMPOTENCY_MISMATCH");
    await t.run(async (ctx) => {
      const data = (await ctx.db.get(a.entryId))!.data;
      for (let i = 0; i < 499; i++) await ctx.db.insert("codexEntries", { campaignId, kind: "location", data, createdAt: 0, updatedAt: 0 });
    });
    expect(errorCode(await gm.mutation(api.codex.create, { campaignId, kind: "character", idempotencyKey: key() }).catch((e) => e))).toBe("INVALID");
  });

  it("map pins: only existing tokens, region from the pin, hidden tokens never reach players", async () => {
    const { t, gm, p1, campaignId } = await setup();
    const { entryId } = await gm.mutation(api.codex.create, { campaignId, kind: "location", idempotencyKey: key() });
    await gm.mutation(api.codex.update, { entryId, patch: { name: "Gate", known: true, region: "Fanewick" } });
    expect(await gm.mutation(api.codex.setPin, { entryId, tokenId: 7 })).toEqual({ tokenId: null });

    await putMap(t, campaignId, [token(1, { x: 55, y: 40 }), token(2, { hidden: true, x: 55, y: 40 })]);
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
    await putMap(t, campaignId, [token(1)]);
    expect((await gm.query(api.codex.list, { campaignId })).entries[0]).toMatchObject({ tokenId: null, regionAuto: false, region: "Fanewick" });
  });

  it("imports a location for each map pin not linked yet", async () => {
    const { t, gm, campaignId } = await setup();
    await putMap(t, campaignId, [token(1, { notes: "Trap" }), token(2, { hidden: true }), token(3, { location: false })]);
    const { entryId } = await gm.mutation(api.codex.create, { campaignId, kind: "location", idempotencyKey: key() });
    await gm.mutation(api.codex.setPin, { entryId, tokenId: 1 });
    expect(await gm.mutation(api.codex.importPins, { campaignId, idempotencyKey: key() })).toEqual({ added: 2 });
    expect(await gm.mutation(api.codex.importPins, { campaignId, idempotencyKey: key() })).toEqual({ added: 0 });
    const list = await gm.query(api.codex.list, { campaignId });
    const byPin = Object.fromEntries(list.entries.map((e) => [e.tokenId, e]));
    expect(byPin[2]).toMatchObject({ name: "Pin 2", known: false });
    expect(byPin[3]).toMatchObject({ name: "Pin 3", known: false });
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
    expect(errorData(await gm.mutation(api.codex.setCover, { entryId, storageId: "nope" }).catch((e) => e))).toBe("NOT_FOUND");
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
      expect(errorData(await gm.mutation(api.codex.attachImage, { entryId, storageId: img }).catch((e) => e))).toBe("NOT_FOUND");
    }
    // Another entry can't remove (and so delete) a file it doesn't own.
    expect(errorData(await gm.mutation(api.codex.removeImage, { entryId: b, storageId: img }).catch((e) => e))).toBe("NOT_FOUND");
    expect(await t.run((ctx) => ctx.storage.getUrl(img))).not.toBeNull();

    await gm.mutation(api.codex.removeImage, { entryId: a, storageId: img });
    expect(await t.run((ctx) => ctx.storage.getUrl(img))).toBeNull();
    expect((await gm.query(api.codex.list, { campaignId })).entries.find((e) => e._id === a)!.images).toEqual([]);

    const kept = await attach(t, b, ids.gm);
    await gm.mutation(api.codex.remove, { entryId: b });
    expect(await t.run((ctx) => ctx.storage.getUrl(kept))).toBeNull();
    expect(await t.run((ctx) => ctx.db.query("files").collect())).toEqual([]);
  });

  it("images: at most 8 per entry", async () => {
    const { t, ids, gm, campaignId } = await setup();
    const { entryId } = await gm.mutation(api.codex.create, { campaignId, kind: "character", idempotencyKey: key() });
    for (let i = 0; i < 8; i++) await attach(t, entryId, ids.gm);
    expect(errorCode(await gm.mutation(api.codex.imageUploadUrl, { entryId }).catch((e) => e))).toBe("INVALID");
    const extra = await t.run((ctx) => ctx.storage.store(new Blob(["x"], { type: "image/png" })));
    expect(await gm.mutation(api.codex.attachImage, { entryId, storageId: extra })).toEqual({ error: expect.any(String) });
    expect(await t.run((ctx) => ctx.storage.getUrl(extra))).toBeNull();
    expect(await t.run(async (ctx) => (await ctx.db.query("files").collect()).length)).toBe(8);
  });
});
