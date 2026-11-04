/**
 * Plan hud-pre-w9, dcm-bxp.99.32.37 (user 2026-11-02): End on a PC's lasting effect, for the GM and for the effect's
 * caster. `classFeatures.endEffect` lets whoever edits the bearer (its player, the GM) and, now, whoever edits the
 * character that cast it (the effect's stored `casterId`, E6.4); `combatHud.sheet` says so per effect (`canEnd`).
 * Access per role is in the authz matrix (tests/convex/authz/play.entries.ts, the caster row).
 */
import { describe, expect, it } from "vitest";

import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import type { Effect } from "../../src/lib/validation/characters";
import { allowWorldEmails, buildWorld, type World } from "./authz/world";
import { errorCode, key } from "./helpers";

allowWorldEmails();

/** Puts these lasting effects on a character's sheet. */
function withEffects(w: World, characterId: Id<"characters">, effects: Effect[]) {
  return w.t.run(async (ctx) => {
    const s = readSheet((await ctx.db.get("characters", characterId))!.sheet);
    await saveSheet(ctx, characterId, { ...s, effects });
  });
}

const effectIds = (w: World, characterId: Id<"characters">) => w.t.run(async (ctx) => readSheet((await ctx.db.get("characters", characterId))!.sheet).effects.map((e) => e.id));

/** On Ash (player's): one cast by Bryn (otherPlayer's), one cast by Ash, one without a caster (stored before E6.4). */
async function seeded() {
  const w = await buildWorld();
  await withEffects(w, w.characterA, [
    { id: "ward", source: "Rune Ward", text: "Reduce damage", until: "rest", casterId: w.characterB },
    { id: "dodge", source: "Rogue's Dodge", text: "+2 Evasion", until: "hit", casterId: w.characterA },
    { id: "old", source: "No Mercy", text: "+1 to attack rolls", until: "rest" },
  ]);
  return w;
}

const end = (w: World, role: "player" | "otherPlayer" | "gm" | "outsider", effectId: string) =>
  w
    .as(role)
    .mutation(api.classFeatures.endEffect, { characterId: w.characterA, effectId, idempotencyKey: key() })
    .then(() => "ok")
    .catch((e: unknown) => errorCode(e));

describe("End on a lasting effect (hud-pre-w9)", () => {
  it("the sheet says who may End each effect: GM and bearer all, the caster's player only theirs", async () => {
    const w = await seeded();
    const canEnd = async (role: "player" | "otherPlayer" | "gm" | "grantee") =>
      Object.fromEntries((await w.as(role).query(api.combatHud.sheet, { characterId: w.characterA })).effects.map((e) => [e.id, e.canEnd]));
    expect(await canEnd("gm")).toEqual({ ward: true, dodge: true, old: true });
    expect(await canEnd("player")).toEqual({ ward: true, dodge: true, old: true });
    expect(await canEnd("grantee")).toEqual({ ward: true, dodge: true, old: true });
    expect(await canEnd("otherPlayer")).toEqual({ ward: true, dodge: false, old: false });
  });

  it("the caster's player ends the effect they cast on an ally; nothing else of the ally's", async () => {
    const w = await seeded();
    expect(await end(w, "otherPlayer", "dodge")).toBe("FORBIDDEN");
    expect(await end(w, "otherPlayer", "old")).toBe("FORBIDDEN");
    // An effect that is gone tells a non-editor nothing either.
    expect(await end(w, "otherPlayer", "nothing")).toBe("FORBIDDEN");
    expect(await end(w, "outsider", "ward")).toBe("NOT_FOUND");
    expect(await end(w, "otherPlayer", "ward")).toBe("ok");
    expect(await effectIds(w, w.characterA)).toEqual(["dodge", "old"]);
    // Ended already: the caster's player is a non-editor of Ash again.
    expect(await end(w, "otherPlayer", "ward")).toBe("FORBIDDEN");
  });

  it("the GM and the bearer's player end any effect, as before", async () => {
    const w = await seeded();
    expect(await end(w, "gm", "ward")).toBe("ok");
    expect(await end(w, "player", "old")).toBe("ok");
    expect(await effectIds(w, w.characterA)).toEqual(["dodge"]);
    expect(await end(w, "player", "ward")).toBe("CLASS_FEATURE_RULE");
  });

  it("seedEffectForE2e (the browser spec's internal seeding) is refused outside the local e2e backend", async () => {
    const w = await buildWorld();
    await expect(w.t.mutation(internal.classFeatures.seedEffectForE2e, { characterId: w.characterA, effectId: "x", source: "X", text: "x" })).rejects.toThrow(/local e2e backend/);
    expect(await effectIds(w, w.characterA)).toEqual([]);
  });

  it("a caster id that is not a character of the campaign gives nobody else the End", async () => {
    const w = await buildWorld();
    await withEffects(w, w.characterA, [{ id: "odd", source: "Odd", text: "?", until: "rest", casterId: "not-an-id" }]);
    expect((await w.as("otherPlayer").query(api.combatHud.sheet, { characterId: w.characterA })).effects[0]?.canEnd).toBe(false);
    expect(await end(w, "otherPlayer", "odd")).toBe("FORBIDDEN");
  });
});
