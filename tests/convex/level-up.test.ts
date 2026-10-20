import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { logAction } from "../../convex/lib/actionLog";
import { readSheet } from "../../convex/lib/characterSheet";
import { ANCESTRIES, ARMOR, COMMUNITIES, cardsForDomains, getClass, subclassesForClass, WEAPONS } from "../../src/lib/srd/index";
import { errorCode, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

const EMAILS = "gm@example.com,p1@example.com,p2@example.com,out@example.com";

function draft(name: string) {
  const cls = getClass("warrior")!;
  return {
    classId: cls.id,
    subclassId: subclassesForClass("warrior")[0].id,
    ancestry: { kind: "single", id: ANCESTRIES.find((a) => a.source === "core")!.id },
    communityId: COMMUNITIES.find((c) => c.source === "core")!.id,
    traits: { agility: 2, strength: 1, finesse: 1, instinct: 0, presence: 0, knowledge: -1 },
    name,
    pronouns: "",
    description: "",
    primaryWeaponId: WEAPONS.find((w) => w.slot === "primary" && w.tier === 1 && w.source === "core" && w.category === "physical" && !w.classId)!.id,
    armorId: ARMOR.find((a) => a.source === "core" && a.tier === 1)!.id,
    potion: "Minor Health Potion",
    classItem: "",
    background: [],
    experiences: ["Sellsword", "Lockpick"],
    domainCards: cardsForDomains(cls.domains, 1).filter((c) => c.level === 1).slice(0, 2).map((c) => c.id),
    connections: [],
  };
}

/** A level-2 choice: the trait option for Agility and Instinct, one HP slot, a level-2 Blade card. */
const CHOICE = {
  picks: [
    { option: "traits" as const, tier: 2, targets: ["agility", "instinct"] },
    { option: "hp" as const, tier: 2 },
  ],
  experienceName: "Always Land on My Feet",
  cardId: cardsForDomains(["blade"], 2).find((c) => c.level === 2)!.id,
};

async function setup() {
  const t = makeTest();
  const ids = await t.run(async (ctx) => ({
    gm: await ctx.db.insert("users", { email: "gm@example.com" }),
    p1: await ctx.db.insert("users", { email: "p1@example.com" }),
    p2: await ctx.db.insert("users", { email: "p2@example.com" }),
    out: await ctx.db.insert("users", { email: "out@example.com" }),
  }));
  const as = (id: string) => t.withIdentity({ subject: `${id}|s` });
  const [gm, p1, p2, out] = [as(ids.gm), as(ids.p1), as(ids.p2), as(ids.out)];
  const { campaignId } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Party", idempotencyKey: key() });
  const code = await gm.mutation(api.members.rotateJoinCode, { campaignId });
  await p1.mutation(api.members.joinByCode, { code });
  await p2.mutation(api.members.joinByCode, { code });
  const a = (await p1.mutation(api.characters.create, { campaignId, draft: draft("Ash"), idempotencyKey: key() })).characterId;
  const b = (await p2.mutation(api.characters.create, { campaignId, draft: draft("Bryn"), idempotencyKey: key() })).characterId;
  const sheetOf = (id: Id<"characters">) => t.run(async (ctx) => readSheet((await ctx.db.get("characters", id))!.sheet));
  const logOf = (id: Id<"characters">) =>
    t.run((ctx) =>
      ctx.db
        .query("actionLog")
        .withIndex("by_character_at", (q) => q.eq("characterId", id))
        .collect(),
    );
  return { t, gm, p1, p2, out, campaignId, a, b, ids, sheetOf, logOf };
}

async function failure(run: Promise<unknown>): Promise<unknown> {
  try {
    await run;
  } catch (e) {
    return errorCode(e);
  }
  throw new Error("expected the call to fail");
}

describe("levelUp", () => {
  useAllowlist(EMAILS);

  it("refuses the owner without the flag (LEVEL_UP_RULE) but not the GM", async () => {
    const { gm, p1, a, sheetOf } = await setup();
    expect(await failure(p1.mutation(api.levelUp.apply, { characterId: a, choice: CHOICE, idempotencyKey: key() }))).toBe("LEVEL_UP_RULE");
    expect(await gm.mutation(api.levelUp.apply, { characterId: a, choice: CHOICE, idempotencyKey: key() })).toEqual({ level: 2 });
    expect((await sheetOf(a)).level).toBe(2);
  });

  it("party level-up flags active characters; the owner levels up and the flag clears", async () => {
    const { t, gm, p1, campaignId, a, b, sheetOf, logOf } = await setup();
    await t.run((ctx) => ctx.db.patch("characters", b, { status: "away", away: { reason: "infirmary" } }));
    expect(await gm.mutation(api.levelUp.partyLevelUp, { campaignId, idempotencyKey: key() })).toEqual({ flagged: 1 });
    expect((await sheetOf(a)).levelUpPending).toBe(true);
    expect((await sheetOf(b)).levelUpPending).toBe(false);

    await p1.mutation(api.levelUp.apply, { characterId: a, choice: CHOICE, idempotencyKey: key() });
    const after = await sheetOf(a);
    expect(after).toMatchObject({ level: 2, proficiency: 2, levelUpPending: false, traitMarks: { agility: 1, instinct: 1 } });
    expect(after.traits.agility).toBe(3);
    expect(after.advancements).toHaveLength(1);
    const rows = await logOf(a);
    expect(rows.map((r) => [r.kind, r.visibility, r.undoable])).toEqual([
      ["levelUp", "public", false],
      ["levelUp", "public", false],
    ]);
  });

  it("polish 27: a Brawler raises the Combo Die (HF 10); undo lowers it; a Warrior is refused", async () => {
    const { t, gm, a, b, sheetOf } = await setup();
    await t.run(async (ctx) => {
      const c = (await ctx.db.get("characters", a))!;
      await ctx.db.patch("characters", a, { sheet: { ...c.sheet, classId: "brawler", subclassId: "juggernaut" } });
    });
    const choice = {
      picks: [{ option: "comboDie" as const, tier: 2 }, { option: "hp" as const, tier: 2 }],
      experienceName: "Bare Knuckles",
      cardId: cardsForDomains(["valor"], 2).find((c) => c.level === 2)!.id,
    };
    expect(await gm.mutation(api.levelUp.apply, { characterId: a, choice, idempotencyKey: key() })).toEqual({ level: 2 });
    expect((await sheetOf(a)).classState.comboDie).toBe(6);
    await gm.mutation(api.levelUp.undoLast, { characterId: a, idempotencyKey: key() });
    expect((await sheetOf(a)).classState.comboDie).toBeUndefined();
    const warrior = { ...choice, cardId: CHOICE.cardId };
    expect(await failure(gm.mutation(api.levelUp.apply, { characterId: b, choice: warrior, idempotencyKey: key() }))).toBe("LEVEL_UP_RULE");
  });

  it("SS2: multiclass Spellcast trait (CB 111): chosen, stored, shown, undone; forced without one; magic weapons follow", async () => {
    const { t, gm, a, b, sheetOf } = await setup();
    const atLevel4 = (id: Id<"characters">, patch: Record<string, unknown>) =>
      t.run(async (ctx) => {
        const c = (await ctx.db.get("characters", id))!;
        await ctx.db.patch("characters", id, { sheet: { ...c.sheet, level: 4, ...patch } });
      });
    const wizard = { classId: "wizard", domainId: "codex", subclassId: "school-of-knowledge" };
    const pick = [{ option: "multiclass" as const, tier: 3 }];
    // Ash: a Rogue (Nightwalker, Finesse) multiclassing into the Wizard's School of Knowledge (Knowledge).
    await atLevel4(a, { classId: "rogue", subclassId: "nightwalker" });
    const rogueChoice = { picks: pick, experienceName: "Bookish", cardId: cardsForDomains(["midnight"], 5).find((c) => c.level === 5)!.id, multiclass: wizard };
    expect(await failure(gm.mutation(api.levelUp.apply, { characterId: a, choice: rogueChoice, idempotencyKey: key() }))).toBe("LEVEL_UP_RULE");
    const strength = { ...rogueChoice, multiclass: { ...wizard, spellcastTrait: "strength" as const } };
    expect(await failure(gm.mutation(api.levelUp.apply, { characterId: a, choice: strength, idempotencyKey: key() }))).toBe("LEVEL_UP_RULE");
    const knowledge = { ...rogueChoice, multiclass: { ...wizard, spellcastTrait: "knowledge" as const } };
    expect(await gm.mutation(api.levelUp.apply, { characterId: a, choice: knowledge, idempotencyKey: key() })).toEqual({ level: 5 });
    expect((await sheetOf(a)).multiclass).toEqual({ ...wizard, spellcastTrait: "knowledge" });
    expect((await gm.query(api.characters.get, { characterId: a }))?.sheet.multiclass?.spellcastTrait).toBe("knowledge");
    await gm.mutation(api.levelUp.undoLast, { characterId: a, idempotencyKey: key() });
    expect((await sheetOf(a)).multiclass).toBeUndefined();

    // Bryn: a Warrior (no Spellcast trait) gets the new one forced, and may then wield magic weapons.
    await atLevel4(b, {});
    const magic = WEAPONS.find((w) => w.slot === "primary" && w.tier === 1 && w.source === "core" && w.category === "magic" && !w.classId)!.id;
    expect(await failure(gm.mutation(api.characters.updateSheet, { characterId: b, patch: { primaryWeaponId: magic } }))).toBe("INVALID");
    const warriorChoice = { picks: pick, experienceName: "Bookish", cardId: cardsForDomains(["blade"], 5).find((c) => c.level === 5)!.id, multiclass: wizard };
    expect(await gm.mutation(api.levelUp.apply, { characterId: b, choice: warriorChoice, idempotencyKey: key() })).toEqual({ level: 5 });
    expect((await sheetOf(b)).multiclass?.spellcastTrait).toBe("knowledge");
    await gm.mutation(api.characters.updateSheet, { characterId: b, patch: { primaryWeaponId: magic } });
    expect((await sheetOf(b)).primaryWeaponId).toBe(magic);
  });

  it("an invalid choice is LEVEL_UP_RULE", async () => {
    const { gm, a } = await setup();
    const bad = { ...CHOICE, picks: [{ option: "traits" as const, tier: 2, targets: ["agility", "agility"] }, { option: "hp" as const, tier: 2 }] };
    expect(await failure(gm.mutation(api.levelUp.apply, { characterId: a, choice: bad, idempotencyKey: key() }))).toBe("LEVEL_UP_RULE");
  });

  it("undo restores the previous sheet fields and can repeat", async () => {
    const { gm, p1, campaignId, a, sheetOf } = await setup();
    await gm.mutation(api.levelUp.partyLevelUp, { campaignId, idempotencyKey: key() });
    const before = await sheetOf(a);
    await p1.mutation(api.levelUp.apply, { characterId: a, choice: CHOICE, idempotencyKey: key() });
    expect(await p1.mutation(api.levelUp.undoLast, { characterId: a, idempotencyKey: key() })).toEqual({ level: 1 });
    expect(await sheetOf(a)).toEqual(before);
    expect(await failure(p1.mutation(api.levelUp.undoLast, { characterId: a, idempotencyKey: key() }))).toBe("LEVEL_UP_RULE");
  });

  it("only the owner or the GM may level up or undo; only the GM corrects or flags", async () => {
    const { gm, p2, out, campaignId, a, sheetOf } = await setup();
    await gm.mutation(api.levelUp.partyLevelUp, { campaignId, idempotencyKey: key() });
    expect(await failure(p2.mutation(api.levelUp.apply, { characterId: a, choice: CHOICE, idempotencyKey: key() }))).toBe("FORBIDDEN");
    expect(await failure(out.mutation(api.levelUp.apply, { characterId: a, choice: CHOICE, idempotencyKey: key() }))).toBe("NOT_FOUND");
    expect(await failure(p2.mutation(api.levelUp.undoLast, { characterId: a, idempotencyKey: key() }))).toBe("FORBIDDEN");
    expect(await failure(p2.mutation(api.levelUp.correctLevel, { characterId: a, level: 4, idempotencyKey: key() }))).toBe("FORBIDDEN");
    expect(await failure(p2.mutation(api.levelUp.partyLevelUp, { campaignId, idempotencyKey: key() }))).toBe("FORBIDDEN");
    expect(await failure(out.mutation(api.levelUp.partyLevelUp, { campaignId, idempotencyKey: key() }))).toBe("NOT_FOUND");

    expect(await gm.mutation(api.levelUp.correctLevel, { characterId: a, level: 4, idempotencyKey: key() })).toEqual({ level: 4 });
    expect((await sheetOf(a)).level).toBe(4);
    expect(await failure(gm.mutation(api.levelUp.correctLevel, { characterId: a, level: 11, idempotencyKey: key() }))).toBe("LEVEL_UP_RULE");
  });

  describe("SS3: a player undoes a level-up only within its session (decision 33)", () => {
    /** Flags the party and levels Ash up as p1; `backdate` moves the entry's `at` that many ms earlier (Date.now() can repeat within a test). */
    async function leveled(backdate = 0) {
      const env = await setup();
      const { t, gm, p1, campaignId, a } = env;
      await gm.mutation(api.levelUp.partyLevelUp, { campaignId, idempotencyKey: key() });
      await p1.mutation(api.levelUp.apply, { characterId: a, choice: CHOICE, idempotencyKey: key() });
      if (backdate > 0) await patchLatest(t, a, (at) => ({ at: at! - backdate }));
      return env;
    }
    async function patchLatest(t: Awaited<ReturnType<typeof setup>>["t"], id: Id<"characters">, change: (at: number | undefined) => Record<string, unknown>) {
      await t.run(async (ctx) => {
        const c = (await ctx.db.get("characters", id))!;
        const sheet = c.sheet as { advancements: { at?: number }[] };
        const last = sheet.advancements.at(-1)!;
        const { at, ...rest } = last;
        const next = { ...rest, ...change(at) };
        await ctx.db.patch("characters", id, { sheet: { ...c.sheet, advancements: [...sheet.advancements.slice(0, -1), next] } });
      });
    }

    it("stamps the entry with when it was taken", async () => {
      const before = Date.now();
      const { a, sheetOf } = await leveled();
      expect((await sheetOf(a)).advancements[0].at).toBeGreaterThanOrEqual(before);
    });

    it("same session: the player may undo (session running since before the level-up)", async () => {
      const env = await setup();
      const { gm, p1, campaignId, a } = env;
      await gm.mutation(api.sessions.start, { campaignId, idempotencyKey: key() });
      await gm.mutation(api.levelUp.partyLevelUp, { campaignId, idempotencyKey: key() });
      await p1.mutation(api.levelUp.apply, { characterId: a, choice: CHOICE, idempotencyKey: key() });
      expect(await p1.query(api.levelUp.canUndo, { characterId: a })).toBe(true);
      expect(await p1.mutation(api.levelUp.undoLast, { characterId: a, idempotencyKey: key() })).toEqual({ level: 1 });
    });

    it("between sessions with no session since: the player may undo; an End scene is no boundary", async () => {
      const { t, gm, p1, campaignId, a } = await leveled(1000);
      await t.run(async (ctx) => {
        const c = (await ctx.db.get("characters", a))!;
        await ctx.db.patch("characters", a, { sheet: { ...c.sheet, effects: [{ id: "e1", source: "Test", text: "Until the scene ends", until: "scene" }] } });
      });
      const ended = await gm.mutation(api.scenes.end, { campaignId, idempotencyKey: key() });
      expect(ended.entryId).not.toBeNull();
      expect(await p1.query(api.levelUp.canUndo, { characterId: a })).toBe(true);
      expect(await p1.mutation(api.levelUp.undoLast, { characterId: a, idempotencyKey: key() })).toEqual({ level: 1 });
    });

    it("refuses the player after a new session starts; the GM may still undo", async () => {
      const { gm, p1, campaignId, a } = await leveled(1000);
      await gm.mutation(api.sessions.start, { campaignId, idempotencyKey: key() });
      expect(await p1.query(api.levelUp.canUndo, { characterId: a })).toBe(false);
      expect(await failure(p1.mutation(api.levelUp.undoLast, { characterId: a, idempotencyKey: key() }))).toBe("LEVEL_UP_RULE");
      expect(await gm.query(api.levelUp.canUndo, { characterId: a })).toBe(true);
      expect(await gm.mutation(api.levelUp.undoLast, { characterId: a, idempotencyKey: key() })).toEqual({ level: 1 });
    });

    it("refuses the player after the session ends", async () => {
      const env = await setup();
      const { gm, p1, campaignId, a } = env;
      await gm.mutation(api.sessions.start, { campaignId, idempotencyKey: key() });
      await gm.mutation(api.levelUp.partyLevelUp, { campaignId, idempotencyKey: key() });
      await p1.mutation(api.levelUp.apply, { characterId: a, choice: CHOICE, idempotencyKey: key() });
      await gm.mutation(api.sessions.end, { campaignId, idempotencyKey: key() });
      expect(await p1.query(api.levelUp.canUndo, { characterId: a })).toBe(false);
      expect(await failure(p1.mutation(api.levelUp.undoLast, { characterId: a, idempotencyKey: key() }))).toBe("LEVEL_UP_RULE");
    });

    it("refuses the player after a whole session started and ended since", async () => {
      const { gm, p1, campaignId, a } = await leveled(1000);
      await gm.mutation(api.sessions.start, { campaignId, idempotencyKey: key() });
      await gm.mutation(api.sessions.end, { campaignId, idempotencyKey: key() });
      expect(await failure(p1.mutation(api.levelUp.undoLast, { characterId: a, idempotencyKey: key() }))).toBe("LEVEL_UP_RULE");
      expect(await gm.mutation(api.levelUp.undoLast, { characterId: a, idempotencyKey: key() })).toEqual({ level: 1 });
    });

    it("D10 S3: restarting a played session after the level-up is a boundary; a level-up inside the restarted session may be undone", async () => {
      const { gm, p1, campaignId, a } = await leveled(1000);
      const { sessionId } = await gm.mutation(api.sessionRecords.create, { campaignId, idempotencyKey: key() });
      await gm.mutation(api.sessionRecords.setPlayed, { campaignId, sessionId, played: true });
      // Marked played by hand: no start or end time, so no boundary.
      expect(await p1.query(api.levelUp.canUndo, { characterId: a })).toBe(true);
      await gm.mutation(api.sessions.start, { campaignId, sessionId, idempotencyKey: key() });
      expect(await p1.query(api.levelUp.canUndo, { characterId: a })).toBe(false);
      expect(await failure(p1.mutation(api.levelUp.undoLast, { characterId: a, idempotencyKey: key() }))).toBe("LEVEL_UP_RULE");

      // The GM takes it back (the flag is set again); the player levels up again inside the restarted session.
      expect(await gm.mutation(api.levelUp.undoLast, { characterId: a, idempotencyKey: key() })).toEqual({ level: 1 });
      await p1.mutation(api.levelUp.apply, { characterId: a, choice: CHOICE, idempotencyKey: key() });
      expect(await p1.query(api.levelUp.canUndo, { characterId: a })).toBe(true);
      expect(await p1.mutation(api.levelUp.undoLast, { characterId: a, idempotencyKey: key() })).toEqual({ level: 1 });
    });

    it("dcm-bxp.48: a session row's start or end after the level-up refuses the player without any log row", async () => {
      const { t, gm, p1, campaignId, a } = await leveled(5000);
      const at = (await t.run(async (ctx) => (await ctx.db.get("characters", a))!.sheet as { advancements: { at: number }[] })).advancements[0].at;
      const insert = (fields: { startedAt?: number; endedAt?: number }) =>
        t.run(async (ctx) => {
          const now = Date.now();
          return ctx.db.insert("sessions", { campaignId, n: 9, status: "played", ...fields, createdAt: now, updatedAt: now });
        });
      // A session that ended before the level-up is no boundary.
      await insert({ startedAt: at - 3000, endedAt: at - 1000 });
      expect(await p1.query(api.levelUp.canUndo, { characterId: a })).toBe(true);
      // One that ended in the same millisecond is.
      const id = await insert({ startedAt: at - 500, endedAt: at });
      expect(await p1.query(api.levelUp.canUndo, { characterId: a })).toBe(false);
      await t.run((ctx) => ctx.db.patch("sessions", id, { startedAt: at + 1, endedAt: undefined }));
      expect(await p1.query(api.levelUp.canUndo, { characterId: a })).toBe(false);
      expect(await gm.query(api.levelUp.canUndo, { characterId: a })).toBe(true);
    });

    it("an older entry without `at` is GM only", async () => {
      const { t, gm, p1, p2, a } = await leveled();
      await patchLatest(t, a, () => ({}));
      expect(await p1.query(api.levelUp.canUndo, { characterId: a })).toBe(false);
      expect(await p2.query(api.levelUp.canUndo, { characterId: a })).toBe(false);
      expect(await failure(p1.mutation(api.levelUp.undoLast, { characterId: a, idempotencyKey: key() }))).toBe("LEVEL_UP_RULE");
      expect(await gm.mutation(api.levelUp.undoLast, { characterId: a, idempotencyKey: key() })).toEqual({ level: 1 });
    });
  });

  it("a level-up row blocks undoing an older roll row", async () => {
    const { t, gm, p1, campaignId, a, ids, sheetOf } = await setup();
    const before = await sheetOf(a);
    const rollId = await t.run((ctx) =>
      logAction(ctx, { campaignId, characterId: a, actorId: ids.p1, kind: "roll", visibility: "public", summary: "rolled", before, undoable: true }),
    );
    await gm.mutation(api.levelUp.partyLevelUp, { campaignId, idempotencyKey: key() });
    await p1.mutation(api.levelUp.apply, { characterId: a, choice: CHOICE, idempotencyKey: key() });
    expect(await failure(p1.mutation(api.actionLog.undo, { entryId: rollId, idempotencyKey: key() }))).toBe("UNDO_STALE");
    expect((await sheetOf(a)).level).toBe(2);
  });
});
