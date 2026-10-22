import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import { settingsBackupText } from "../../src/lib/validation/settings-backup";
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

/** The ConvexError payload of a refused call (rule 14: assert data.code, never message text). */
async function rejection(call: Promise<unknown>): Promise<{ code?: string }> {
  const error = await call.then(
    () => {
      throw new Error("expected the call to be refused");
    },
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ConvexError);
  return (error as ConvexError<{ code?: string }>).data;
}

describe("settings: default map style (dcm-bxp.89)", () => {
  const previous = process.env.GM_EMAILS;
  beforeEach(() => {
    process.env.GM_EMAILS = GM_EMAIL;
  });
  afterEach(() => {
    process.env.GM_EMAILS = previous;
  });
  const backup = (settings: Record<string, unknown>) => JSON.stringify({ daggerheartBackup: 2, kind: "settings", schemaVersion: 1, settings });
  const valid = { tableName: "Crew", gmName: "Ana", accent: "#6fb8a6", expansions: {} };

  it("is Classic by default, saves Sprites alone, and keeps the other settings", async () => {
    const { gm } = await setup();
    expect((await gm.query(api.settings.get, {})).defaultMapStyle).toBe("classic");
    await gm.mutation(api.settings.update, { tableName: "Thursday Crew" });
    await gm.mutation(api.settings.update, { defaultMapStyle: "sprites" });
    expect(await gm.query(api.settings.get, {})).toMatchObject({ tableName: "Thursday Crew", defaultMapStyle: "sprites" });
    // Another field's update leaves it alone.
    await gm.mutation(api.settings.update, { gmName: "Ana" });
    expect((await gm.query(api.settings.get, {})).defaultMapStyle).toBe("sprites");
    await gm.mutation(api.settings.update, { defaultMapStyle: "classic" });
    expect((await gm.query(api.settings.get, {})).defaultMapStyle).toBe("classic");
  });

  it("the backup carries it; an older backup without it restores Classic; reset puts Classic back", async () => {
    const { gm } = await setup();
    await gm.mutation(api.settings.update, { defaultMapStyle: "sprites" });
    const shown = await gm.query(api.settings.get, {});
    expect(JSON.parse(settingsBackupText(shown)).settings.defaultMapStyle).toBe("sprites");
    await gm.mutation(api.settings.restore, { text: backup(valid) });
    expect((await gm.query(api.settings.get, {})).defaultMapStyle).toBe("classic");
    await gm.mutation(api.settings.restore, { text: settingsBackupText(shown) });
    expect(await gm.query(api.settings.get, {})).toEqual(shown);
    await gm.mutation(api.settings.reset, {});
    expect((await gm.query(api.settings.get, {})).defaultMapStyle).toBe("classic");
  });

  it("a backup with Sprites restores it on an account that has no settings yet", async () => {
    const { gm } = await setup();
    await gm.mutation(api.settings.restore, { text: backup({ ...valid, defaultMapStyle: "sprites" }) });
    expect((await gm.query(api.settings.get, {})).defaultMapStyle).toBe("sprites");
  });
});

describe("settings: backup, restore and reset (H17)", () => {
  const previous = process.env.GM_EMAILS;
  beforeEach(() => {
    process.env.GM_EMAILS = `${GM_EMAIL},b@example.com`;
  });
  afterEach(() => {
    process.env.GM_EMAILS = previous;
  });
  const backup = (settings: Record<string, unknown>, envelope: Record<string, unknown> = {}) =>
    JSON.stringify({ daggerheartBackup: 2, kind: "settings", schemaVersion: 1, settings, ...envelope });
  const valid = { tableName: "Thursday Crew", gmName: "Ana", accent: "#6fb8a6", expansions: { hopeAndFear: true } };

  async function twoAccounts() {
    const t = makeTest();
    const aId = await t.run((ctx) => ctx.db.insert("users", { email: GM_EMAIL }));
    const bId = await t.run((ctx) => ctx.db.insert("users", { email: "b@example.com" }));
    return { t, a: t.withIdentity({ subject: `${aId}|session` }), b: t.withIdentity({ subject: `${bId}|session` }) };
  }

  it("round trip: a backup shown on one account restores the same settings on another", async () => {
    const { a, b } = await twoAccounts();
    await a.mutation(api.settings.update, { tableName: "Thursday Crew", gmName: "Ana", accent: "#6fb8a6" });
    await a.mutation(api.settings.update, { expansions: { hopeAndFear: false } });
    const shown = await a.query(api.settings.get, {});

    await b.mutation(api.settings.restore, { text: settingsBackupText(shown) });
    expect(await b.query(api.settings.get, {})).toEqual(shown);
  });

  it("replaces every setting, including clearing the expansion default", async () => {
    const { gm } = await setup();
    await gm.mutation(api.settings.update, { tableName: "Old", expansions: { hopeAndFear: true } });
    await gm.mutation(api.settings.restore, { text: backup({ ...valid, expansions: {} }) });
    expect(await gm.query(api.settings.get, {})).toEqual({ ...valid, expansions: {}, defaultMapStyle: "classic" });
  });

  it.each([
    ["not JSON", "{ nope"],
    ["the board's browser backup (format 1)", JSON.stringify({ daggerheartBackup: 1, at: "2026-10-21", data: {} })],
    ["a foreign kind", backup(valid, { kind: "campaign" })],
    ["an unknown schemaVersion", backup(valid, { schemaVersion: 2 })],
    ["no schemaVersion", JSON.stringify({ daggerheartBackup: 2, kind: "settings", settings: valid })],
    ["an unknown top-level field", backup(valid, { extra: true })],
    ["an unknown settings field", backup({ ...valid, theme: "dark" })],
    ["an unknown expansion", backup({ ...valid, expansions: { hopeAndFear: true, other: true } })],
    ["an unknown map style", backup({ ...valid, defaultMapStyle: "pixel" })],
    ["an accent outside the palette", backup({ ...valid, accent: "#000000" })],
    ["a name over the limit", backup({ ...valid, tableName: "x".repeat(81) })],
    ["a missing field", backup({ tableName: "T", gmName: "G", expansions: {} })],
    ["an oversized paste", " ".repeat(5000)],
  ])("refuses %s with INVALID and changes nothing", async (_label, text) => {
    const { gm } = await setup();
    await gm.mutation(api.settings.update, { tableName: "Kept" });
    const before = await gm.query(api.settings.get, {});
    expect((await rejection(gm.mutation(api.settings.restore, { text }))).code).toBe("INVALID");
    expect(await gm.query(api.settings.get, {})).toEqual(before);
  });

  it("reset puts the defaults back and leaves campaigns and other accounts alone", async () => {
    const { a, b } = await twoAccounts();
    const defaults = await a.query(api.settings.get, {});
    await a.mutation(api.settings.restore, { text: backup(valid) });
    await b.mutation(api.settings.restore, { text: backup(valid) });
    const { campaignId } = await a.mutation(api.campaigns.create, {
      frameId: "witherwild",
      name: "Stays",
      idempotencyKey: "stays",
    });

    await a.mutation(api.settings.reset, {});
    expect(await a.query(api.settings.get, {})).toEqual(defaults);
    expect(await b.query(api.settings.get, {})).toEqual({ ...valid, defaultMapStyle: "classic" });
    expect(await a.query(api.campaigns.get, { campaignId })).not.toBeNull();
    // Resetting with nothing saved is a no-op, not an error.
    await expect(a.mutation(api.settings.reset, {})).resolves.toBeNull();
  });

  it("signed out: restore and reset are UNAUTHENTICATED", async () => {
    const t = makeTest();
    expect((await rejection(t.mutation(api.settings.restore, { text: backup(valid) }))).code).toBe("UNAUTHENTICATED");
    expect((await rejection(t.mutation(api.settings.reset, {}))).code).toBe("UNAUTHENTICATED");
  });
});
