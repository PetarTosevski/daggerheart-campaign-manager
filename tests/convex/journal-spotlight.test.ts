import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { campaignFearState } from "../../convex/lib/fear";
import { moveToGm } from "../../convex/lib/spotlight";
import { allowWorldEmails, buildWorld, type World } from "./authz/world";
import { key } from "./helpers";

// Journal JD1 (plan .omc/plans/journal.yaml, user answer 2026-11-03 "spotlight per PC per live session"): every real
// move of the spotlight to a specific PC while a session is live adds 1 to that PC's `sessionSpotlights` row, inside
// the move's keyed `once`. Moves to the GM, to an adversary (free or for Fear) and to the whole party do not count;
// neither do moves without a live session. `sessionPlay.spotlight` reads the counts, `resetSpotlight` zeroes them.
// Access is unchanged (the existing combatSpotlight / sessionPlay entries in the authz matrix).

allowWorldEmails();

async function setup() {
  const w = await buildWorld();
  const gm = w.as("gm");
  const { campaignId, characterA: a, characterB: b } = w;
  const handTo = (characterId: Id<"characters">, idempotencyKey = key()) =>
    gm.mutation(api.combatSpotlight.handTo, { campaignId, characterId, idempotencyKey });
  const party = () => gm.mutation(api.combatSpotlight.handToParty, { campaignId, idempotencyKey: key() });
  const take = (pay?: "free" | "fear") =>
    gm.mutation(api.combatSpotlight.gmTake, { campaignId, idempotencyKey: key(), ...(pay === undefined ? {} : { pay }) });
  const start = async () => (await gm.mutation(api.sessions.start, { campaignId, idempotencyKey: key() })).sessionId!;
  const end = () => gm.mutation(api.sessions.end, { campaignId, idempotencyKey: key() });
  /** The raw rows as { characterId: count }. */
  const counts = async (sessionId?: Id<"sessions">) => {
    const rows = await w.t.run((ctx) => ctx.db.query("sessionSpotlights").collect());
    return Object.fromEntries(rows.filter((r) => sessionId === undefined || r.sessionId === sessionId).map((r) => [r.characterId, r.count]));
  };
  return { w, gm, campaignId, a, b, handTo, party, take, start, end, counts };
}

const setFear = (w: World, n: number) =>
  w.t.run(async (ctx) => {
    const s = await campaignFearState(ctx, w.campaignId);
    await ctx.db.patch("campaignState", s._id, { fear: n });
  });

describe("spotlight auto-count per live session (JD1)", () => {
  it("a GM hand-to during a live session counts; sessionPlay.spotlight returns the counts and who is due", async () => {
    const s = await setup();
    const sessionId = await s.start();
    expect(await s.handTo(s.a)).toEqual({ moved: true });
    expect(await s.counts(sessionId)).toEqual({ [s.a]: 1 });

    const view = await s.gm.query(api.sessionPlay.spotlight, { campaignId: s.campaignId, sessionId });
    expect(view.map((e) => [e.characterId, e.count, e.due])).toEqual([
      [s.a, 1, false],
      [s.b, 0, true],
    ]);
  });

  it("handing it twice to the same PC without a move in between counts once; a move away and back counts again", async () => {
    const s = await setup();
    const sessionId = await s.start();
    await s.handTo(s.a);
    expect(await s.handTo(s.a)).toEqual({ moved: false });
    expect(await s.counts(sessionId)).toEqual({ [s.a]: 1 });

    await s.handTo(s.b);
    await s.handTo(s.a);
    expect(await s.counts(sessionId)).toEqual({ [s.a]: 2, [s.b]: 1 });

    // Through the GM and back: the hand-back is a real move.
    await s.take();
    await s.handTo(s.a);
    expect(await s.counts(sessionId)).toEqual({ [s.a]: 3, [s.b]: 1 });
  });

  it("moves to the GM, to the whole party and paid interrupts never count", async () => {
    const s = await setup();
    const sessionId = await s.start();
    await setFear(s.w, 3);
    await s.handTo(s.a);
    expect(await s.take("free")).toEqual({ moved: true });
    expect(await s.party()).toEqual({ moved: true });
    expect(await s.take("fear")).toEqual({ moved: true });
    // The engine's move on a roll with Fear.
    await s.party();
    await s.w.t.run(async (ctx) => {
      const campaign = (await ctx.db.get("campaigns", s.campaignId))!;
      await moveToGm(ctx, campaign, "rollWithFear", s.a);
    });
    expect(await s.counts(sessionId)).toEqual({ [s.a]: 1 });

    // From the party (no holder) to a PC is a real move: it counts.
    await s.party();
    await s.handTo(s.a);
    expect(await s.counts(sessionId)).toEqual({ [s.a]: 2 });
  });

  it("without a live session nothing counts: before the start and after the end", async () => {
    const s = await setup();
    await s.handTo(s.a);
    expect(await s.counts()).toEqual({});

    const sessionId = await s.start();
    await s.handTo(s.b);
    await s.end();
    await s.handTo(s.a);
    expect(await s.counts()).toEqual({ [s.b]: 1 });
    expect(await s.counts(sessionId)).toEqual({ [s.b]: 1 });
  });

  it("a retry with the same idempotency key counts once", async () => {
    const s = await setup();
    const sessionId = await s.start();
    const k = key();
    await s.handTo(s.a, k);
    await s.handTo(s.b);
    // The retry replays the first result; the spotlight stays with B and A is not counted again.
    expect(await s.handTo(s.a, k)).toEqual({ moved: true });
    expect(await s.counts(sessionId)).toEqual({ [s.a]: 1, [s.b]: 1 });
    const state = await s.gm.query(api.combatSpotlight.state, { campaignId: s.campaignId });
    expect(state.holder).toMatchObject({ kind: "pc", characterId: s.b });
  });

  it("the GM's reset zeroes the counts; later moves count from zero; the manual bump still adds", async () => {
    const s = await setup();
    const sessionId = await s.start();
    await s.handTo(s.a);
    await s.handTo(s.b);
    await s.gm.mutation(api.sessionPlay.resetSpotlight, { campaignId: s.campaignId, sessionId });
    expect(await s.counts(sessionId)).toEqual({});

    await s.handTo(s.a);
    await s.gm.mutation(api.sessionPlay.bumpSpotlight, { campaignId: s.campaignId, sessionId, characterId: s.a, idempotencyKey: key() });
    expect(await s.counts(sessionId)).toEqual({ [s.a]: 2 });
  });
});
