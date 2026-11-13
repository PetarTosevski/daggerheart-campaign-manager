import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { DEFAULT_MODEL, PHOTO_MAX_BYTES } from "../../convex/photoImport";
import { draftFromReading, SHEET_READING_JSON_SCHEMA, type SheetWire } from "../../src/lib/import/sheet-photo";
import { messagesResponse, validDraft, warriorReading } from "../fixtures/photo-import";
import { errorCode, errorData, GM_EMAIL, imageBlob, imageBytes, key, OTHER_EMAIL, setupWithCampaign, useAllowlist } from "./helpers";

const PLAYER_EMAIL = "player@example.com";

/** `warriorReading` as the API sends it (dcm-5378): no nulls, 0 for the unreadable numbers, which are listed by path. */
const warriorWire: SheetWire = {
  name: "Brenna Ashfall",
  pronouns: "she/her",
  description: "Scarred veteran with a red cloak.",
  level: 5,
  className: "Warior",
  subclassName: "Call of the Brav",
  ancestry: "Dwarf / Elf",
  community: "Ridgeborne",
  traits: { agility: 2, strength: 2, finesse: 1, instinct: 0, presence: 0, knowledge: -1 },
  evasion: 11,
  hpMax: 7,
  hpMarked: 2,
  stressMax: 6,
  stressMarked: 1,
  hope: 3,
  armorMarked: 1,
  proficiency: 2,
  primaryWeapon: "Advnced Broadsword",
  secondaryWeapon: "Improved Round Shield",
  armor: "Improved Gambeson",
  experiences: [
    { name: "Sellsword", value: 2 },
    { name: "Mountain Guide", value: 0 },
  ],
  domainCards: ["Get Back Up", "Whirlwind", "Reckles", "Sword Dance", "Vitality"],
  inventory: ["Torch", "50 feet of rope", "Minor Health Potion"],
  gold: { handfuls: 3, bags: 1, chest: false },
  unreadable: ["traits.instinct", "experiences.1.value"],
  uncertain: [],
};

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
    const id = await ctx.storage.store(imageBlob(contentType, bytes));
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
    fetchMock.mockResolvedValue(new Response(JSON.stringify(messagesResponse(warriorWire)), { status: 200 }));
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

  it("claims at most four JPEG, PNG or WebP photos of at most 3.5 MB, deleting rejected files", async () => {
    const s = await setup();
    expect(PHOTO_MAX_BYTES).toBe(3.5 * 1024 * 1024);
    const gif = await store(s, "image/gif");
    expect(await s.gm.mutation(api.photoImport.claim, { campaignId: s.campaignId, storageId: gif })).toEqual({ ok: false, code: "PHOTO_IMPORT_FILE" });
    expect(await blobExists(s, gif)).toBe(false);
    const huge = await store(s, "image/png", 3.5 * 1024 * 1024 + 1);
    expect(await s.gm.mutation(api.photoImport.claim, { campaignId: s.campaignId, storageId: huge })).toEqual({ ok: false, code: "PHOTO_IMPORT_FILE" });
    expect(await blobExists(s, huge)).toBe(false);

    const webp = await store(s, "image/webp");
    expect(await s.gm.mutation(api.photoImport.claim, { campaignId: s.campaignId, storageId: webp })).toEqual({ ok: true });
    const largest = await store(s, "image/jpeg", 3.5 * 1024 * 1024);
    expect(await s.gm.mutation(api.photoImport.claim, { campaignId: s.campaignId, storageId: largest })).toEqual({ ok: true });
    await uploadPhotos(s, 2);
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
    // The same result as the nullable reading gave before the wire shape changed (dcm-5378).
    expect(result).toEqual(draftFromReading(warriorReading, false));

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

  it("sends each photo's exact bytes as base64 in a well-formed body", async () => {
    const s = await setup();
    // 100 001 bytes: several encoding slices, and a length that isn't a multiple of 3.
    const bytes = Uint8Array.from({ length: 100_001 }, (_, i) => (i * 37) % 256);
    bytes.set(imageBytes("image/png").subarray(0, 8)); // the byte check (CF16) needs a real PNG header
    const storageId = await s.t.run(async (ctx) => {
      const id = await ctx.storage.store(new Blob([bytes], { type: "image/png" }));
      await (ctx.db as unknown as { patch: (id: Id<"_storage">, value: { contentType: string }) => Promise<void> }).patch(id, { contentType: "image/png" });
      return id;
    });
    expect(await s.gm.mutation(api.photoImport.claim, { campaignId: s.campaignId, storageId })).toEqual({ ok: true });
    await s.gm.action(api.photoImport.read, { campaignId: s.campaignId });

    const body = JSON.parse(fetchMock.mock.calls[0]![1]?.body as string) as {
      max_tokens: number;
      output_config: { effort: string; format: { type: string; schema: unknown } };
      messages: { role: string; content: { type: string; text?: string; source?: { media_type: string; data: string } }[] }[];
    };
    expect(body.max_tokens).toBe(8000);
    expect(body.output_config.effort).toBe("low");
    expect(body.output_config.format).toEqual({ type: "json_schema", schema: SHEET_READING_JSON_SCHEMA });
    expect(body.messages).toHaveLength(1);
    const [image, text] = body.messages[0]!.content;
    expect(image!.source!.media_type).toBe("image/png");
    expect(Uint8Array.from(atob(image!.source!.data), (c) => c.charCodeAt(0))).toEqual(bytes);
    expect(text!.type).toBe("text");
    expect(text!.text!.length).toBeGreaterThan(0);
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

  // PS2 (dcm-ccnm): each way the API can't be reached, with the reason key it maps to.
  const UNREACHABLE: { name: string; response: () => Promise<Response>; reason: string }[] = [
    { name: "529", response: async () => new Response('{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}', { status: 529 }), reason: "overloaded" },
    { name: "503", response: async () => new Response("unavailable", { status: 503 }), reason: "overloaded" },
    { name: "429", response: async () => new Response('{"type":"error","error":{"type":"rate_limit_error","message":"Slow down"}}', { status: 429 }), reason: "rateLimited" },
    { name: "401", response: async () => new Response('{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}', { status: 401 }), reason: "key" },
    { name: "403", response: async () => new Response('{"type":"error","error":{"type":"permission_error","message":"no"}}', { status: 403 }), reason: "key" },
    { name: "402", response: async () => new Response("payment required", { status: 402 }), reason: "credits" },
    {
      name: "400 credit balance",
      response: async () =>
        new Response('{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}', { status: 400 }),
      reason: "credits",
    },
    {
      name: "400 our request",
      response: async () => new Response('{"type":"error","error":{"type":"invalid_request_error","message":"Schemas contains too many parameters with union types"}}', { status: 400 }),
      reason: "other",
    },
    { name: "500", response: async () => new Response("oops", { status: 500 }), reason: "other" },
    {
      name: "network",
      response: () => Promise.reject(new TypeError("fetch failed")),
      reason: "network",
    },
  ];

  for (const { name, response, reason } of UNREACHABLE) {
    it(`gives PHOTO_IMPORT_UNREACHABLE (${reason}) for ${name}, keeps the photos, and Try again reads them`, async () => {
      const s = await setup();
      const photos = await uploadPhotos(s, 2);
      fetchMock.mockImplementationOnce(response);
      const error = await fail(s.gm.action(api.photoImport.read, { campaignId: s.campaignId }));
      expect(errorCode(error)).toBe("PHOTO_IMPORT_UNREACHABLE");
      expect((errorData(error) as { reason?: unknown }).reason).toBe(reason);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      for (const id of photos) expect(await blobExists(s, id)).toBe(true);
      expect(await photoRows(s)).toHaveLength(2);

      // Try again: the same stored photos, no new upload; this time the reply arrives and the photos go.
      const result = await s.gm.action(api.photoImport.read, { campaignId: s.campaignId });
      expect(result.draft.name).toBe("Brenna Ashfall");
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const images = (JSON.parse(fetchMock.mock.calls[1]![1]?.body as string) as { messages: { content: { type: string }[] }[] }).messages[0]!.content.filter((c) => c.type === "image");
      expect(images).toHaveLength(2);
      for (const id of photos) expect(await blobExists(s, id)).toBe(false);
      expect(await photoRows(s)).toHaveLength(0);
    });
  }

  it("gives PHOTO_IMPORT_UNREACHABLE (timeout) after 120 s and keeps the photos", async () => {
    const s = await setup();
    const photos = await uploadPhotos(s, 1);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      fetchMock.mockImplementationOnce(
        (_url, init) =>
          new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
      );
      const pending = fail(s.gm.action(api.photoImport.read, { campaignId: s.campaignId }));
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      await vi.advanceTimersByTimeAsync(120_000);
      const error = await pending;
      expect(errorCode(error)).toBe("PHOTO_IMPORT_UNREACHABLE");
      expect((errorData(error) as { reason?: unknown }).reason).toBe("timeout");
    } finally {
      vi.useRealTimers();
    }
    expect(await blobExists(s, photos[0]!)).toBe(true);
  });

  it("never rejects a reply: off-schema, refused, cut-off or non-JSON replies give a draft and delete the photos", async () => {
    const s = await setup();
    const read = () => s.gm.action(api.photoImport.read, { campaignId: s.campaignId });

    // Partly off-schema: the valid fields are kept, the rest unreadable.
    let photos = await uploadPhotos(s, 1);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(messagesResponse({ ...warriorWire, name: 42, level: "five", domainCards: ["Get Back Up", 3] })), { status: 200 }));
    let result = await read();
    expect(result.blank).toBe(false);
    expect(result.draft).toMatchObject({ name: "", classId: "warrior", primaryWeaponId: "advanced-broadsword", domainCards: ["get-back-up"] });
    expect(result.unreadable).toEqual(expect.arrayContaining(["name", "level", "domainCards"]));
    expect(await blobExists(s, photos[0]!)).toBe(false);

    // Uncertain fields come back as such, the guess kept.
    photos = await uploadPhotos(s, 1);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(messagesResponse({ ...warriorWire, uncertain: ["name", "className"] })), { status: 200 }));
    result = await read();
    expect(result.draft).toMatchObject({ name: "Brenna Ashfall", classId: "warrior" });
    expect(result.uncertain).toEqual(["name", "classId"]);

    // The old nullable shape still has usable fields (dcm-5378's text and lists); its nulls become unreadable.
    photos = await uploadPhotos(s, 1);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(messagesResponse(warriorReading)), { status: 200 }));
    result = await read();
    expect(result.blank).toBe(false);
    expect(result.draft.classId).toBe("warrior");

    // Nothing usable: a refusal, a cut-off reply, non-JSON text, an empty object.
    const blanks = [
      messagesResponse(warriorWire, "refusal"),
      messagesResponse(warriorWire, "max_tokens"),
      { ...messagesResponse(warriorWire), content: [{ type: "text", text: "I can't read these photos." }] },
      messagesResponse({}),
    ];
    for (const reply of blanks) {
      photos = await uploadPhotos(s, 1);
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(reply), { status: 200 }));
      result = await read();
      expect(result.blank).toBe(true);
      expect(result.unreadable).toContain("name");
      expect(await blobExists(s, photos[0]!)).toBe(false);
    }
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
    const view = await s.player.query(api.charactersReads.get, { characterId });
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
