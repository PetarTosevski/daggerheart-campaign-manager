/**
 * dcm-yzxx: the World map's "Open in Codex" (`codex.mapLinks`). A player gets a link only for a Codex location the
 * party knows whose marker they can see; a hidden marker or a secret location never reaches them (neither id nor
 * name). The GM gets every linked location with its `known` flag. The map itself (`maps.get`) never gives a player a
 * hidden marker, so a hidden marker can never be clicked.
 */
import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { emptyEntry } from "../../src/lib/codex/schema";
import type { MapToken } from "../../src/lib/world/map-state";
import { errorCode, key } from "./helpers";
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
  const { campaignId } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Links", idempotencyKey: key() });
  const code = await gm.mutation(api.members.rotateJoinCode, { campaignId });
  await p1.mutation(api.members.joinByCode, { code });
  return { t, gm, p1, out, campaignId };
}

type T = Awaited<ReturnType<typeof setup>>["t"];

function token(id: number, over: Partial<MapToken> = {}): MapToken {
  return { id, type: "landmark", x: 20 + id * 10, y: 40, name: `Pin ${id}`, notes: "", hidden: false, location: true, ...over };
}

async function putTokens(t: T, campaignId: Id<"campaigns">, tokens: MapToken[]) {
  await t.run(async (ctx) => {
    for (const { id, ...fields } of tokens) await ctx.db.insert("mapTokens", { campaignId, tokenId: id, ...fields });
  });
}

async function location(t: T, campaignId: Id<"campaigns">, name: string, tokenId: number | null, known: boolean, createdAt: number) {
  return t.run((ctx) => ctx.db.insert("codexEntries", { campaignId, kind: "location", data: emptyEntry({ name, known, tokenId }), createdAt, updatedAt: createdAt }));
}

describe("codex.mapLinks (dcm-yzxx)", () => {
  it("gives a player only known locations on visible markers; the GM gets every link", async () => {
    const { t, gm, p1, campaignId } = await setup();
    await putTokens(t, campaignId, [token(1), token(2, { hidden: true }), token(3), token(4)]);
    const alula = await location(t, campaignId, "Alula", 1, true, 1);
    const hiddenPin = await location(t, campaignId, "Under the hill", 2, true, 2);
    const secret = await location(t, campaignId, "Secret keep", 3, false, 3);
    await location(t, campaignId, "Unpinned", null, true, 4);
    // A character linked to a marker is not a Codex location: never a map link.
    await t.run((ctx) => ctx.db.insert("codexEntries", { campaignId, kind: "character", data: emptyEntry({ name: "Kael", known: true, tokenId: 4 }), createdAt: 5, updatedAt: 5 }));

    const player = await p1.query(api.codex.mapLinks, { campaignId });
    expect(player).toEqual([{ tokenId: 1, entryId: alula, known: true }]);
    const text = JSON.stringify(player);
    expect(text).not.toContain(secret);
    expect(text).not.toContain(hiddenPin);
    expect(text).not.toContain("Secret keep");

    const gmLinks = await gm.query(api.codex.mapLinks, { campaignId });
    expect(gmLinks).toEqual([
      { tokenId: 1, entryId: alula, known: true },
      { tokenId: 2, entryId: hiddenPin, known: true },
      { tokenId: 3, entryId: secret, known: false },
    ]);

    // The player's map has neither the hidden marker nor its name, so it can't be clicked.
    const map = await p1.query(api.maps.get, { campaignId });
    expect(map.state.tokens.map((x) => x.id)).toEqual([1, 3, 4]);
    expect(JSON.stringify(map)).not.toContain("Pin 2");
  });

  it("follows the reveal: revealing the location or the marker gives the player the link", async () => {
    const { t, gm, p1, campaignId } = await setup();
    await putTokens(t, campaignId, [token(1, { hidden: true })]);
    const entry = await location(t, campaignId, "Ruins", 1, false, 1);
    expect(await p1.query(api.codex.mapLinks, { campaignId })).toEqual([]);

    await gm.mutation(api.codex.update, { entryId: entry, patch: { known: true } });
    expect(await p1.query(api.codex.mapLinks, { campaignId })).toEqual([]);

    await gm.mutation(api.maps.updateToken, { campaignId, id: 1, patch: { hidden: false } });
    expect(await p1.query(api.codex.mapLinks, { campaignId })).toEqual([{ tokenId: 1, entryId: entry, known: true }]);
  });

  it("refuses strangers without revealing the campaign", async () => {
    const { out, campaignId } = await setup();
    expect(errorCode(await out.query(api.codex.mapLinks, { campaignId }).catch((e: unknown) => e))).toBe("NOT_FOUND");
  });
});
