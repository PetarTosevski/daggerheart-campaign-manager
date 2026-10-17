import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { errorData, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

const GM = "gm@example.com";
const VICTIM = "victim@example.com";
const PLAYER = "player@example.com";

describe("uploads claimed elsewhere", () => {
  useAllowlist(`${GM},${VICTIM},${PLAYER}`);

  async function setup() {
    const t = makeTest();
    const ids = await t.run(async (ctx) => ({
      gm: await ctx.db.insert("users", { email: GM }),
      victim: await ctx.db.insert("users", { email: VICTIM }),
      player: await ctx.db.insert("users", { email: PLAYER }),
    }));
    const gm = t.withIdentity({ subject: `${ids.gm}|s` });
    const victim = t.withIdentity({ subject: `${ids.victim}|s` });
    const player = t.withIdentity({ subject: `${ids.player}|s` });
    const { campaignId } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Mine", idempotencyKey: key() });
    await gm.mutation(api.members.invite, { campaignId, email: PLAYER });
    const { campaignId: theirs } = await victim.mutation(api.campaigns.create, { frameId: "witherwild", name: "Theirs", idempotencyKey: key() });
    return { t, ids, gm, victim, player, campaignId, theirs };
  }

  // A minimal sheet that passes characterSheetSchema (the ids aren't checked against the SRD here).
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
  const character = (t: ReturnType<typeof makeTest>, campaignId: Id<"campaigns">, ownerId: Id<"users">) =>
    t.run((ctx) => ctx.db.insert("characters", { campaignId, ownerId, createdBy: ownerId, status: "active", sheet, createdAt: 0, updatedAt: 0 }));

  it("no attach mutation can claim (or delete) a file another table recorded", async () => {
    const { t, ids, gm, victim, campaignId, theirs } = await setup();
    // The victim's campaign holds one file of each kind.
    const { entryId: theirEntry } = await victim.mutation(api.codex.create, { campaignId: theirs, kind: "character", idempotencyKey: key() });
    const theirCharacter = await character(t, theirs, ids.victim);
    const files = await t.run(async (ctx) => {
      const store = () => ctx.storage.store(new Blob(["png"], { type: "image/png" }));
      const map = await store();
      const codex = await store();
      const portrait = await store();
      const claim = { campaignId: theirs, uploadedBy: ids.victim, createdAt: 0 };
      await ctx.db.insert("files", { ...claim, storageId: map, kind: "map", refId: theirs });
      await ctx.db.insert("files", { ...claim, storageId: codex, kind: "codexImage", refId: theirEntry });
      await ctx.db.insert("files", { ...claim, storageId: portrait, kind: "portrait", refId: theirCharacter });
      return { map, codex, portrait };
    });

    const { entryId } = await gm.mutation(api.codex.create, { campaignId, kind: "location", idempotencyKey: key() });
    const characterId = await character(t, campaignId, ids.gm);
    const attempts = (storageId: Id<"_storage">) => [
      () => gm.mutation(api.maps.attachMapImage, { campaignId, storageId, width: 10, height: 10 }),
      () => gm.mutation(api.codex.attachImage, { entryId, storageId }),
      () => gm.mutation(api.characters.attachPortrait, { characterId, storageId }),
    ];
    for (const storageId of Object.values(files)) {
      for (const attempt of attempts(storageId)) expect(errorData(await attempt().catch((e) => e))).toBe("NOT_FOUND");
      expect(await t.run((ctx) => ctx.storage.getUrl(storageId))).toEqual(expect.any(String));
    }
    expect(await t.run(async (ctx) => (await ctx.db.query("files").collect()).map((f) => f.kind).sort())).toEqual(["codexImage", "map", "portrait"]);
  });

  it("attach mutations accept png, jpeg, webp and gif, and reject and delete anything else", async () => {
    const { t, ids, gm, campaignId } = await setup();
    const { entryId } = await gm.mutation(api.codex.create, { campaignId, kind: "location", idempotencyKey: key() });
    const characterId = await character(t, campaignId, ids.gm);
    // convex-test records no content type, so set the one an upload would carry
    // (system tables aren't writable in the types, but convex-test allows it).
    const upload = (contentType: string) =>
      t.run(async (ctx) => {
        const id = await ctx.storage.store(new Blob(["img"], { type: contentType }));
        await (ctx.db as unknown as { patch: (id: Id<"_storage">, value: { contentType: string }) => Promise<void> }).patch(id, { contentType });
        return id;
      });
    const attempts = [
      async (storageId: Id<"_storage">) => (await gm.mutation(api.maps.attachMapImage, { campaignId, storageId, width: 10, height: 10 })).ok,
      async (storageId: Id<"_storage">) => (await gm.mutation(api.codex.attachImage, { entryId, storageId })).error === null,
      async (storageId: Id<"_storage">) => (await gm.mutation(api.characters.attachPortrait, { characterId, storageId })).error === null,
    ];
    const kept = (storageId: Id<"_storage">) => t.run(async (ctx) => (await ctx.storage.getUrl(storageId)) !== null);

    for (const attach of attempts) {
      for (const type of ["image/svg+xml", "image/x-foo"]) {
        const storageId = await upload(type);
        expect([type, await attach(storageId), await kept(storageId)]).toEqual([type, false, false]);
      }
      for (const type of ["image/png", "image/jpeg", "image/webp", "image/gif"]) {
        const storageId = await upload(type);
        expect([type, await attach(storageId), await kept(storageId)]).toEqual([type, true, true]);
      }
    }
  });

  it("players never receive the map's storage id, marker counter or unused marker types", async () => {
    const { t, ids, gm, player, campaignId } = await setup();
    await gm.mutation(api.maps.renameType, { campaignId, typeId: "village", label: "Hamlet" });
    await gm.mutation(api.maps.renameType, { campaignId, typeId: "cave", label: "Secret lair" });
    const { id: shownType } = await gm.mutation(api.maps.addCustomType, { campaignId, label: "Shrine", icon: "temple", color: "#5a2a6a", idempotencyKey: key() });
    const { id: hiddenType } = await gm.mutation(api.maps.addCustomType, { campaignId, label: "Dragon nest", icon: "cave", color: "#5a2a6a", idempotencyKey: key() });
    await gm.mutation(api.maps.addToken, { campaignId, type: "village", x: 1, y: 1, idempotencyKey: key() });
    await gm.mutation(api.maps.addToken, { campaignId, type: shownType, x: 2, y: 2, idempotencyKey: key() });
    const { id: hidden } = await gm.mutation(api.maps.addToken, { campaignId, type: hiddenType, x: 3, y: 3, idempotencyKey: key() });
    await gm.mutation(api.maps.updateToken, { campaignId, id: hidden, patch: { hidden: true } });

    // Attach an uploaded map the way attachMapImage records it (convex-test has no content types).
    const storageId = await t.run(async (ctx) => {
      const id = await ctx.storage.store(new Blob(["png"], { type: "image/png" }));
      await ctx.db.insert("files", { storageId: id, campaignId, uploadedBy: ids.gm, kind: "map", refId: campaignId, createdAt: 0 });
      const row = (await ctx.db
        .query("maps")
        .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
        .unique())!;
      await ctx.db.patch(row._id, { data: { ...row.data, customMap: { storageId: id, width: 800, height: 600 } } });
      return id;
    });

    const gmView = await gm.query(api.maps.get, { campaignId });
    expect(gmView.state.customMap).toEqual({ storageId, width: 800, height: 600 });
    expect(gmView.state.nextId).toBe(4);

    const view = await player.query(api.maps.get, { campaignId });
    expect(view.mapUrl).toEqual(expect.any(String));
    expect(view.state.customMap).toEqual({ width: 800, height: 600 });
    expect(view.state.nextId).toBe(1);
    expect(view.state.customTypes.map((c) => c.id)).toEqual([shownType]);
    expect(view.state.typeLabels).toEqual({ village: "Hamlet" });
    expect(JSON.stringify(view)).not.toContain(storageId);
    expect(JSON.stringify(view)).not.toMatch(/Dragon nest|Secret lair/);
  });
});
