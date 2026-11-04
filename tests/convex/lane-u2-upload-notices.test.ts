import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { MAX_UPLOAD_NOTICES } from "../../convex/lib/files";
import { errorCode, imageBytes, key, setupWithCampaign } from "./helpers";

// Tracer U2 (bead dcm-vqs0): the byte check (CF16) leaves the uploader a notice when it removes a file whose bytes are
// no allowed image; a real image recorded as another type is kept and its type recorded on its `files` row (a
// photo-import photo is stored again under the right type, since `photoImport.read` sends the blob's type).

const SVG = new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`);

const sheet = {
  name: "Ash",
  pronouns: "",
  description: "",
  level: 1,
  classId: "warrior",
  subclassId: "call-of-the-brave",
  ancestry: { kind: "single", id: "human" },
  communityId: "wildborne",
  traits: { agility: 2, strength: 1, finesse: 1, instinct: 0, presence: 0, knowledge: -1 },
  traitMarks: {},
  evasion: 11,
  hpMax: 6,
  hp: 0,
  stressMax: 6,
  stress: 0,
  hope: 2,
  scars: 0,
  armorMarked: 0,
  proficiency: 1,
  primaryWeaponId: "broadsword",
  inventory: [],
  gold: { handfuls: 1, bags: 0, chest: false },
  experiences: [],
  domainCards: { owned: [], loadout: [] },
  background: [],
  connections: [],
  notes: "",
};

async function setup() {
  const s = await setupWithCampaign();
  const { t } = s;
  // convex-test records no content type, so set the one an upload would carry (as upload-claims.test.ts does).
  const store = (contentType: string, bytes: Uint8Array) =>
    t.run(async (c) => {
      const id = await c.storage.store(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: contentType }));
      await (c.db as unknown as { patch: (id: Id<"_storage">, value: { contentType: string }) => Promise<void> }).patch(id, { contentType });
      return id;
    });
  const settle = () => t.finishAllScheduledFunctions(vi.runAllTimers);
  const fileRows = () => t.run((c) => c.db.query("files").collect());
  const blobExists = (storageId: Id<"_storage">) => t.run(async (c) => (await c.storage.get(storageId)) !== null);
  const attachMap = (storageId: Id<"_storage">) => s.gm.mutation(api.maps.attachMapImage, { campaignId: s.campaignId, storageId, width: 100, height: 80 });
  return { ...s, store, settle, fileRows, blobExists, attachMap };
}

describe("upload notices (dcm-vqs0)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("a rejected map image leaves its uploader one notice on the map screen, which they dismiss", async () => {
    const s = await setup();
    await s.attachMap(await s.store("image/png", SVG));
    const args = { kind: "map", scope: s.campaignId } as const;
    expect(await s.gm.query(api.uploadNotices.mine, args)).toEqual([]);
    await s.settle();
    const notices = await s.gm.query(api.uploadNotices.mine, args);
    expect(notices).toHaveLength(1);
    // Only the uploader sees it, and only on that screen.
    expect(await s.other.query(api.uploadNotices.mine, args)).toEqual([]);
    expect(await s.gm.query(api.uploadNotices.mine, { kind: "photoImport", scope: s.campaignId })).toEqual([]);
    // Someone else cannot dismiss it.
    const refused = await s.other.mutation(api.uploadNotices.dismiss, { noticeId: notices[0]!._id }).catch((e: unknown) => e);
    expect(errorCode(refused)).toBe("NOT_FOUND");
    await s.gm.mutation(api.uploadNotices.dismiss, { noticeId: notices[0]!._id });
    expect(await s.gm.query(api.uploadNotices.mine, args)).toEqual([]);
    // Dismissing again is a no-op.
    await s.gm.mutation(api.uploadNotices.dismiss, { noticeId: notices[0]!._id });
  });

  it("a good upload leaves no notice", async () => {
    const s = await setup();
    await s.attachMap(await s.store("image/png", imageBytes("image/png")));
    await s.settle();
    expect(await s.gm.query(api.uploadNotices.mine, { kind: "map", scope: s.campaignId })).toEqual([]);
  });

  it(`keeps at most ${MAX_UPLOAD_NOTICES} notices per user, dropping the oldest`, async () => {
    const s = await setup();
    for (let i = 0; i < MAX_UPLOAD_NOTICES + 2; i++) {
      await s.attachMap(await s.store("image/png", SVG));
      await s.settle();
    }
    const rows = await s.t.run((c) => c.db.query("uploadNotices").collect());
    expect(rows).toHaveLength(MAX_UPLOAD_NOTICES);
  });

  it("scopes a portrait notice to the character and a sprite notice to its pack", async () => {
    const s = await setup();
    const characterId = await s.t.run(async (c) => {
      const ownerId = (await c.db.get("campaigns", s.campaignId))!.ownerId;
      return c.db.insert("characters", { campaignId: s.campaignId, ownerId, createdBy: ownerId, status: "active", sheet, createdAt: 0, updatedAt: 0 });
    });
    await s.gm.mutation(api.characters.attachPortrait, { characterId, storageId: await s.store("image/png", SVG) });
    const { packId } = await s.gm.mutation(api.spritePacks.createPack, { campaignId: s.campaignId, name: "Moors", extends: "forest", idempotencyKey: key() });
    await s.gm.mutation(api.spritePacks.attachSprite, {
      campaignId: s.campaignId,
      packId,
      storageId: await s.store("image/webp", SVG),
      name: "Bad",
      category: "object",
      w: 1,
      h: 1,
      sight: "block",
      light: "none",
      height: "tall",
      footprint: "circle",
      classicKind: "pillar",
      px: { w: 160, h: 160 },
    });
    await s.settle();
    expect(await s.gm.query(api.uploadNotices.mine, { kind: "portrait", scope: characterId })).toHaveLength(1);
    expect(await s.gm.query(api.uploadNotices.mine, { kind: "sprite", scope: packId })).toHaveLength(1);
  });
});

describe("a real image recorded as another type (dcm-vqs0)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is kept, and its files row records the type its bytes show", async () => {
    const s = await setup();
    const storageId = await s.store("image/jpeg", imageBytes("image/png"));
    await s.attachMap(storageId);
    await s.settle();
    expect(await s.blobExists(storageId)).toBe(true);
    const rows = await s.fileRows();
    expect(rows.map((r) => [r.storageId, r.contentType])).toEqual([[storageId, "image/png"]]);
    expect(await s.gm.query(api.uploadNotices.mine, { kind: "map", scope: s.campaignId })).toEqual([]);
  });

  it("a correctly recorded image gets no type on its row", async () => {
    const s = await setup();
    await s.attachMap(await s.store("image/png", imageBytes("image/png")));
    await s.settle();
    expect((await s.fileRows())[0]!.contentType).toBeUndefined();
  });

  it("a photo-import photo is stored again under the type its bytes show", async () => {
    const s = await setup();
    const storageId = await s.store("image/jpeg", imageBytes("image/png"));
    await s.gm.mutation(api.photoImport.claim, { campaignId: s.campaignId, storageId });
    await s.settle();
    const rows = await s.fileRows();
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.kind).toBe("photoImport");
    expect(row.contentType).toBe("image/png");
    expect(row.storageId).not.toBe(storageId);
    expect(await s.blobExists(storageId)).toBe(false);
    const blobType = await s.t.run(async (c) => (await c.storage.get(row.storageId))?.type);
    expect(blobType).toBe("image/png");
  });

  it("a photo-import photo whose bytes are a GIF is removed with a notice (photo import takes no GIF)", async () => {
    const s = await setup();
    const storageId = await s.store("image/jpeg", imageBytes("image/gif"));
    await s.gm.mutation(api.photoImport.claim, { campaignId: s.campaignId, storageId });
    await s.settle();
    expect(await s.fileRows()).toEqual([]);
    expect(await s.blobExists(storageId)).toBe(false);
    expect(await s.gm.query(api.uploadNotices.mine, { kind: "photoImport", scope: s.campaignId })).toHaveLength(1);
  });
});
