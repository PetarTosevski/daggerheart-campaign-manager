import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { DEFAULT_MODEL } from "../../convex/photoImport";
import { messagesResponse, validDraft, warriorReading } from "../fixtures/photo-import";
import { errorCode, GM_EMAIL, key, OTHER_EMAIL, setupWithCampaign, useAllowlist } from "./helpers";

const PLAYER_EMAIL = "player@example.com";

async function setup() {
  const s = await setupWithCampaign();
  const playerId = await s.t.run((ctx) => ctx.db.insert("users", { email: PLAYER_EMAIL, emailVerificationTime: 1 }));
  await s.t.run((ctx) => ctx.db.insert("campaignMembers", { campaignId: s.campaignId, userId: playerId, joinedAt: 0, lastOpenedAt: 0 }));
  const player = s.t.withIdentity({ subject: `${playerId}|session` });
  return { ...s, player, playerId };
}
type Setup = Awaited<ReturnType<typeof setup>>;

async function fail(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected the call to fail.");
}

/** Stores a file; convex-test records no content type, so it is patched in (as in upload-claims.test.ts). */
const store = (s: Setup, contentType = "image/jpeg", bytes = 64) =>
  s.t.run(async (ctx) => {
    const id = await ctx.storage.store(new Blob([new Uint8Array(bytes)], { type: contentType }));
    await (ctx.db as unknown as { patch: (id: Id<"_storage">, value: { contentType: string }) => Promise<void> }).patch(id, { contentType });
    return id;
  });
const blobExists = (s: Setup, id: Id<"_storage">) => s.t.run(async (ctx) => (await ctx.db.system.get("_storage", id)) !== null);
const photoRows = (s: Setup) =>
  s.t.run((ctx) =>
    ctx.db
      .query("files")
      .withIndex("by_ref", (q) => q.eq("kind", "photoImport").eq("refId", s.campaignId))
      .collect(),
  );

/** Uploads and claims `n` JPEG photos as the GM. */
async function uploadPhotos(s: Setup, n = 2): Promise<Id<"_storage">[]> {
  const ids: Id<"_storage">[] = [];
  for (let i = 0; i < n; i++) {
    const storageId = await store(s);
    expect(await s.gm.mutation(api.photoImport.claim, { campaignId: s.campaignId, storageId })).toEqual({ ok: true });
    ids.push(storageId);
  }
  return ids;
}

describe("photo import", () => {
  useAllowlist(`${GM_EMAIL},${OTHER_EMAIL},${PLAYER_EMAIL}`);
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    delete process.env.ANTHROPIC_MODEL;
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response(JSON.stringify(messagesResponse(warriorReading)), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_MODEL;
    vi.unstubAllGlobals();
  });

  it("is available only with ANTHROPIC_API_KEY, and only to the GM", async () => {
    const s = await setup();
    expect(await s.gm.query(api.photoImport.available, { campaignId: s.campaignId })).toBe(true);
    expect(errorCode(await fail(s.player.query(api.photoImport.available, { campaignId: s.campaignId })))).toBe("FORBIDDEN");
    expect(errorCode(await fail(s.other.query(api.photoImport.available, { campaignId: s.campaignId })))).toBe("NOT_FOUND");
    expect(errorCode(await fail(s.t.query(api.photoImport.available, { campaignId: s.campaignId })))).toBe("UNAUTHENTICATED");
    process.env.ANTHROPIC_API_KEY = " ";
    expect(await s.gm.query(api.photoImport.available, { campaignId: s.campaignId })).toBe(false);
    delete process.env.ANTHROPIC_API_KEY;
    expect(await s.gm.query(api.photoImport.available, { campaignId: s.campaignId })).toBe(false);
    expect(errorCode(await fail(s.gm.mutation(api.photoImport.uploadUrl, { campaignId: s.campaignId })))).toBe("PHOTO_IMPORT_UNAVAILABLE");
  });

  it("issues upload URLs to the GM only", async () => {
    const s = await setup();
    expect(typeof (await s.gm.mutation(api.photoImport.uploadUrl, { campaignId: s.campaignId }))).toBe("string");
    expect(errorCode(await fail(s.player.mutation(api.photoImport.uploadUrl, { campaignId: s.campaignId })))).toBe("FORBIDDEN");
  });

  it("claims at most four JPEG, PNG or WebP photos of at most 5 MB, deleting rejected files", async () => {
    const s = await setup();
    const gif = await store(s, "image/gif");
    expect(await s.gm.mutation(api.photoImport.claim, { campaignId: s.campaignId, storageId: gif })).toEqual({ ok: false, code: "PHOTO_IMPORT_FILE" });
    expect(await blobExists(s, gif)).toBe(false);
    const huge = await store(s, "image/png", 5 * 1024 * 1024 + 1);
    expect(await s.gm.mutation(api.photoImport.claim, { campaignId: s.campaignId, storageId: huge })).toEqual({ ok: false, code: "PHOTO_IMPORT_FILE" });
    expect(await blobExists(s, huge)).toBe(false);

    const webp = await store(s, "image/webp");
    expect(await s.gm.mutation(api.photoImport.claim, { campaignId: s.campaignId, storageId: webp })).toEqual({ ok: true });
    await uploadPhotos(s, 3);
    const fifth = await store(s);
    expect(await s.gm.mutation(api.photoImport.claim, { campaignId: s.campaignId, storageId: fifth })).toEqual({ ok: false, code: "PHOTO_IMPORT_TOO_MANY" });
    expect(await blobExists(s, fifth)).toBe(false);
    expect(await photoRows(s)).toHaveLength(4);

    // A claimed file can't be claimed again; a player can't claim at all.
    expect(errorCode(await fail(s.gm.mutation(api.photoImport.claim, { campaignId: s.campaignId, storageId: webp })))).toBe("NOT_FOUND");
    const theirs = await store(s);
    expect(errorCode(await fail(s.player.mutation(api.photoImport.claim, { campaignId: s.campaignId, storageId: theirs })))).toBe("FORBIDDEN");
    expect(await blobExists(s, theirs)).toBe(true);
  });

  it("reads the photos with one Messages API call into a draft, then deletes them", async () => {
    const s = await setup();
    const photos = await uploadPhotos(s, 2);
    const result = await s.gm.action(api.photoImport.read, { campaignId: s.campaignId });

    expect(result.draft).toMatchObject({ name: "Brenna Ashfall", level: 5, classId: "warrior", primaryWeaponId: "advanced-broadsword", armorId: "improved-gambeson-armor" });
    expect(result.unreadable).toEqual(["traits.instinct", "experiences.1.value"]);
    expect(result.unmatched).toEqual([{ field: "domainCards.3", text: "Sword Dance" }]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const headers = init?.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("test-key");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    const body = JSON.parse(init?.body as string) as { model: string; messages: { content: { type: string; source?: { type: string; media_type: string } }[] }[] };
    expect(body.model).toBe(DEFAULT_MODEL);
    const images = body.messages[0]!.content.filter((c) => c.type === "image");
    expect(images).toHaveLength(2);
    expect(images[0]!.source).toMatchObject({ type: "base64", media_type: "image/jpeg" });

    for (const id of photos) expect(await blobExists(s, id)).toBe(false);
    expect(await photoRows(s)).toHaveLength(0);
  });

  it("uses ANTHROPIC_MODEL when set", async () => {
    const s = await setup();
    process.env.ANTHROPIC_MODEL = "claude-opus-5-5";
    await uploadPhotos(s, 1);
    await s.gm.action(api.photoImport.read, { campaignId: s.campaignId });
    expect((JSON.parse(fetchMock.mock.calls[0]![1]?.body as string) as { model: string }).model).toBe("claude-opus-5-5");
  });

  it("refuses players (FORBIDDEN) and keeps the GM's photos", async () => {
    const s = await setup();
    const photos = await uploadPhotos(s, 1);
    expect(errorCode(await fail(s.player.action(api.photoImport.read, { campaignId: s.campaignId })))).toBe("FORBIDDEN");
    expect(errorCode(await fail(s.other.action(api.photoImport.read, { campaignId: s.campaignId })))).toBe("NOT_FOUND");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await blobExists(s, photos[0]!)).toBe(true);
  });

  it("gives PHOTO_IMPORT_UNAVAILABLE without a key, and still deletes the photos", async () => {
    const s = await setup();
    const photos = await uploadPhotos(s, 2);
    delete process.env.ANTHROPIC_API_KEY;
    expect(errorCode(await fail(s.gm.action(api.photoImport.read, { campaignId: s.campaignId })))).toBe("PHOTO_IMPORT_UNAVAILABLE");
    expect(fetchMock).not.toHaveBeenCalled();
    for (const id of photos) expect(await blobExists(s, id)).toBe(false);
    expect(await photoRows(s)).toHaveLength(0);
  });

  it("fails without retrying when the API errors or answers off-schema, and deletes the photos", async () => {
    const s = await setup();
    let photos = await uploadPhotos(s, 1);
    fetchMock.mockResolvedValueOnce(new Response("overloaded", { status: 529 }));
    expect(errorCode(await fail(s.gm.action(api.photoImport.read, { campaignId: s.campaignId })))).toBe("PHOTO_IMPORT_FAILED");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await blobExists(s, photos[0]!)).toBe(false);

    photos = await uploadPhotos(s, 1);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(messagesResponse({ name: 42 })), { status: 200 }));
    expect(errorCode(await fail(s.gm.action(api.photoImport.read, { campaignId: s.campaignId })))).toBe("PHOTO_IMPORT_FAILED");
    expect(await blobExists(s, photos[0]!)).toBe(false);

    photos = await uploadPhotos(s, 1);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(messagesResponse(warriorReading, "refusal")), { status: 200 }));
    expect(errorCode(await fail(s.gm.action(api.photoImport.read, { campaignId: s.campaignId })))).toBe("PHOTO_IMPORT_FAILED");
    expect(await photoRows(s)).toHaveLength(0);
  });

  it("refuses to read with no photos uploaded", async () => {
    const s = await setup();
    expect(errorCode(await fail(s.gm.action(api.photoImport.read, { campaignId: s.campaignId })))).toBe("PHOTO_IMPORT_RULE");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("discard deletes uploaded photos without reading them", async () => {
    const s = await setup();
    const photos = await uploadPhotos(s, 2);
    expect(errorCode(await fail(s.player.mutation(api.photoImport.discard, { campaignId: s.campaignId })))).toBe("FORBIDDEN");
    await s.gm.mutation(api.photoImport.discard, { campaignId: s.campaignId });
    for (const id of photos) expect(await blobExists(s, id)).toBe(false);
  });

  it("saves the reviewed sheet at any level, for the chosen owner, and logs an import row", async () => {
    const s = await setup();
    const { characterId } = await s.gm.mutation(api.photoImport.create, { campaignId: s.campaignId, draft: validDraft(), ownerId: s.playerId, idempotencyKey: key() });
    const character = await s.t.run((ctx) => ctx.db.get("characters", characterId));
    expect(character).toMatchObject({ ownerId: s.playerId, status: "active", sheet: { level: 5, primaryWeaponId: "advanced-broadsword", schemaVersion: 2 } });
    const log = await s.t.run((ctx) =>
      ctx.db
        .query("actionLog")
        .withIndex("by_character_at", (q) => q.eq("characterId", characterId))
        .collect(),
    );
    expect(log).toEqual([expect.objectContaining({ kind: "import", visibility: "public", undoable: false })]);

    // The player sees it like any other character.
    const view = await s.player.query(api.characters.get, { characterId });
    expect(view?.sheet.level).toBe(5);
  });

  it("refuses players, rules problems and owners outside the campaign", async () => {
    const s = await setup();
    const base = { campaignId: s.campaignId, idempotencyKey: key() };
    expect(errorCode(await fail(s.player.mutation(api.photoImport.create, { ...base, draft: validDraft() })))).toBe("FORBIDDEN");
    expect(errorCode(await fail(s.gm.mutation(api.photoImport.create, { ...base, idempotencyKey: key(), draft: validDraft({ level: 4 }) })))).toBe("PHOTO_IMPORT_RULE");
    expect(errorCode(await fail(s.gm.mutation(api.photoImport.create, { ...base, idempotencyKey: key(), draft: validDraft({ name: "" }) })))).toBe("INVALID");
    const outsider = await s.t.run((ctx) => ctx.db.query("users").withIndex("email", (q) => q.eq("email", OTHER_EMAIL)).unique());
    expect(errorCode(await fail(s.gm.mutation(api.photoImport.create, { ...base, idempotencyKey: key(), draft: validDraft(), ownerId: outsider!._id })))).toBe("INVALID");
    // Without an owner the GM owns it.
    const { characterId } = await s.gm.mutation(api.photoImport.create, { ...base, idempotencyKey: key(), draft: validDraft() });
    const gmId = await s.t.run(async (ctx) => (await ctx.db.query("users").withIndex("email", (q) => q.eq("email", GM_EMAIL)).unique())!._id);
    expect((await s.t.run((ctx) => ctx.db.get("characters", characterId)))?.ownerId).toBe(gmId);
  });
});
