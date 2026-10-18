import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import { makeTest } from "./setup";

const GM_EMAIL = "gm@example.com";

async function setup() {
  const t = makeTest();
  const gmId = await t.run((ctx) => ctx.db.insert("users", { email: GM_EMAIL }));
  return { gm: t.withIdentity({ subject: `${gmId}|session` }) };
}

type Gm = Awaited<ReturnType<typeof setup>>["gm"];

async function hopeAndFearOf(gm: Gm, frameId: "witherwild" | "castle-high", name: string) {
  const { campaignId } = await gm.mutation(api.campaigns.create, { frameId, name, idempotencyKey: name });
  const campaign = await gm.query(api.campaigns.get, { campaignId });
  return campaign!.options.hopeAndFear;
}

describe("settings: Expansions default (XS1)", () => {
  const previous = process.env.GM_EMAILS;
  beforeEach(() => {
    process.env.GM_EMAILS = GM_EMAIL;
  });
  afterEach(() => {
    process.env.GM_EMAILS = previous;
  });

  it("is unset by default and saves alongside the other settings", async () => {
    const { gm } = await setup();
    expect((await gm.query(api.settings.get, {})).expansions).toEqual({});
    await gm.mutation(api.settings.update, { expansions: { hopeAndFear: true } });
    await gm.mutation(api.settings.update, { tableName: "Thursday Crew" });
    expect(await gm.query(api.settings.get, {})).toMatchObject({
      tableName: "Thursday Crew",
      expansions: { hopeAndFear: true },
    });
  });

  it("unset: every frame keeps its own default", async () => {
    const { gm } = await setup();
    expect(await hopeAndFearOf(gm, "witherwild", "Core")).toBe(false);
    expect(await hopeAndFearOf(gm, "castle-high", "Expansion")).toBe(true);
  });

  it("on: new campaigns of any frame start with Hope & Fear", async () => {
    const { gm } = await setup();
    await gm.mutation(api.settings.update, { expansions: { hopeAndFear: true } });
    expect(await hopeAndFearOf(gm, "witherwild", "Core")).toBe(true);
    expect(await hopeAndFearOf(gm, "castle-high", "Expansion")).toBe(true);
  });

  it("off: new campaigns start without it, even in a Hope & Fear frame", async () => {
    const { gm } = await setup();
    await gm.mutation(api.settings.update, { expansions: { hopeAndFear: false } });
    expect(await hopeAndFearOf(gm, "witherwild", "Core")).toBe(false);
    expect(await hopeAndFearOf(gm, "castle-high", "Expansion")).toBe(false);
  });

  it("null clears the setting back to each frame's default", async () => {
    const { gm } = await setup();
    await gm.mutation(api.settings.update, { expansions: { hopeAndFear: false } });
    await gm.mutation(api.settings.update, { expansions: { hopeAndFear: null } });
    expect((await gm.query(api.settings.get, {})).expansions).toEqual({});
    expect(await hopeAndFearOf(gm, "castle-high", "Expansion")).toBe(true);
  });

  it("each campaign keeps its own switch afterwards", async () => {
    const { gm } = await setup();
    await gm.mutation(api.settings.update, { expansions: { hopeAndFear: true } });
    const { campaignId } = await gm.mutation(api.campaigns.create, {
      frameId: "witherwild",
      name: "Own switch",
      idempotencyKey: "own",
    });
    await gm.mutation(api.campaigns.setOption, { campaignId, option: "hopeAndFear", enabled: false });
    expect((await gm.query(api.campaigns.get, { campaignId }))!.options.hopeAndFear).toBe(false);
    expect((await gm.query(api.settings.get, {})).expansions).toEqual({ hopeAndFear: true });
  });
});
