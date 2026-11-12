import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { characterDraft } from "../fixtures/characters";
import { errorCode, imageBlob, key } from "./helpers";
import { makeTest } from "./setup";

// Plan portrait-frame, PZ1: `characters.setPortraitFrame` (the close-up), who may set it, and what clears it.

async function setup() {
  const t = makeTest();
  const ids = await t.run(async (ctx) => ({
    gm: await ctx.db.insert("users", { email: "gm@example.com", emailVerificationTime: 1 }),
    p1: await ctx.db.insert("users", { email: "p1@example.com", emailVerificationTime: 1 }),
    p2: await ctx.db.insert("users", { email: "p2@example.com", emailVerificationTime: 1 }),
    stranger: await ctx.db.insert("users", { email: "x@example.com", emailVerificationTime: 1 }),
  }));
  const as = (id: string) => t.withIdentity({ subject: `${id}|s` });
  const [gm, p1, p2, stranger] = [as(ids.gm), as(ids.p1), as(ids.p2), as(ids.stranger)];
  const { campaignId } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Party", idempotencyKey: key() });
  const code = await gm.mutation(api.members.rotateJoinCode, { campaignId });
  await p1.mutation(api.members.joinByCode, { code });
  await p2.mutation(api.members.joinByCode, { code });
  const { characterId } = await p1.mutation(api.characters.create, { campaignId, draft: characterDraft("Ash"), idempotencyKey: key() });
  const frameOf = async () => (await p1.query(api.charactersReads.get, { characterId }))!.sheet.portraitFrame;
  return { t, gm, p1, p2, stranger, campaignId, characterId, frameOf };
}

const FRAME = { zoom: 2, x: 40, y: 25 };

describe("characters.setPortraitFrame", () => {
  it("a character without a frame reads as before (no portraitFrame)", async () => {
    const { frameOf, p2, characterId } = await setup();
    expect(await frameOf()).toBeUndefined();
    expect((await p2.query(api.charactersReads.get, { characterId }))!.sheet).not.toHaveProperty("portraitFrame");
  });

  it("the owner sets it, everyone in the campaign sees it, and null clears it", async () => {
    const { p1, p2, gm, campaignId, characterId, frameOf } = await setup();
    await p1.mutation(api.characters.setPortraitFrame, { characterId, frame: FRAME });
    expect(await frameOf()).toEqual(FRAME);
    // Another player and the GM see it: on the sheet, in the roster and on the dashboard's party card.
    expect((await p2.query(api.charactersReads.get, { characterId }))!.sheet.portraitFrame).toEqual(FRAME);
    expect((await gm.query(api.charactersReads.listByCampaign, { campaignId })).find((c) => c._id === characterId)!.sheet.portraitFrame).toEqual(FRAME);
    expect((await p2.query(api.charactersReads.partySummary, { campaignId })).find((c) => c._id === characterId)!.sheet.portraitFrame).toEqual(FRAME);

    await p1.mutation(api.characters.setPortraitFrame, { characterId, frame: null });
    expect(await frameOf()).toBeUndefined();
    // Clearing an absent frame is a no-op.
    await p1.mutation(api.characters.setPortraitFrame, { characterId, frame: null });
    expect(await frameOf()).toBeUndefined();
  });

  it("the GM sets it too; another player and an outsider are refused with a code", async () => {
    const { gm, p2, stranger, characterId, frameOf } = await setup();
    await gm.mutation(api.characters.setPortraitFrame, { characterId, frame: FRAME });
    expect(await frameOf()).toEqual(FRAME);
    expect(errorCode(await p2.mutation(api.characters.setPortraitFrame, { characterId, frame: null }).catch((e: unknown) => e))).toBe("FORBIDDEN");
    expect(errorCode(await stranger.mutation(api.characters.setPortraitFrame, { characterId, frame: null }).catch((e: unknown) => e))).toBe("NOT_FOUND");
    expect(await frameOf()).toEqual(FRAME);
  });

  it("refuses values out of range and rounds the rest to the frame's steps", async () => {
    const { p1, characterId, frameOf } = await setup();
    for (const frame of [
      { zoom: 0.9, x: 50, y: 50 },
      { zoom: 3.1, x: 50, y: 50 },
      { zoom: 2, x: -1, y: 50 },
      { zoom: 2, x: 50, y: 100.5 },
      { zoom: Number.NaN, x: 50, y: 50 },
    ]) {
      expect(errorCode(await p1.mutation(api.characters.setPortraitFrame, { characterId, frame }).catch((e: unknown) => e))).toBe("INVALID");
    }
    expect(await frameOf()).toBeUndefined();
    await p1.mutation(api.characters.setPortraitFrame, { characterId, frame: { zoom: 1.333, x: 12.345, y: 99.99 } });
    expect(await frameOf()).toEqual({ zoom: 1.35, x: 12.3, y: 100 });
  });

  it("another chosen art clears it; an edit that keeps the same art keeps it", async () => {
    const { p1, characterId, frameOf } = await setup();
    const art = { kind: "asset" as const, asset: "0".repeat(32) };
    await p1.mutation(api.characters.updateSheet, { characterId, patch: { portrait: art } });
    await p1.mutation(api.characters.setPortraitFrame, { characterId, frame: FRAME });
    await p1.mutation(api.characters.updateSheet, { characterId, patch: { portrait: art, name: "Ash Vale" } });
    await p1.mutation(api.characters.updateSheet, { characterId, patch: { notes: "Scar over one eye." } });
    expect(await frameOf()).toEqual(FRAME);
    await p1.mutation(api.characters.updateSheet, { characterId, patch: { portrait: { kind: "asset", asset: "1".repeat(32) } } });
    expect(await frameOf()).toBeUndefined();
  });

  it("a new upload clears it", async () => {
    const { t, p1, characterId, frameOf } = await setup();
    await p1.mutation(api.characters.setPortraitFrame, { characterId, frame: FRAME });
    const storageId = await t.run(async (ctx) => {
      const id = await ctx.storage.store(imageBlob("image/png"));
      // convex-test records no content type; set the one an upload would carry.
      await (ctx.db as unknown as { patch: (id: Id<"_storage">, value: { contentType: string }) => Promise<void> }).patch(id, { contentType: "image/png" });
      return id;
    });
    expect(await p1.mutation(api.characters.attachPortrait, { characterId, storageId })).toEqual({ error: null });
    expect(await frameOf()).toBeUndefined();
  });
});
