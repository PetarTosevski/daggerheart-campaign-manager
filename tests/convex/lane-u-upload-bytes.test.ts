import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet } from "../../convex/lib/characterSheet";
import { storedEntry } from "../../convex/lib/codex";
import { sniffImageType } from "../../convex/lib/files";
import { writableMap } from "../../convex/lib/maps";
import { key, setupWithCampaign } from "./helpers";

// Lane U (bead dcm-bxp.93, CF16): every upload path schedules a byte check after its size and recorded-type check.
// A file whose first bytes are not the recorded image type (an SVG or HTML body sent as image/png) is taken off its
// record and deleted; a real PNG, JPEG, WebP or GIF header stays.

const MAGIC: Record<string, number[]> = {
  "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  "image/jpeg": [0xff, 0xd8, 0xff, 0xe0],
  "image/gif": [...Buffer.from("GIF89a")],
  "image/webp": [...Buffer.from("RIFF"), 0x24, 0, 0, 0, ...Buffer.from("WEBP")],
};
const SVG = new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`);
const HTML = new TextEncoder().encode("<!doctype html><script>alert(1)</script>");

/** `size` bytes that start with `head`. */
function bytesOf(head: ArrayLike<number>, size = 64): Uint8Array {
  const out = new Uint8Array(Math.max(size, head.length));
  out.set(Array.from(head));
  return out;
}

describe("sniffImageType", () => {
  it("reads png, jpeg, webp and gif magic numbers", () => {
    for (const [type, head] of Object.entries(MAGIC)) expect(sniffImageType(bytesOf(head, 12))).toBe(type);
    expect(sniffImageType(bytesOf(Buffer.from("GIF87a"), 12))).toBe("image/gif");
  });

  it("finds no image type in SVG, HTML, a RIFF that isn't WebP, a cut-off header or nothing", () => {
    expect(sniffImageType(SVG)).toBeNull();
    expect(sniffImageType(HTML)).toBeNull();
    expect(sniffImageType(bytesOf([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WAVE")], 12))).toBeNull();
    expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(sniffImageType(new Uint8Array())).toBeNull();
  });
});

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

const LABELS = {
  name: "Standing stone",
  category: "object",
  w: 1,
  h: 1,
  sight: "block",
  light: "none",
  height: "tall",
  footprint: "circle",
  classicKind: "pillar",
  px: { w: 160, h: 160 },
} as const;

async function setup() {
  const s = await setupWithCampaign();
  const { t, gm, campaignId } = s;
  // convex-test records no content type, so set the one an upload would carry (as upload-claims.test.ts does).
  const store = (contentType: string, bytes: Uint8Array) =>
    t.run(async (c) => {
      const id = await c.storage.store(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: contentType }));
      await (c.db as unknown as { patch: (id: Id<"_storage">, value: { contentType: string }) => Promise<void> }).patch(id, { contentType });
      return id;
    });
  const settle = () => t.finishAllScheduledFunctions(vi.runAllTimers);
  /** Whether the blob and its `files` row both still exist. */
  const kept = (storageId: Id<"_storage">) =>
    t.run(async (c) => {
      const blob = await c.storage.get(storageId);
      const row = await c.db
        .query("files")
        .withIndex("by_storage", (q) => q.eq("storageId", storageId))
        .first();
      return { blob: blob !== null, row: row !== null };
    });
  return { ...s, t, gm, campaignId, store, settle, kept };
}
type Setup = Awaited<ReturnType<typeof setup>>;

/** One upload path: attaches `storageId` and reports whether the attached record now refers to it. */
type UploadPath = {
  name: string;
  prepare: (s: Setup) => Promise<{
    attach: (storageId: Id<"_storage">) => Promise<unknown>;
    refers: (storageId: Id<"_storage">) => Promise<boolean>;
  }>;
};

const PATHS: UploadPath[] = [
  {
    name: "maps.attachMapImage",
    prepare: async ({ t, gm, campaignId }) => ({
      attach: (storageId) => gm.mutation(api.maps.attachMapImage, { campaignId, storageId, width: 100, height: 80 }),
      refers: (storageId) =>
        t.run(async (c) => {
          const campaign = (await c.db.get("campaigns", campaignId))!;
          return (await writableMap(c, campaign)).scalars.customMap?.storageId === storageId;
        }),
    }),
  },
  {
    name: "codex.attachImage",
    prepare: async ({ t, gm, campaignId }) => {
      const { entryId } = await gm.mutation(api.codex.create, { campaignId, kind: "location", idempotencyKey: key() });
      return {
        attach: (storageId) => gm.mutation(api.codex.attachImage, { entryId, storageId }),
        refers: (storageId) =>
          t.run(async (c) => {
            const { summary } = storedEntry((await c.db.get("codexEntries", entryId))!.data);
            return summary.images.some((g) => g.storageId === storageId) || summary.cover === storageId;
          }),
      };
    },
  },
  {
    name: "characters.attachPortrait",
    prepare: async ({ t, gm, campaignId }) => {
      const characterId = await t.run(async (c) => {
        const ownerId = (await c.db.get("campaigns", campaignId))!.ownerId;
        return c.db.insert("characters", { campaignId, ownerId, createdBy: ownerId, status: "active", sheet, createdAt: 0, updatedAt: 0 });
      });
      return {
        attach: (storageId) => gm.mutation(api.characters.attachPortrait, { characterId, storageId }),
        refers: (storageId) =>
          t.run(async (c) => {
            const portrait = readSheet((await c.db.get("characters", characterId))!.sheet).portrait;
            return portrait?.kind === "upload" && portrait.storageId === storageId;
          }),
      };
    },
  },
  {
    name: "combatMaps.attachImage (new map)",
    prepare: async ({ t, gm, campaignId }) => {
      let mapId: Id<"combatMaps"> | null = null;
      return {
        attach: async (storageId) => {
          const result = await gm.mutation(api.combatMaps.attachImage, { campaignId, storageId, width: 1200, height: 800 });
          if (result.ok) mapId = result.mapId;
          return result;
        },
        refers: (storageId) =>
          t.run(async (c) => {
            const map = mapId === null ? null : await c.db.get("combatMaps", mapId);
            const file = map?.image ? await c.db.get("files", map.image.fileId) : null;
            return file?.storageId === storageId;
          }),
      };
    },
  },
  {
    name: "combatMaps.attachImage (replacing a map's layout)",
    prepare: async ({ t, gm, campaignId }) => {
      const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
      return {
        attach: (storageId) => gm.mutation(api.combatMaps.attachImage, { campaignId, mapId, storageId, width: 1200, height: 800 }),
        refers: (storageId) =>
          t.run(async (c) => {
            const map = await c.db.get("combatMaps", mapId);
            const file = map?.image ? await c.db.get("files", map.image.fileId) : null;
            return file?.storageId === storageId;
          }),
      };
    },
  },
  {
    name: "spritePacks.attachSprite",
    prepare: async ({ t, gm, campaignId }) => {
      const { packId } = await gm.mutation(api.spritePacks.createPack, { campaignId, name: "Moors", extends: "forest", idempotencyKey: key() });
      return {
        attach: (storageId) => gm.mutation(api.spritePacks.attachSprite, { campaignId, packId, storageId, ...LABELS }),
        refers: (storageId) =>
          t.run(async (c) => {
            const sprites = await c.db
              .query("spritePackSprites")
              .withIndex("by_pack_order", (q) => q.eq("packId", packId))
              .collect();
            for (const sprite of sprites) if ((await c.db.get("files", sprite.fileId))?.storageId === storageId) return true;
            return false;
          }),
      };
    },
  },
  {
    name: "photoImport.claim",
    prepare: async ({ t, gm, campaignId }) => ({
      attach: (storageId) => gm.mutation(api.photoImport.claim, { campaignId, storageId }),
      refers: (storageId) =>
        t.run(async (c) => {
          const row = await c.db
            .query("files")
            .withIndex("by_storage", (q) => q.eq("storageId", storageId))
            .first();
          return row?.kind === "photoImport" && row.refId === campaignId;
        }),
    }),
  },
];

describe("upload byte check on every upload path", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  for (const path of PATHS) {
    // Photo import takes no GIF (PHOTO_TYPES).
    const types = path.name === "photoImport.claim" ? ["image/png", "image/jpeg", "image/webp"] : Object.keys(MAGIC);

    it(`${path.name}: keeps a file whose bytes are the recorded image type`, async () => {
      const s = await setup();
      const { attach, refers } = await path.prepare(s);
      for (const type of types) {
        const storageId = await s.store(type, bytesOf(MAGIC[type]!));
        await attach(storageId);
        await s.settle();
        expect(await refers(storageId), type).toBe(true);
        expect(await s.kept(storageId), type).toEqual({ blob: true, row: true });
        // Photo import holds at most four; drop this one so the next type fits.
        if (path.name === "photoImport.claim") await s.gm.mutation(api.photoImport.discard, { campaignId: s.campaignId });
      }
    });

    it(`${path.name}: deletes an SVG or HTML body sent as image/png, or a PNG recorded as JPEG, and clears its record`, async () => {
      const s = await setup();
      const { attach, refers } = await path.prepare(s);
      const bodies: [string, Uint8Array][] = [
        ["image/png", SVG],
        ["image/png", HTML],
        ["image/jpeg", bytesOf(MAGIC["image/png"]!)],
      ];
      for (const [type, body] of bodies) {
        const storageId = await s.store(type, body);
        await attach(storageId);
        // Attached until the scheduled check runs: the metadata check alone passes it.
        expect(await refers(storageId)).toBe(true);
        await s.settle();
        expect(await refers(storageId)).toBe(false);
        expect(await s.kept(storageId)).toEqual({ blob: false, row: false });
      }
    });
  }

  it("a rejected replacement leaves no image, and the previous upload stays deleted", async () => {
    const s = await setup();
    const good = await s.store("image/png", bytesOf(MAGIC["image/png"]!));
    await s.gm.mutation(api.maps.attachMapImage, { campaignId: s.campaignId, storageId: good, width: 100, height: 80 });
    await s.settle();
    const bad = await s.store("image/png", SVG);
    await s.gm.mutation(api.maps.attachMapImage, { campaignId: s.campaignId, storageId: bad, width: 100, height: 80 });
    await s.settle();
    expect(await s.kept(good)).toEqual({ blob: false, row: false });
    expect(await s.kept(bad)).toEqual({ blob: false, row: false });
    const customMap = await s.t.run(async (c) => (await writableMap(c, (await c.db.get("campaigns", s.campaignId))!)).scalars.customMap);
    expect(customMap ?? null).toBeNull();
  });

  it("rejecting a bad sprite removes only that sprite from its pack", async () => {
    const s = await setup();
    const { packId } = await s.gm.mutation(api.spritePacks.createPack, { campaignId: s.campaignId, name: "Moors", extends: "forest", idempotencyKey: key() });
    const good = await s.store("image/webp", bytesOf(MAGIC["image/webp"]!));
    const bad = await s.store("image/webp", HTML);
    await s.gm.mutation(api.spritePacks.attachSprite, { campaignId: s.campaignId, packId, storageId: good, ...LABELS });
    await s.gm.mutation(api.spritePacks.attachSprite, { campaignId: s.campaignId, packId, storageId: bad, ...LABELS, name: "Bad" });
    await s.settle();
    const names = await s.t.run(async (c) =>
      (
        await c.db
          .query("spritePackSprites")
          .withIndex("by_pack_order", (q) => q.eq("packId", packId))
          .collect()
      ).map((r) => r.name),
    );
    expect(names).toEqual(["Standing stone"]);
  });

  it("a duplicated image map's copied file is checked too, and a good copy stays", async () => {
    const s = await setup();
    const storageId = await s.store("image/png", bytesOf(MAGIC["image/png"]!));
    const result = await s.gm.mutation(api.combatMaps.attachImage, { campaignId: s.campaignId, storageId, width: 1200, height: 800 });
    if (!result.ok) throw new Error(result.message);
    await s.settle();
    const { mapId: copy } = await s.gm.mutation(api.combatMaps.duplicate, { campaignId: s.campaignId, mapId: result.mapId, idempotencyKey: key() });
    await s.settle();
    const copied = await s.t.run(async (c) => {
      const map = await c.db.get("combatMaps", copy);
      return map?.image ? ((await c.db.get("files", map.image.fileId))?.storageId ?? null) : null;
    });
    expect(copied).not.toBeNull();
    expect(copied).not.toBe(storageId);
    expect(await s.kept(copied!)).toEqual({ blob: true, row: true });
  });

  it("a file removed before its check runs is left alone", async () => {
    const s = await setup();
    const { entryId } = await s.gm.mutation(api.codex.create, { campaignId: s.campaignId, kind: "location", idempotencyKey: key() });
    const bad = await s.store("image/png", SVG);
    await s.gm.mutation(api.codex.attachImage, { entryId, storageId: bad });
    await s.gm.mutation(api.codex.removeImage, { entryId, storageId: bad });
    await s.settle();
    expect(await s.kept(bad)).toEqual({ blob: false, row: false });
  });
});
