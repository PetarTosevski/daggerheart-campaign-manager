import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { pcPortrait } from "../../convex/lib/pcPortrait";
import { readSheet } from "../../convex/lib/characterSheet";
import { characterDraft } from "../fixtures/characters";
import { imageBlob, key, setupWithCampaign } from "./helpers";

// Plan portrait-frame, PZ2: `pcPortrait` returns the sheet's saved close-up as the portrait's `frame`, so the token and
// vision queries carry it with no extra query; a character without one reads exactly as before (no `frame` key).

const FRAME = { zoom: 2, x: 40, y: 25 };

async function withMap() {
  const { t, gm, other: player, campaignId } = await setupWithCampaign();
  const code = await gm.mutation(api.members.rotateJoinCode, { campaignId });
  await player.mutation(api.members.joinByCode, { code });
  const { characterId: ash } = await player.mutation(api.characters.create, { campaignId, draft: characterDraft("Ash"), idempotencyKey: key() });
  const { characterId: bryn } = await gm.mutation(api.characters.create, { campaignId, draft: characterDraft("Bryn"), idempotencyKey: key() });
  const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
  await gm.mutation(api.combatTokens.addParty, { campaignId, mapId, idempotencyKey: key() });
  const portraitOf = async (name: string) => (await gm.query(api.combatTokensReads.list, { campaignId, mapId })).find((tk) => tk.name === name)!.portrait;
  return { t, gm, player, campaignId, mapId, ash, bryn, portraitOf };
}

describe("pcPortrait carries the close-up", () => {
  it("no frame: the token's portrait has no frame key (today's shape)", async () => {
    const { portraitOf } = await withMap();
    const portrait = await portraitOf("Ash");
    expect(portrait).not.toBeNull();
    expect(portrait).not.toHaveProperty("frame");
  });

  it("a saved frame reaches the map token (default art) and only that character's", async () => {
    const { player, ash, portraitOf } = await withMap();
    await player.mutation(api.characters.setPortraitFrame, { characterId: ash, frame: FRAME });
    expect(await portraitOf("Ash")).toMatchObject({ kind: "asset", frame: FRAME });
    expect(await portraitOf("Bryn")).not.toHaveProperty("frame");
    // Cleared: back to the shape of before.
    await player.mutation(api.characters.setPortraitFrame, { characterId: ash, frame: null });
    expect(await portraitOf("Ash")).not.toHaveProperty("frame");
  });

  it("the player's own view (combatVision.playerView) carries it on their PC token", async () => {
    const { player, campaignId, ash } = await withMap();
    await player.mutation(api.characters.setPortraitFrame, { characterId: ash, frame: FRAME });
    const view = await player.query(api.combatVision.playerView, { campaignId });
    if (view.state !== "ok") throw new Error(`expected a view, got ${view.state}`);
    expect(view.pcs.find((pc) => pc.characterId === ash)!.portrait).toMatchObject({ frame: FRAME });
  });

  it("an uploaded portrait (url) carries it too", async () => {
    const { t, player, ash, portraitOf } = await withMap();
    const storageId = await t.run(async (ctx) => {
      const id = await ctx.storage.store(imageBlob("image/png"));
      // convex-test records no content type; set the one an upload would carry.
      await (ctx.db as unknown as { patch: (id: Id<"_storage">, value: { contentType: string }) => Promise<void> }).patch(id, { contentType: "image/png" });
      return id;
    });
    expect(await player.mutation(api.characters.attachPortrait, { characterId: ash, storageId })).toEqual({ error: null });
    expect(await portraitOf("Ash")).toMatchObject({ kind: "url" });
    expect(await portraitOf("Ash")).not.toHaveProperty("frame");
    await player.mutation(api.characters.setPortraitFrame, { characterId: ash, frame: FRAME });
    expect(await portraitOf("Ash")).toMatchObject({ kind: "url", frame: FRAME });
  });

  it("pcPortrait itself: frame from the sheet, none without", async () => {
    const { t, player, ash } = await withMap();
    const read = () =>
      t.run(async (ctx) => {
        const character = (await ctx.db.get("characters", ash))!;
        return pcPortrait(ctx, ash, readSheet(character.sheet));
      });
    expect(await read()).not.toHaveProperty("frame");
    await player.mutation(api.characters.setPortraitFrame, { characterId: ash, frame: FRAME });
    expect(await read()).toMatchObject({ frame: FRAME });
  });
});
