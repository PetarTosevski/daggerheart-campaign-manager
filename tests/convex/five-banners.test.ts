import type { FunctionReturnType } from "convex/server";
import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { errorCode, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

const PLAYER = "player@example.com";
const fb = api.trackers.fiveBanners;

async function setup(frameId: "five-banners-burning" | "witherwild" = "five-banners-burning") {
  const t = makeTest();
  const ids = await t.run(async (ctx) => ({
    gm: await ctx.db.insert("users", { email: "gm@example.com" }),
    player: await ctx.db.insert("users", { email: PLAYER }),
    stranger: await ctx.db.insert("users", { email: "other@example.com" }),
  }));
  const as = (id: string) => t.withIdentity({ subject: `${id}|session` });
  const gm = as(ids.gm);
  const player = as(ids.player);
  const stranger = as(ids.stranger);
  const { campaignId } = await gm.mutation(api.campaigns.create, { frameId, name: "Banners", idempotencyKey: key() });
  const code = await gm.mutation(api.members.rotateJoinCode, { campaignId });
  await player.mutation(api.members.joinByCode, { code });

  const createObjective = (
    nation: "armada" | "hilltop" | "jesthaen" | "polaris" | "voldaen",
    kind: "objective-major" | "objective-minor",
    steps: number,
    name = `${nation} ${kind} ${steps}`,
  ) => gm.mutation(fb.createObjective, { campaignId, nation, kind, name, notes: "GM notes", steps, idempotencyKey: key() });
  const view = (who = gm) => who.query(fb.state, { campaignId });
  return { t, gm, player, stranger, campaignId, createObjective, view };
}

const objective = (view: FunctionReturnType<typeof fb.state>, id: Id<"countdowns">) =>
  view?.nations.flatMap((n) => n.objectives).find((o) => o._id === id);

describe("Five Banners tracker", () => {
  useAllowlist(`gm@example.com,${PLAYER},other@example.com`);

  it("shows the GM the seeded relationships and sheets; players see nothing hidden", async () => {
    const { view, player, stranger, campaignId } = await setup();
    const gmView = await view();
    expect(gmView?.week).toBe(1);
    expect(gmView?.relationships).toHaveLength(10);
    expect(gmView?.relationships.find((r) => r.a === "armada" && r.b === "jesthaen")).toMatchObject({
      value: 2,
      label: "Allies",
      revealed: false,
    });
    expect(gmView?.nations.find((n) => n.id === "armada")?.sheet?.assets).toContain("Large and powerful navy");

    const playerView = await view(player);
    expect(playerView?.week).toBe(1);
    expect(playerView?.relationships).toEqual([]);
    expect(playerView?.nations.every((n) => n.sheet === null && n.objectives.length === 0)).toBe(true);

    expect(errorCode(await stranger.query(fb.state, { campaignId }).catch((e) => e))).toBe("NOT_FOUND");
  });

  it("sets a symmetric relationship within −3..+3", async () => {
    const { gm, campaignId, view } = await setup();
    await gm.mutation(fb.setRelationship, { campaignId, a: "voldaen", b: "armada", value: 0, idempotencyKey: key() });
    expect((await view())?.relationships.find((r) => r.a === "armada" && r.b === "voldaen")).toMatchObject({
      value: 0,
      label: "Neutral",
    });
    for (const bad of [{ value: 4 }, { value: -4 }, { value: 1.5 }, { b: "armada" as const }]) {
      const error = await gm
        .mutation(fb.setRelationship, { campaignId, a: "armada", b: "voldaen", value: 1, ...bad, idempotencyKey: key() })
        .catch((e) => e);
      expect(errorCode(error)).toBe("INVALID");
    }
  });

  it("reveals only the chosen items to players", async () => {
    const { gm, player, campaignId, view, createObjective } = await setup();
    const { countdownId: shown } = await createObjective("polaris", "objective-major", 10);
    await createObjective("polaris", "objective-minor", 4);
    await gm.mutation(fb.toggleReveal, { campaignId, target: { type: "relationship", a: "polaris", b: "hilltop" }, revealed: true, idempotencyKey: key() });
    await gm.mutation(fb.toggleReveal, { campaignId, target: { type: "sheet", nation: "jesthaen" }, revealed: true, idempotencyKey: key() });
    await gm.mutation(fb.toggleReveal, { campaignId, target: { type: "objective", countdownId: shown }, revealed: true, idempotencyKey: key() });

    const seen = await view(player);
    expect(seen?.relationships.map((r) => [r.a, r.b, r.label])).toEqual([["hilltop", "polaris", "Nemeses"]]);
    expect(seen?.nations.filter((n) => n.sheet !== null).map((n) => n.id)).toEqual(["jesthaen"]);
    const polaris = seen?.nations.find((n) => n.id === "polaris");
    expect(polaris?.objectives.map((o) => o._id)).toEqual([shown]);
    expect(polaris?.objectives[0]?.notes).toBe("");

    await gm.mutation(fb.toggleReveal, { campaignId, target: { type: "relationship", a: "hilltop", b: "polaris" }, revealed: false, idempotencyKey: key() });
    expect((await view(player))?.relationships).toEqual([]);
    // The generic countdown list never shows objectives.
    expect(await gm.query(api.countdowns.listByCampaign, { campaignId })).toEqual([]);
  });

  it("enforces objective sizes and one major + two minor per nation", async () => {
    const { createObjective, gm } = await setup();
    expect(errorCode(await createObjective("armada", "objective-major", 6).catch((e) => e))).toBe("INVALID");
    expect(errorCode(await createObjective("armada", "objective-minor", 7).catch((e) => e))).toBe("INVALID");
    const { countdownId: major } = await createObjective("armada", "objective-major", 10);
    expect(errorCode(await createObjective("armada", "objective-major", 10).catch((e) => e))).toBe("OBJECTIVE_LIMIT");
    await createObjective("armada", "objective-minor", 4);
    await createObjective("armada", "objective-minor", 6);
    expect(errorCode(await createObjective("armada", "objective-minor", 5).catch((e) => e))).toBe("OBJECTIVE_LIMIT");
    // Other nations have their own slots.
    await createObjective("hilltop", "objective-major", 10);
    // Cancelling frees the slot.
    await gm.mutation(fb.operateObjective, { countdownId: major, action: "cancel", idempotencyKey: key() });
    await createObjective("armada", "objective-major", 10);
    expect(errorCode(await gm.mutation(fb.operateObjective, { countdownId: major, action: "resume", idempotencyKey: key() }).catch((e) => e))).toBe(
      "COUNTDOWN_RULE",
    );
  });

  it("blocks reopening a completed objective when the nation's slot is taken", async () => {
    const { createObjective, gm, view } = await setup();
    const { countdownId: first } = await createObjective("voldaen", "objective-minor", 4);
    for (let i = 0; i < 4; i++) await gm.mutation(fb.operateObjective, { countdownId: first, action: "advance", idempotencyKey: key() });
    expect(objective(await view(), first)?.status).toBe("completed");
    await createObjective("voldaen", "objective-minor", 5);
    await createObjective("voldaen", "objective-minor", 6);
    const op = (action: "reverse" | "dismiss") => gm.mutation(fb.operateObjective, { countdownId: first, action, idempotencyKey: key() });
    expect(errorCode(await op("reverse").catch((e) => e))).toBe("OBJECTIVE_LIMIT");
    await op("dismiss");
    expect(objective(await view(), first)).toBeUndefined();
  });

  it("advances the week and one chosen objective per nation", async () => {
    const { gm, campaignId, createObjective, view } = await setup();
    const { countdownId: a } = await createObjective("armada", "objective-minor", 4);
    const { countdownId: a2 } = await createObjective("armada", "objective-major", 10);
    const { countdownId: h } = await createObjective("hilltop", "objective-minor", 4);
    for (let i = 0; i < 3; i++) await gm.mutation(fb.operateObjective, { countdownId: h, action: "advance", idempotencyKey: key() });

    const result = await gm.mutation(fb.advanceWeek, {
      campaignId,
      picks: [
        { nation: "armada", objectiveId: a },
        { nation: "hilltop", objectiveId: h },
      ],
      idempotencyKey: key(),
    });
    expect(result).toMatchObject({ week: 2, completed: [{ nation: "hilltop" }], warning: null });
    const after = await view();
    expect(after?.week).toBe(2);
    expect(objective(after, a)?.currentValue).toBe(3);
    expect(objective(after, a2)?.currentValue).toBe(10);
    expect(objective(after, h)).toMatchObject({ currentValue: 0, status: "completed" });

    const bad = [
      [{ nation: "armada" as const, objectiveId: a }, { nation: "armada" as const, objectiveId: a2 }],
      [{ nation: "hilltop" as const, objectiveId: a }],
      [{ nation: "hilltop" as const, objectiveId: h }],
    ];
    for (const picks of bad) {
      expect(errorCode(await gm.mutation(fb.advanceWeek, { campaignId, picks, idempotencyKey: key() }).catch((e) => e))).toBe("WEEK_RULE");
    }
    expect((await view())?.week).toBe(2);
    // Skipping every nation still passes the week.
    await gm.mutation(fb.advanceWeek, { campaignId, picks: [], idempotencyKey: key() });
    expect((await view())?.week).toBe(3);
  });

  it("replays a retried request instead of applying it twice", async () => {
    const { gm, campaignId, createObjective, view } = await setup();
    const { countdownId } = await createObjective("jesthaen", "objective-major", 10);
    const k = key();
    const args = { campaignId, picks: [{ nation: "jesthaen" as const, objectiveId: countdownId }], idempotencyKey: k };
    const first = await gm.mutation(fb.advanceWeek, args);
    expect(await gm.mutation(fb.advanceWeek, args)).toEqual(first);
    const after = await view();
    expect(after?.week).toBe(2);
    expect(objective(after, countdownId)?.currentValue).toBe(9);

    const createKey = key();
    const create = { campaignId, nation: "polaris" as const, kind: "objective-minor" as const, name: "Mines", notes: "", steps: 5, idempotencyKey: createKey };
    const created = await gm.mutation(fb.createObjective, create);
    expect(await gm.mutation(fb.createObjective, create)).toEqual(created);
    expect((await view())?.nations.find((n) => n.id === "polaris")?.objectives).toHaveLength(1);
    expect(errorCode(await gm.mutation(fb.createObjective, { ...create, steps: 6 }).catch((e) => e))).toBe("IDEMPOTENCY_MISMATCH");
  });

  it("lets only the GM change it", async () => {
    const { player, campaignId, createObjective } = await setup();
    const { countdownId } = await createObjective("armada", "objective-minor", 4);
    for (const call of [
      player.mutation(fb.setRelationship, { campaignId, a: "armada", b: "hilltop", value: 0, idempotencyKey: key() }),
      player.mutation(fb.setNationSheet, { campaignId, nation: "armada", assets: [], problems: [], idempotencyKey: key() }),
      player.mutation(fb.toggleReveal, { campaignId, target: { type: "sheet", nation: "armada" }, revealed: true, idempotencyKey: key() }),
      player.mutation(fb.operateObjective, { countdownId, action: "advance", idempotencyKey: key() }),
      player.mutation(fb.advanceWeek, { campaignId, picks: [], idempotencyKey: key() }),
    ]) {
      expect(errorCode(await call.catch((e) => e))).toBe("FORBIDDEN");
    }
  });

  it("edits a nation sheet", async () => {
    const { gm, campaignId, view } = await setup();
    await gm.mutation(fb.setNationSheet, {
      campaignId,
      nation: "hilltop",
      assets: [" Holy relic ", ""],
      problems: ["Famine"],
      idempotencyKey: key(),
    });
    expect((await view())?.nations.find((n) => n.id === "hilltop")?.sheet).toEqual({ assets: ["Holy relic"], problems: ["Famine"] });
  });

  it("is disabled in other frames", async () => {
    const { gm, campaignId, view } = await setup("witherwild");
    expect(await view()).toBeNull();
    for (const call of [
      gm.mutation(fb.setRelationship, { campaignId, a: "armada", b: "hilltop", value: 0, idempotencyKey: key() }),
      gm.mutation(fb.createObjective, { campaignId, nation: "armada", kind: "objective-minor", name: "x", notes: "", steps: 4, idempotencyKey: key() }),
      gm.mutation(fb.advanceWeek, { campaignId, picks: [], idempotencyKey: key() }),
    ]) {
      expect(errorCode(await call.catch((e) => e))).toBe("MECHANIC_DISABLED");
    }
  });
});
