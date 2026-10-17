import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import { errorCode, GM_EMAIL, key, OTHER_EMAIL, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

/** Every server die comes up `face`. */
function forceDice(face: number) {
  vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(((array: Uint32Array) => array.fill(face - 1)) as typeof crypto.getRandomValues);
}

async function setup(frameId: "age-of-umbra" | "witherwild" = "age-of-umbra") {
  const t = makeTest();
  const gmId = await t.run((ctx) => ctx.db.insert("users", { email: GM_EMAIL, emailVerificationTime: 1 }));
  const playerId = await t.run((ctx) => ctx.db.insert("users", { email: OTHER_EMAIL, emailVerificationTime: 1 }));
  const gm = t.withIdentity({ subject: `${gmId}|s` });
  const player = t.withIdentity({ subject: `${playerId}|s` });
  const { campaignId } = await gm.mutation(api.campaigns.create, { frameId, name: "Halcyon", idempotencyKey: key() });
  await gm.mutation(api.members.invite, { campaignId, email: OTHER_EMAIL });
  const fear = async () => (await gm.query(api.campaigns.get, { campaignId }))!.fear;
  return { t, gm, player, campaignId, fear };
}

describe("Age of Umbra tracker", () => {
  useAllowlist();
  afterEach(() => vi.restoreAllMocks());

  it("manages pyres and branches; players see them read-only, without the GM log", async () => {
    const { gm, player, campaignId } = await setup();
    const { pyreId } = await gm.mutation(api.trackers.ageOfUmbra.addPyre, { campaignId, settlement: " Brightmoor ", idempotencyKey: key() });
    await gm.mutation(api.trackers.ageOfUmbra.addPyre, { campaignId, settlement: "Ashfall", lit: false, idempotencyKey: key() });
    await gm.mutation(api.trackers.ageOfUmbra.renamePyre, { campaignId, pyreId, settlement: "Brightmoor Keep", idempotencyKey: key() });
    await gm.mutation(api.trackers.ageOfUmbra.adjustBranches, { campaignId, delta: 1, idempotencyKey: key() });
    await gm.mutation(api.trackers.ageOfUmbra.setAtPyre, { campaignId, atPyre: true, idempotencyKey: key() });
    expect(await player.query(api.trackers.ageOfUmbra.get, { campaignId })).toEqual({
      pyres: [
        { id: "p1", settlement: "Brightmoor Keep", lit: true },
        { id: "p2", settlement: "Ashfall", lit: false },
      ],
      blessedBranches: 1,
      atPyre: true,
      gm: null,
    });
    expect((await gm.query(api.trackers.ageOfUmbra.get, { campaignId })).gm).toEqual({ log: [] });
    const error = await player
      .mutation(api.trackers.ageOfUmbra.setLit, { campaignId, pyreId, lit: false, idempotencyKey: key() })
      .catch((e) => e);
    expect(errorCode(error)).toBe("FORBIDDEN");
    await gm.mutation(api.trackers.ageOfUmbra.removePyre, { campaignId, pyreId, idempotencyKey: key() });
    expect((await gm.query(api.trackers.ageOfUmbra.get, { campaignId })).pyres.map((p) => p.id)).toEqual(["p2"]);
  });

  it("a Blessed Branch relights or founds a pyre and reminds about the 3 Hope", async () => {
    const { gm, campaignId } = await setup();
    await gm.mutation(api.trackers.ageOfUmbra.addPyre, { campaignId, settlement: "Ashfall", lit: false, idempotencyKey: key() });
    const noBranch = await gm
      .mutation(api.trackers.ageOfUmbra.igniteBranch, { campaignId, pyreId: "p1", idempotencyKey: key() })
      .catch((e) => e);
    expect(errorCode(noBranch)).toBe("TRACKER_RULE");
    await gm.mutation(api.trackers.ageOfUmbra.adjustBranches, { campaignId, delta: 1, idempotencyKey: key() });
    await gm.mutation(api.trackers.ageOfUmbra.adjustBranches, { campaignId, delta: 1, idempotencyKey: key() });
    const relit = await gm.mutation(api.trackers.ageOfUmbra.igniteBranch, { campaignId, pyreId: "p1", idempotencyKey: key() });
    expect(relit.reminder).toMatch(/3 Hope/);
    const founded = await gm.mutation(api.trackers.ageOfUmbra.igniteBranch, { campaignId, settlement: "Lastlight", idempotencyKey: key() });
    expect(founded.pyreId).toBe("p2");
    expect(await gm.query(api.trackers.ageOfUmbra.get, { campaignId })).toMatchObject({
      blessedBranches: 0,
      pyres: [{ lit: true }, { settlement: "Lastlight", lit: true }],
    });
    const both = await gm
      .mutation(api.trackers.ageOfUmbra.igniteBranch, { campaignId, idempotencyKey: key() })
      .catch((e) => e);
    expect(errorCode(both)).toBe("INVALID");
  });

  it("validates settlement names", async () => {
    const { gm, campaignId } = await setup();
    const error = await gm.mutation(api.trackers.ageOfUmbra.addPyre, { campaignId, settlement: "  ", idempotencyKey: key() }).catch((e) => e);
    expect(errorCode(error)).toBe("INVALID");
  });

  it("Lurking Darkness: the server rolls; 3–5 gains 2 Fear", async () => {
    const { gm, campaignId, fear } = await setup();
    const before = await fear();
    forceDice(4);
    const result = await gm.mutation(api.trackers.ageOfUmbra.rollLurkingDarkness, { campaignId, idempotencyKey: key() });
    expect(result).toMatchObject({ gmRoll: 4, watchRoll: null, result: 4, outcome: "fear2", fear: { gained: 2, newValue: before + 2 } });
    expect(await fear()).toBe(before + 2);
    expect((await gm.query(api.trackers.ageOfUmbra.get, { campaignId })).gm?.log).toEqual([
      expect.objectContaining({ gmRoll: 4, result: 4, outcome: "fear2", fearGained: 2 }),
    ]);
  });

  it("Lurking Darkness: Keep Watch replaces a worse GM roll with the highest watcher", async () => {
    const { gm, campaignId, fear } = await setup();
    const before = await fear();
    forceDice(1);
    const result = await gm.mutation(api.trackers.ageOfUmbra.rollLurkingDarkness, {
      campaignId,
      watchers: [3, 12],
      idempotencyKey: key(),
    });
    expect(result).toMatchObject({ gmRoll: 1, watchRoll: 12, result: 12, outcome: "hope", fear: null });
    expect(result.text).toMatch(/Each PC gains a Hope/);
    expect(await fear()).toBe(before);
  });

  it("Lurking Darkness: 6–9 gains a Fear, clamped at 12", async () => {
    const { gm, campaignId, fear } = await setup();
    await gm.mutation(api.fear.set, { campaignId, value: 12, idempotencyKey: key() });
    forceDice(8);
    const result = await gm.mutation(api.trackers.ageOfUmbra.rollLurkingDarkness, { campaignId, idempotencyKey: key() });
    expect(result.fear).toEqual({ gained: 0, lost: 1, newValue: 12 });
    expect(await fear()).toBe(12);
  });

  it("Lurking Darkness: not at a pyre, GM only, valid watchers, idempotent", async () => {
    const { gm, player, campaignId, fear } = await setup();
    const before = await fear();
    const idempotencyKey = key();
    forceDice(5);
    const first = await gm.mutation(api.trackers.ageOfUmbra.rollLurkingDarkness, { campaignId, idempotencyKey });
    forceDice(11);
    expect(await gm.mutation(api.trackers.ageOfUmbra.rollLurkingDarkness, { campaignId, idempotencyKey })).toEqual(first);
    expect(await fear()).toBe(before + 2);

    expect(
      errorCode(await player.mutation(api.trackers.ageOfUmbra.rollLurkingDarkness, { campaignId, idempotencyKey: key() }).catch((e) => e)),
    ).toBe("FORBIDDEN");
    expect(
      errorCode(
        await gm
          .mutation(api.trackers.ageOfUmbra.rollLurkingDarkness, { campaignId, watchers: [13], idempotencyKey: key() })
          .catch((e) => e),
      ),
    ).toBe("INVALID");
    await gm.mutation(api.trackers.ageOfUmbra.setAtPyre, { campaignId, atPyre: true, idempotencyKey: key() });
    expect(
      errorCode(await gm.mutation(api.trackers.ageOfUmbra.rollLurkingDarkness, { campaignId, idempotencyKey: key() }).catch((e) => e)),
    ).toBe("TRACKER_RULE");
  });

  it("is only for Age of Umbra campaigns", async () => {
    const { gm, campaignId } = await setup("witherwild");
    expect(errorCode(await gm.query(api.trackers.ageOfUmbra.get, { campaignId }).catch((e) => e))).toBe("MECHANIC_DISABLED");
    const error = await gm
      .mutation(api.trackers.ageOfUmbra.addPyre, { campaignId, settlement: "x", idempotencyKey: key() })
      .catch((e) => e);
    expect(errorCode(error)).toBe("MECHANIC_DISABLED");
  });

  it("refuses corrupt saved data with TRACKER_CORRUPT", async () => {
    const { t, gm, campaignId } = await setup();
    await t.run((ctx) => ctx.db.insert("frameTrackers", { campaignId, key: "ageOfUmbra", data: { pyres: "none" }, updatedAt: 0 }));
    expect(errorCode(await gm.query(api.trackers.ageOfUmbra.get, { campaignId }).catch((e) => e))).toBe("TRACKER_CORRUPT");
    const error = await gm
      .mutation(api.trackers.ageOfUmbra.adjustBranches, { campaignId, delta: 1, idempotencyKey: key() })
      .catch((e) => e);
    expect(errorCode(error)).toBe("TRACKER_CORRUPT");
  });
});
