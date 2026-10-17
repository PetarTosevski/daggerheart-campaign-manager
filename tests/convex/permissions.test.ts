import { describe, expect, it } from "vitest";

import { api, internal } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import { upsertGrant } from "../../convex/lib/permissions";
import { errorData, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

const GM = "gm@example.com";
const OUTSIDER = "outsider@example.com";
const OTHER_GM = "othergm@example.com";
const OTHER_PLAYER = "otherplayer@example.com";

describe("grants", () => {
  useAllowlist(`${GM},${OUTSIDER},${OTHER_GM},${OTHER_PLAYER}`);

  async function setup() {
    const t = makeTest();
    const ids = await t.run(async (ctx) => ({
      gm: await ctx.db.insert("users", { email: GM, emailVerificationTime: 1 }),
      outsider: await ctx.db.insert("users", { email: OUTSIDER, emailVerificationTime: 1 }),
      otherGm: await ctx.db.insert("users", { email: OTHER_GM, emailVerificationTime: 1 }),
      otherPlayer: await ctx.db.insert("users", { email: OTHER_PLAYER, emailVerificationTime: 1 }),
    }));
    const as = (id: string) => t.withIdentity({ subject: `${id}|s` });
    const gm = as(ids.gm);
    const { campaignId } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Shared", idempotencyKey: key() });
    const visible = await gm.mutation(api.maps.addToken, { campaignId, type: "village", x: 10, y: 10, idempotencyKey: key() });
    const hidden = await gm.mutation(api.maps.addToken, { campaignId, type: "cave", x: 20, y: 20, idempotencyKey: key() });
    await gm.mutation(api.maps.updateToken, { campaignId, id: visible.id, patch: { notes: "GM secret" } });
    await gm.mutation(api.maps.updateToken, { campaignId, id: hidden.id, patch: { name: "Wyrm lair", hidden: true } });
    // Another campaign with its own GM and player.
    const otherGm = as(ids.otherGm);
    const { campaignId: other } = await otherGm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Other", idempotencyKey: key() });
    await otherGm.mutation(api.members.invite, { campaignId: other, email: OTHER_PLAYER });
    await as(ids.otherPlayer).mutation(api.campaigns.markOpened, { campaignId: other });
    return { t, ids, gm, outsider: as(ids.outsider), otherPlayer: as(ids.otherPlayer), campaignId, other, visible };
  }

  type Grant = Pick<Doc<"grants">, "resourceType" | "resourceId" | "principalKind" | "principalId" | "permission" | "createdBy">;

  it("without grants an outsider has no access", async () => {
    const { outsider, campaignId } = await setup();
    expect(errorData(await outsider.query(api.maps.get, { campaignId }).catch((e) => e))).toBe("NOT_FOUND");
    expect(errorData(await outsider.query(api.codex.list, { campaignId }).catch((e) => e))).toBe("NOT_FOUND");
    expect(errorData(await outsider.query(api.characters.listByCampaign, { campaignId }).catch((e) => e))).toBe("NOT_FOUND");
  });

  it("a view grant to another campaign's user gives the player-filtered map, read-only", async () => {
    const { t, ids, outsider, campaignId, visible } = await setup();
    await t.run((ctx) =>
      upsertGrant(ctx, { resourceType: "map", resourceId: campaignId, principalKind: "user", principalId: ids.outsider, permission: "view", createdBy: ids.gm }),
    );
    const view = await outsider.query(api.maps.get, { campaignId });
    expect(view.role).toBe("player");
    expect(view.state.tokens).toEqual([{ id: visible.id, type: "village", x: 10, y: 10, name: "Village", notes: "", hidden: false, location: false }]);
    expect(JSON.stringify(view)).not.toMatch(/Wyrm lair|GM secret/);
    expect(errorData(await outsider.mutation(api.maps.addToken, { campaignId, type: "camp", x: 1, y: 1, idempotencyKey: key() }).catch((e) => e))).toBe("FORBIDDEN");
    // The grant is on the map only: the codex stays hidden.
    expect(errorData(await outsider.query(api.codex.list, { campaignId }).catch((e) => e))).toBe("NOT_FOUND");
  });

  it("a view grant to a campaign reaches its members", async () => {
    const { t, ids, otherPlayer, campaignId, other } = await setup();
    await t.run((ctx) =>
      upsertGrant(ctx, { resourceType: "map", resourceId: campaignId, principalKind: "campaign", principalId: other, permission: "view", createdBy: ids.gm }),
    );
    const view = await otherPlayer.query(api.maps.get, { campaignId });
    expect(view.role).toBe("player");
    expect(JSON.stringify(view)).not.toMatch(/Wyrm lair|GM secret/);
  });

  it("an edit grant allows map edits and gives the GM view", async () => {
    const { t, ids, outsider, campaignId } = await setup();
    const grant: Grant = { resourceType: "map", resourceId: campaignId, principalKind: "user", principalId: ids.outsider, permission: "view", createdBy: ids.gm };
    await t.run((ctx) => upsertGrant(ctx, grant));
    await t.run((ctx) => upsertGrant(ctx, { ...grant, permission: "edit" }));
    // One row per (resource, principal): the second grant replaced the first.
    expect(await t.run(async (ctx) => (await ctx.db.query("grants").collect()).map((g) => g.permission))).toEqual(["edit"]);

    const view = await outsider.query(api.maps.get, { campaignId });
    expect(view.role).toBe("gm");
    expect(JSON.stringify(view)).toMatch(/Wyrm lair/);
    const { id } = await outsider.mutation(api.maps.addToken, { campaignId, type: "camp", x: 1, y: 1, idempotencyKey: key() });
    expect((await outsider.query(api.maps.get, { campaignId })).state.tokens.some((tok) => tok.id === id)).toBe(true);
  });
});

describe("migrations:moveUploadsToFiles", () => {
  useAllowlist(GM);

  it("copies the old upload tables into files, once", async () => {
    const t = makeTest();
    const gmId = await t.run((ctx) => ctx.db.insert("users", { email: GM, emailVerificationTime: 1 }));
    const gm = t.withIdentity({ subject: `${gmId}|s` });
    const { campaignId } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Old", idempotencyKey: key() });
    const { entryId } = await gm.mutation(api.codex.create, { campaignId, kind: "character", idempotencyKey: key() });
    const ids = await t.run(async (ctx) => {
      const store = () => ctx.storage.store(new Blob(["png"], { type: "image/png" }));
      const characterId = await ctx.db.insert("characters", { campaignId, ownerId: gmId, createdBy: gmId, status: "active", sheet: {}, createdAt: 0, updatedAt: 0 });
      const map = await store();
      const image = await store();
      const portrait = await store();
      await ctx.db.insert("mapUploads", { storageId: map, campaignId, uploadedBy: gmId, createdAt: 1 });
      await ctx.db.insert("codexImages", { storageId: image, campaignId, entryId, uploadedBy: gmId, createdAt: 2 });
      await ctx.db.insert("portraitUploads", { storageId: portrait, userId: gmId, characterId, createdAt: 3 });
      return { characterId, map, image, portrait };
    });

    expect(await t.mutation(internal.migrations.moveUploadsToFiles, {})).toEqual({ copied: 3, alreadyMoved: 0, skipped: 0 });
    expect(await t.mutation(internal.migrations.moveUploadsToFiles, {})).toEqual({ copied: 0, alreadyMoved: 3, skipped: 0 });
    const files = await t.run((ctx) => ctx.db.query("files").collect());
    expect(files.map(({ storageId, campaignId: c, uploadedBy, kind, refId, createdAt }) => ({ storageId, c, uploadedBy, kind, refId, createdAt }))).toEqual([
      { storageId: ids.map, c: campaignId, uploadedBy: gmId, kind: "map", refId: campaignId, createdAt: 1 },
      { storageId: ids.image, c: campaignId, uploadedBy: gmId, kind: "codexImage", refId: entryId, createdAt: 2 },
      { storageId: ids.portrait, c: campaignId, uploadedBy: gmId, kind: "portrait", refId: ids.characterId, createdAt: 3 },
    ]);
  });
});
