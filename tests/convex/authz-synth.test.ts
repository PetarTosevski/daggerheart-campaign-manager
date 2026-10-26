/**
 * The authz matrix's argument synthesizer (analysis 2.4): arguments built from a function's own validator pass that
 * validator and reach the handler, for a gm, a view, an own and a scoped function; and an area extends the world and
 * NAME_HINTS through its own `setup` and `nameHints`, with no change to harness.ts.
 */
import { v, type PropertyValidators } from "convex/values";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import { readSheet } from "../../convex/lib/characterSheet";
import { runMatrix, type Area } from "./authz/harness";
import { publicFunction, publicFunctions } from "./authz/inventory";
import { freshKey, NAME_HINTS, synthArgs } from "./authz/synth";
import { buildWorld, type World } from "./authz/world";

const argsOf = async (name: string) => (await publicFunction(name)).fn.exportArgs();
/** The exportArgs JSON of an args object, as Convex serializes it for a registered function. */
const objectArgs = (fields: PropertyValidators) => (v.object(fields) as unknown as { json: object }).json;

describe("synthArgs", () => {
  // One world for these checks, built lazily in the first test.
  let w: World;
  let built: Promise<World> | null = null;
  beforeAll(() => publicFunctions(), 120_000);
  beforeEach(async () => {
    w = await (built ??= buildWorld());
  }, 60_000);

  it("gm: fear:set gets the campaign, a number and a fresh key, and the GM's call goes through", async () => {
    const args = await synthArgs(await argsOf("fear:set"), w);
    expect(args).toEqual({ campaignId: w.campaignId, value: 0, idempotencyKey: expect.stringMatching(/^authz-/) });
    await expect(w.as("gm").mutation(api.fear.set, args as never)).resolves.toMatchObject({ newValue: 0 });
  });

  it("view: campaignTime:get gets the campaign, and a player reads it", async () => {
    const args = await synthArgs(await argsOf("campaignTime:get"), w);
    expect(args).toEqual({ campaignId: w.campaignId });
    await expect(w.as("player").query(api.campaignTime.get, args as never)).resolves.not.toBeNull();
  });

  it("own: characters:toggleCondition gets characterA and the first condition, and its owner toggles it", async () => {
    const args = await synthArgs(await argsOf("characters:toggleCondition"), w);
    expect(args.characterId).toBe(w.characterA);
    const result = await w.as("player").mutation(api.characters.toggleCondition, args as never);
    const sheet = await w.t.run(async (ctx) => readSheet((await ctx.db.get("characters", w.characterA))!.sheet));
    expect(result.conditions).toEqual([args.condition]);
    expect(sheet.conditions).toEqual([args.condition]);
  });

  it("scoped: codex:entryText resolves an entry from the table, or the one a setup picked with w.use", async () => {
    const { entryId } = await w.as("gm").mutation(api.codex.create, { campaignId: w.campaignId, kind: "character", idempotencyKey: freshKey() });
    // Without a choice, the table's first document (the frame may have seeded entries before this one).
    const first = await w.t.run(async (ctx) => (await ctx.db.query("codexEntries").first())!._id);
    expect(await synthArgs(await argsOf("codex:entryText"), w)).toEqual({ entryId: first });
    w.use("codexEntries", entryId);
    const args = await synthArgs(await argsOf("codex:entryText"), w);
    expect(args).toEqual({ entryId });
    await expect(w.as("gm").query(api.codex.entryText, args as never)).resolves.not.toBeNull();
  });

  it("v.string ids follow NAME_HINTS; w.use picks the row; a missing table names itself", async () => {
    expect(await synthArgs(objectArgs({ characterId: v.string(), other: v.string() }), w)).toEqual({ characterId: w.characterA, other: "x" });
    w.use("characters", w.characterB);
    expect(await synthArgs(objectArgs({ characterId: v.id("characters") }), w)).toEqual({ characterId: w.characterB });
    w.use("characters", w.characterA);
    await expect(synthArgs(objectArgs({ mapId: v.string() }), w)).rejects.toThrow('The world has no "combatMaps" document');
  });

  it("literals, first union member, optional omitted, nested objects, arrays, records, distinct keys", async () => {
    const json = objectArgs({
      kind: v.literal("npc"),
      choice: v.union(v.literal("a"), v.literal("b")),
      maybe: v.optional(v.string()),
      nested: v.object({ n: v.number(), flag: v.boolean(), userId: v.string() }),
      list: v.array(v.string()),
      map: v.record(v.string(), v.number()),
      idempotencyKey: v.string(),
    });
    const a = await synthArgs(json, w);
    const b = await synthArgs(json, w);
    expect(a).toEqual({
      kind: "npc",
      choice: "a",
      nested: { n: 0, flag: false, userId: w.users.player },
      list: [],
      map: {},
      idempotencyKey: expect.any(String),
    });
    expect(a.idempotencyKey).not.toBe(b.idempotencyKey);
  });

  it("hints passed in replace the defaults (extend with a spread)", async () => {
    const hints = { ...NAME_HINTS, characterId: () => "custom" };
    expect(await synthArgs(objectArgs({ characterId: v.string() }), w, hints)).toEqual({ characterId: "custom" });
  });
});

/**
 * An area that needs a frame, state of its own and an id that lives inside a blob: the world option picks the frame,
 * `setup` adds a pyre and registers its id, and `nameHints` tells the synthesizer where `pyreId` comes from. The edit
 * entry exercises the grantee row, and the knownBug entry the it.fails path. Not an `*.entries.ts` file, so the guard does not count these entries.
 */
const extended: Area = {
  area: "synth extension",
  world: { frameId: "age-of-umbra" },
  setup: async (w) => {
    const { pyreId } = await w.as("gm").mutation(api.trackers.ageOfUmbra.addPyre, {
      campaignId: w.campaignId,
      settlement: "Emberfall",
      idempotencyKey: freshKey(),
    });
    w.set("pyreId", pyreId);
  },
  nameHints: { pyreId: (w) => w.ids.pyreId },
  entries: [
    { fn: api.trackers.ageOfUmbra.renamePyre, access: "gm" },
    { fn: api.codex.create, access: "edit" },
    // A row whose expectation the code does not meet fails its entry; knownBug turns the entry into one it.fails.
    { fn: api.trackers.ageOfUmbra.get, access: "view", expect: { player: "FORBIDDEN" }, knownBug: "demo (players may read the tracker)" },
  ],
};

runMatrix(extended);
