/**
 * Features in the adversary hit's reaction window (plan sheet-drawer SD4; docs/tasks/TASK-SD-SD4.md): feature answers
 * through `adversaryActions.respond` (Iron Will, Increased Fortitude, Thick Skin after the Armor Slot, Revenge on the
 * attacker), the after-hit offer (Not Done Yet), the before-roll prompt (Q2: Harrowing Invocation turns a hit into a
 * miss and the Bear marks a Stress), what players see (Q14: no roll, their own damage), and the GM's undo (U4). Role
 * checks: tests/convex/authz/adversary-actions.entries.ts.
 *
 * Ash (the world's characterA) and Bryn (characterB) wear Chainmail: thresholds 8 / 16 at level 1 (CB p.91: Minor 1 HP,
 * Major 2 HP, Severe 3 HP; CB p.114: one Armor Slot steps it down once). Hits are opened directly with
 * `openIncomingHit` at a fixed amount; the before-roll test runs the Bear's real attack with the server's d20s set.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { attackRollOf, resolveRerolls } from "../../convex/lib/adversaryHits";
import { bandsOnMap, openIncomingHit, partyMembers, seededRng } from "../../convex/lib/incomingHits";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { allowWorldEmails, buildWorld, type Client } from "./authz/world";
import { errorCode, key } from "./helpers";

allowWorldEmails();

afterEach(() => {
  vi.restoreAllMocks();
});

const ROLL_KEYS = ["roll", "dice", "total", "modifier", "evasion", "difficulty", "attackTotal", "thresholds", "adversaryBefore"];

function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (value !== null && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => [k, ...keysOf(v)]);
  return [];
}

async function code(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return errorCode(e);
  }
}

/** The server's next d20s (`rollDie` maps a random word w to w % 20 + 1); other dice stay random. */
function serverD20s(...values: number[]) {
  const queue = [...values];
  const real = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
  vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(<T extends ArrayBufferView | null>(buf: T): T => {
    const next = queue.shift();
    if (next === undefined) return real(buf as never) as T;
    (buf as unknown as Uint32Array)[0] = next - 1;
    return buf;
  });
}

async function arena() {
  const w = await buildWorld();
  const { t, campaignId } = w;
  const gm = w.as("gm");
  const player = w.as("player");
  const other = w.as("otherPlayer");
  const now = Date.now();
  await t.run((ctx) => ctx.db.patch("campaigns", campaignId, { options: { hopeAndFear: true } }));
  const edit = (id: Id<"characters">, patch: (s: CharacterSheet) => Partial<CharacterSheet>) =>
    t.run(async (ctx) => {
      const s = readSheet((await ctx.db.get("characters", id))!.sheet);
      await saveSheet(ctx, id, { ...s, ...patch(s) });
    });
  for (const id of [w.characterA, w.characterB]) await edit(id, () => ({ armorId: "chainmail-armor", armorMarked: 0, hp: 0, stress: 0, hope: 3, effects: [], domainCards: { owned: [], loadout: [] } }));
  const encounterId = await t.run((ctx) => ctx.db.insert("encounters", { campaignId, name: "Ambush", status: "running", pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, startedAt: now }));
  const bear = await t.run((ctx) =>
    ctx.db.insert("encounterAdversaries", {
      campaignId,
      encounterId,
      source: { kind: "srd", adversaryId: "bear" },
      label: "Bear",
      order: 0,
      summoned: false,
      stats: { difficulty: 14, major: 9, severe: 17, hpMax: 7, stressMax: 2 },
      hp: 0,
      stress: 0,
      defeated: false,
      conditions: [],
      tags: [],
      spotlights: 0,
      spotlightTurn: 0,
      updatedAt: now,
    }),
  );
  /** A hit of `amount` physical damage on `target` from the Bear, in a fresh action group (as the attack opens it). */
  const hit = (target: Id<"characters">, amount: number, groupId = `g-${key()}`) =>
    t.run(async (ctx) => {
      const party = await partyMembers(ctx, campaignId);
      return openIncomingHit(ctx, {
        campaignId,
        encounterId,
        createdBy: w.users.gm,
        groupId,
        attacker: { instanceId: bear, label: "Bear" },
        targetCharacterId: target,
        hit: { amount, type: "physical", direct: false, forcedArmor: 0, critical: false },
        party,
        bands: await bandsOnMap(ctx, undefined),
      });
    });
  const sheet = (id: Id<"characters">) => t.run(async (ctx) => readSheet((await ctx.db.get("characters", id))!.sheet));
  const bearNow = () => t.run(async (ctx) => (await ctx.db.get("encounterAdversaries", bear))!);
  const request = (id: Id<"combatRequests">) => t.run(async (ctx) => (await ctx.db.get("combatRequests", id))!);
  const respond = (c: Client, requestId: Id<"combatRequests">, characterId: Id<"characters">, choice: Record<string, unknown>) =>
    c.mutation(api.adversaryActions.respond, { campaignId, requestId, characterId, choice: choice as never, idempotencyKey: key() });
  const pending = (c: Client, characterId: Id<"characters">) => c.query(api.adversaryActionsReads.pending, { campaignId, characterId });
  const feature = (featureId: string, choices: { id: string; value: unknown }[] = []) => ({ kind: "feature", featureId, choices });
  const groupRow = (groupId: string) => t.run(async (ctx) => (await ctx.db.query("actionLog").collect()).find((r) => r.groupId === groupId && r.visibility === "public")!);
  const undo = (entryId: Id<"actionLog">) => gm.mutation(api.actionLog.undo, { entryId, idempotencyKey: key() });
  return { w, t, campaignId, gm, player, other, bear, encounterId, edit, hit, sheet, bearNow, request, respond, pending, feature, groupRow, undo };
}

describe("feature answers in the reaction window", () => {
  it("Iron Will (CB p.36): a Stalwart Guardian marks two Armor Slots on a physical Severe hit; Severe → Minor, 1 HP", async () => {
    const a = await arena();
    await a.edit(a.w.characterA, () => ({ classId: "guardian", subclassId: "stalwart", subclassRank: "foundation" }));
    const { requestId } = await a.hit(a.w.characterA, 17);
    const [view] = await a.pending(a.player, a.w.characterA);
    expect(view).toMatchObject({ role: "target", damage: 17, severity: "severe", maxSlots: 1 });
    expect(view!.features?.map((f) => [f.featureId, f.name])).toEqual([["subclass:stalwart:iron-will", "Iron Will"]]);
    expect(await a.respond(a.player, requestId, a.w.characterA, a.feature("subclass:stalwart:iron-will"))).toMatchObject({ status: "open" });
    const [after] = await a.pending(a.player, a.w.characterA);
    expect(after).toMatchObject({ maxSlots: 2 });
    expect(after!.features ?? []).toEqual([]);
    expect(await a.respond(a.player, requestId, a.w.characterA, { kind: "armor", slots: 2 })).toMatchObject({ status: "resolved" });
    expect(await a.sheet(a.w.characterA)).toMatchObject({ hp: 1, armorMarked: 2 });
  });

  it("refuses a feature the character doesn't hold or wasn't offered (NOT_A_RESPONDER)", async () => {
    const a = await arena();
    const { requestId } = await a.hit(a.w.characterA, 10);
    expect(await code(a.respond(a.player, requestId, a.w.characterA, a.feature("subclass:stalwart:iron-will")))).toBe("NOT_A_RESPONDER");
  });

  it("Increased Fortitude (CB p.55): 3 Hope halve 17 incoming physical damage to 9, rounded up (Q6); undo gives it back", async () => {
    const a = await arena();
    await a.edit(a.w.characterB, () => ({ ancestry: { kind: "single", id: "dwarf" } }));
    const groupId = `g-${key()}`;
    const { requestId } = await a.hit(a.w.characterB, 17, groupId);
    expect((await a.pending(a.other, a.w.characterB))[0]!.features?.map((f) => f.featureId)).toEqual(["ancestry:dwarf:increased-fortitude"]);
    await a.respond(a.other, requestId, a.w.characterB, a.feature("ancestry:dwarf:increased-fortitude"));
    expect(await a.sheet(a.w.characterB)).toMatchObject({ hope: 0 });
    expect((await a.pending(a.other, a.w.characterB))[0]).toMatchObject({ damage: 9, severity: "major" });
    await a.respond(a.other, requestId, a.w.characterB, { kind: "noArmor" });
    // 9: Major (2 HP); 17 would have been Severe (3 HP).
    expect(await a.sheet(a.w.characterB)).toMatchObject({ hp: 2, hope: 0 });
    await a.undo((await a.groupRow(groupId))._id);
    expect(await a.sheet(a.w.characterB)).toMatchObject({ hp: 0, hope: 3 });
  });

  it("Thick Skin (CB p.55) after the Armor Slot (CB p.107, any order): Major → Minor → 2 Stress instead of the Hit Point", async () => {
    const a = await arena();
    await a.edit(a.w.characterB, () => ({ ancestry: { kind: "single", id: "dwarf" }, hope: 0 }));
    const { requestId } = await a.hit(a.w.characterB, 10);
    expect((await a.pending(a.other, a.w.characterB))[0]!.features ?? []).toEqual([]);
    expect(await a.respond(a.other, requestId, a.w.characterB, { kind: "armor", slots: 1 })).toMatchObject({ status: "open" });
    const [view] = await a.pending(a.other, a.w.characterB);
    expect(view).toMatchObject({ awaiting: true, armorAnswered: true });
    expect(view!.features?.map((f) => f.featureId)).toEqual(["ancestry:dwarf:thick-skin"]);
    expect(await a.respond(a.other, requestId, a.w.characterB, a.feature("ancestry:dwarf:thick-skin"))).toMatchObject({ status: "resolved" });
    expect(await a.sheet(a.w.characterB)).toMatchObject({ hp: 0, stress: 2, armorMarked: 1 });
  });

  it("Revenge (CB p.36): 2 Stress and the Bear marks a Hit Point, on the GM row with its before-state; undo restores both", async () => {
    const a = await arena();
    await a.edit(a.w.characterA, () => ({ classId: "guardian", subclassId: "vengeance", subclassRank: "foundation" }));
    const groupId = `g-${key()}`;
    const { requestId } = await a.hit(a.w.characterA, 10, groupId);
    await a.respond(a.player, requestId, a.w.characterA, a.feature("subclass:vengeance:revenge"));
    expect(await a.sheet(a.w.characterA)).toMatchObject({ stress: 2 });
    expect((await a.bearNow()).hp).toBe(1);
    await a.respond(a.player, requestId, a.w.characterA, { kind: "noArmor" });
    await a.undo((await a.groupRow(groupId))._id);
    expect((await a.bearNow()).hp).toBe(0);
    expect(await a.sheet(a.w.characterA)).toMatchObject({ stress: 0, hp: 0 });
  });

  it("an ally's Partners-in-Arms (CB p.36) with no live map (Q18: any range): the target's Major becomes Minor", async () => {
    const a = await arena();
    await a.edit(a.w.characterB, () => ({ classId: "guardian", subclassId: "stalwart", subclassRank: "specialization" }));
    const { requestId } = await a.hit(a.w.characterA, 10);
    const [ally] = await a.pending(a.other, a.w.characterB);
    expect(ally).toMatchObject({ role: "ally", targetName: "Ash" });
    expect(keysOf(ally).filter((k) => ROLL_KEYS.includes(k) || k === "damage")).toEqual([]);
    expect(ally!.features?.map((f) => f.featureId)).toContain("subclass:stalwart:partners-in-arms");
    await a.respond(a.other, requestId, a.w.characterB, a.feature("subclass:stalwart:partners-in-arms"));
    expect(await a.sheet(a.w.characterB)).toMatchObject({ armorMarked: 1 });
    await a.respond(a.player, requestId, a.w.characterA, { kind: "noArmor" });
    expect(await a.sheet(a.w.characterA)).toMatchObject({ hp: 1 });
  });
});

describe("after the hit", () => {
  it("Not Done Yet (HF p.10) is offered after Severe damage; its pick gains a Hope", async () => {
    const a = await arena();
    await a.edit(a.w.characterA, () => ({ classId: "brawler", subclassId: "juggernaut", subclassRank: "mastery", hope: 1 }));
    // Severe whatever the Juggernaut's threshold bonuses (Eye for an Eye is offered too: no map, Q18).
    const { requestId } = await a.hit(a.w.characterA, 40);
    await a.respond(a.player, requestId, a.w.characterA, { kind: "noArmor" });
    const [offer] = await a.pending(a.player, a.w.characterA);
    expect(offer).toMatchObject({ afterHit: true });
    expect(offer!.features?.map((f) => [f.featureId, f.options.map((o) => o.id)])).toEqual([
      ["subclass:juggernaut:eye-for-an-eye", []],
      ["subclass:juggernaut:not-done-yet", ["not-done-yet"]],
    ]);
    await a.respond(a.player, requestId, a.w.characterA, a.feature("subclass:juggernaut:not-done-yet", [{ id: "opt:not-done-yet", value: ["hope"] }]));
    expect(await a.sheet(a.w.characterA)).toMatchObject({ hp: 3, hope: 2 });
    expect((await a.request(requestId)).status).toBe("resolved");
  });
});

describe("before the roll (Q2)", () => {
  async function warlockArena() {
    const a = await arena();
    // Ash: a Pact of the Endless Warlock (specialization) with a Favor; no Evasion trick, so the d20 decides.
    await a.edit(a.w.characterA, (s) => ({ classId: "warlock", subclassId: "pact-of-the-endless", subclassRank: "specialization", classState: { ...s.classState, favor: 1 } }));
    return a;
  }

  it("holds the Bear's attack for the warlock; the other player sees nothing; the GM sees the hold", async () => {
    const a = await warlockArena();
    const res = await a.gm.mutation(api.adversaryActions.attack, { campaignId: a.campaignId, instanceId: a.bear, targets: [a.w.characterA], spendFear: 1, idempotencyKey: key() });
    expect(res.status).toBe("resolved");
    const held = res.status === "resolved" ? res.held : undefined;
    expect(held).toBeDefined();
    expect(res.status === "resolved" ? res.roll : "x").toBeNull();
    const [view] = await a.pending(a.player, a.w.characterA);
    expect(view).toMatchObject({ preRoll: true, attackerLabel: "Bear", targetName: "Ash", role: "target" });
    expect(view!.features?.map((f) => f.featureId)).toEqual(["subclass:pact-of-the-endless:harrowing-invocation"]);
    expect(keysOf(view).filter((k) => ROLL_KEYS.includes(k) || k === "damage")).toEqual([]);
    expect(await a.pending(a.other, a.w.characterB)).toEqual([]);
    expect((await a.gm.query(api.adversaryActionsReads.windows, { campaignId: a.campaignId }))[0]).toMatchObject({ preRoll: true, awaiting: [{ characterId: a.w.characterA }] });
  });

  it("Harrowing Invocation (HF p.14): disadvantage turns the 15 into a 2: a miss, and the Bear marks a Stress", async () => {
    const a = await warlockArena();
    const res = await a.gm.mutation(api.adversaryActions.attack, { campaignId: a.campaignId, instanceId: a.bear, targets: [a.w.characterA], spendFear: 1, idempotencyKey: key() });
    const requestId = res.status === "resolved" ? res.held! : (null as never);
    serverD20s(15, 2);
    expect(await a.respond(a.player, requestId, a.w.characterA, a.feature("subclass:pact-of-the-endless:harrowing-invocation"))).toMatchObject({ status: "resolved" });
    vi.restoreAllMocks();
    expect((await a.sheet(a.w.characterA)).classState.favor).toBe(0);
    expect(await a.sheet(a.w.characterA)).toMatchObject({ hp: 0 });
    expect((await a.bearNow()).stress).toBe(1);
    expect(await a.pending(a.player, a.w.characterA)).toEqual([]);
    const gmRow = await a.t.run(async (ctx) => (await ctx.db.query("actionLog").collect()).find((r) => r.visibility === "gm" && r.roll !== undefined)!);
    expect(gmRow.roll!.dice.filter((d) => d.sides === 20).map((d) => [d.value, d.dropped === true])).toEqual([
      [15, true],
      [2, false],
    ]);
    // GM undo of the group: the Favor and the Bear's Stress come back.
    await a.undo(gmRow._id);
    expect((await a.sheet(a.w.characterA)).classState.favor).toBe(1);
    expect((await a.bearNow()).stress).toBe(0);
  });

  it("Pass: the same 15 hits; the Bear marks no Stress", async () => {
    const a = await warlockArena();
    const res = await a.gm.mutation(api.adversaryActions.attack, { campaignId: a.campaignId, instanceId: a.bear, targets: [a.w.characterA], spendFear: 1, idempotencyKey: key() });
    const requestId = res.status === "resolved" ? res.held! : (null as never);
    serverD20s(15);
    expect(await a.respond(a.player, requestId, a.w.characterA, { kind: "pass" })).toMatchObject({ status: "resolved" });
    vi.restoreAllMocks();
    expect((await a.bearNow()).stress).toBe(0);
    expect((await a.pending(a.player, a.w.characterA))[0]).toMatchObject({ role: "target", awaiting: true });
  });

  it("the GM's Resolve now rolls the held attack without the answer", async () => {
    const a = await warlockArena();
    const res = await a.gm.mutation(api.adversaryActions.attack, { campaignId: a.campaignId, instanceId: a.bear, targets: [a.w.characterA], spendFear: 1, idempotencyKey: key() });
    const requestId = res.status === "resolved" ? res.held! : (null as never);
    expect(await a.gm.mutation(api.adversaryActions.resolve, { campaignId: a.campaignId, requestId, idempotencyKey: key() })).toMatchObject({ status: "resolved", preRoll: true });
    expect((await a.request(requestId)).status).toBe("resolved");
    expect((await a.sheet(a.w.characterA)).classState.favor).toBe(1);
  });

  it("roles on a held attack: another player can't answer for Ash or read Ash's prompt (FORBIDDEN); a stranger is refused", async () => {
    const a = await warlockArena();
    const res = await a.gm.mutation(api.adversaryActions.attack, { campaignId: a.campaignId, instanceId: a.bear, targets: [a.w.characterA], spendFear: 1, idempotencyKey: key() });
    const requestId = res.status === "resolved" ? res.held! : (null as never);
    expect(await code(a.respond(a.other, requestId, a.w.characterA, { kind: "pass" }))).toBe("FORBIDDEN");
    expect(await code(a.pending(a.other, a.w.characterA))).toBe("FORBIDDEN");
    expect(await code(a.respond(a.w.as("outsider"), requestId, a.w.characterA, { kind: "pass" }))).not.toBe("ok");
    expect(await code(a.gm.query(api.adversaryActionsReads.windows, { campaignId: a.campaignId }))).toBe("ok");
    expect(await code(a.player.query(api.adversaryActionsReads.windows, { campaignId: a.campaignId }))).not.toBe("ok");
    // The GM may answer for the PC (edit on every character).
    expect(await a.respond(a.gm, requestId, a.w.characterA, { kind: "pass" })).toMatchObject({ status: "resolved" });
  });

  it("DA8: Draining Bane's 'Clear a Stress' is ticked by default (dcm-bxp.99.19.15); unticked it is skipped", async () => {
    for (const [choices, stress] of [
      [[], 0],
      [[{ id: "optional:clear-stress", value: false }], 1],
    ] as const) {
      const a = await arena();
      await a.edit(a.w.characterA, (s) => ({ classId: "warlock", subclassId: "pact-of-the-endless", subclassRank: "mastery", stress: 1, classState: { ...s.classState, favor: 2 } }));
      const res = await a.gm.mutation(api.adversaryActions.attack, { campaignId: a.campaignId, instanceId: a.bear, targets: [a.w.characterA], spendFear: 1, idempotencyKey: key() });
      const requestId = res.status === "resolved" ? res.held! : (null as never);
      const bane = (await a.pending(a.player, a.w.characterA))[0]!.features?.find((f) => f.featureId === "subclass:pact-of-the-endless:draining-bane");
      expect(bane?.optionals).toEqual([{ id: "clear-stress", label: "Clear a Stress", defaultOn: true }]);
      await a.respond(a.player, requestId, a.w.characterA, a.feature("subclass:pact-of-the-endless:draining-bane", [...choices]));
      expect((await a.sheet(a.w.characterA)).stress).toBe(stress);
      expect((await a.bearNow()).stress).toBe(1);
    }
  });

  it("nothing waits for PCs without a before-roll feature (no Favor: no prompt)", async () => {
    const a = await arena();
    await a.edit(a.w.characterA, (s) => ({ classId: "warlock", subclassId: "pact-of-the-endless", subclassRank: "specialization", classState: { ...s.classState, favor: 0 } }));
    const res = await a.gm.mutation(api.adversaryActions.attack, { campaignId: a.campaignId, instanceId: a.bear, targets: [a.w.characterA], spendFear: 1, idempotencyKey: key() });
    expect(res.status === "resolved" ? res.held : "x").toBeUndefined();
    expect(res.status === "resolved" ? res.roll : null).not.toBeNull();
  });
});

// Plan drawer-answers, tracer DA8 (docs/tasks/TASK-DA-DA8.md; user answers 2026-10-29 / 2026-10-30): CB p.107 "the
// player controlling the effects ... can apply the effects in any order"; Stable (HF p.12), Dark Aegis (HF p.14).
describe("DA8: the reaction window's answers", () => {
  it("after an Armor Slot a dwarf still gets Increased Fortitude: 17 → 9 (Major) → the slot: Minor; then Thick Skin fits, or Done: 1 HP", async () => {
    const a = await arena();
    await a.edit(a.w.characterB, () => ({ ancestry: { kind: "single", id: "dwarf" } }));
    const { requestId } = await a.hit(a.w.characterB, 17);
    expect(await a.respond(a.other, requestId, a.w.characterB, { kind: "armor", slots: 1 })).toMatchObject({ status: "open" });
    const [view] = await a.pending(a.other, a.w.characterB);
    expect(view).toMatchObject({ awaiting: true, armorAnswered: true, damage: 17, severity: "major", maxSlots: 0 });
    expect(view!.features?.map((f) => f.featureId)).toEqual(["ancestry:dwarf:increased-fortitude"]);
    expect(await a.respond(a.other, requestId, a.w.characterB, a.feature("ancestry:dwarf:increased-fortitude"))).toMatchObject({ status: "open" });
    // The hit now: 9 → Major → the slot → Minor (1 HP): Thick Skin fits it (CB p.107, any order).
    const [now] = await a.pending(a.other, a.w.characterB);
    expect(now).toMatchObject({ damage: 9, severity: "minor", armorPreview: [{ slots: 0, severity: "minor", hp: 1 }] });
    expect(now!.features?.map((f) => f.featureId)).toEqual(["ancestry:dwarf:thick-skin"]);
    expect(await a.respond(a.other, requestId, a.w.characterB, { kind: "pass" })).toMatchObject({ status: "resolved" });
    expect(await a.sheet(a.w.characterB)).toMatchObject({ hp: 1, hope: 0, armorMarked: 1 });
  });

  it("Stable without armor: the Focus lowers the severity one step, no Armor Slot is marked; the player sees only their own numbers", async () => {
    const a = await arena();
    await a.edit(a.w.characterA, (s) => ({ armorId: undefined, classState: { ...s.classState, martial: { known: ["stable"], active: "stable", focus: 1 } } }));
    const { requestId } = await a.hit(a.w.characterA, 40);
    const [view] = await a.pending(a.player, a.w.characterA);
    expect(view).toMatchObject({ role: "target", severity: "severe", maxSlots: 0 });
    expect(keysOf(view).filter((k) => ROLL_KEYS.includes(k))).toEqual([]);
    expect(view!.features?.map((f) => f.featureId)).toEqual(["stance:martial-artist:stable"]);
    expect(await a.respond(a.player, requestId, a.w.characterA, a.feature("stance:martial-artist:stable"))).toMatchObject({ status: "resolved" });
    // Severe → Major: 2 HP; the Focus is spent, no slot marked.
    const after = await a.sheet(a.w.characterA);
    expect(after).toMatchObject({ hp: 2, armorMarked: 0 });
    expect(after.classState.martial?.focus).toBe(0);
  });

  it("Stable OR the Armor Slot: after the slot Stable is not offered (never more than one step)", async () => {
    const a = await arena();
    await a.edit(a.w.characterA, (s) => ({ classState: { ...s.classState, martial: { known: ["stable"], active: "stable", focus: 1 } } }));
    const { requestId } = await a.hit(a.w.characterA, 40);
    expect((await a.pending(a.player, a.w.characterA))[0]!.features?.map((f) => f.featureId)).toEqual(["stance:martial-artist:stable"]);
    expect(await a.respond(a.player, requestId, a.w.characterA, { kind: "armor", slots: 1 })).toMatchObject({ status: "resolved" });
    expect(await a.sheet(a.w.characterA)).toMatchObject({ hp: 2, armorMarked: 1 });
    expect((await a.sheet(a.w.characterA)).classState.martial?.focus).toBe(1);
  });

  it("A1 (dcm-bxp.99.19.55 (3)): 'Don't mark' keeps the window open with the reactions that still fit, until Done", async () => {
    const a = await arena();
    await a.edit(a.w.characterB, () => ({ ancestry: { kind: "single", id: "dwarf" } }));
    const { requestId } = await a.hit(a.w.characterB, 17);
    expect(await a.respond(a.other, requestId, a.w.characterB, { kind: "noArmor" })).toMatchObject({ status: "open" });
    const [view] = await a.pending(a.other, a.w.characterB);
    expect(view).toMatchObject({ awaiting: true, armorAnswered: true, damage: 17, severity: "severe", maxSlots: 0 });
    expect(view!.features?.map((f) => f.featureId)).toEqual(["ancestry:dwarf:increased-fortitude"]);
    // A second armor answer is refused; Done ends the turn with nothing used: 17 is Severe, 3 HP.
    expect(await code(a.respond(a.other, requestId, a.w.characterB, { kind: "armor", slots: 1 }))).toBe("NOT_A_RESPONDER");
    expect(await a.respond(a.other, requestId, a.w.characterB, { kind: "pass" })).toMatchObject({ status: "resolved" });
    expect(await a.sheet(a.w.characterB)).toMatchObject({ hp: 3, hope: 3, armorMarked: 0 });
  });

  it("A1: 'Don't mark', then a reaction that fits: Increased Fortitude halves 17 to 9 (Major, 2 HP) and nothing else fits", async () => {
    const a = await arena();
    await a.edit(a.w.characterB, () => ({ ancestry: { kind: "single", id: "dwarf" } }));
    const { requestId } = await a.hit(a.w.characterB, 17);
    await a.respond(a.other, requestId, a.w.characterB, { kind: "noArmor" });
    expect(await a.respond(a.other, requestId, a.w.characterB, a.feature("ancestry:dwarf:increased-fortitude"))).toMatchObject({ status: "resolved" });
    expect(await a.sheet(a.w.characterB)).toMatchObject({ hp: 2, hope: 0, armorMarked: 0 });
  });

  it("A1 (dcm-bxp.99.19.55 (6)): with Iron Will's second slot, Stable replaces ONE slot and the other is still marked: Severe → Minor", async () => {
    for (const order of ["stable-first", "slot-first"] as const) {
      const a = await arena();
      await a.edit(a.w.characterA, (s) => ({ classId: "guardian", subclassId: "stalwart", subclassRank: "foundation", classState: { ...s.classState, martial: { known: ["stable"], active: "stable", focus: 1 } } }));
      const { requestId } = await a.hit(a.w.characterA, 40);
      await a.respond(a.player, requestId, a.w.characterA, a.feature("subclass:stalwart:iron-will"));
      const [two] = await a.pending(a.player, a.w.characterA);
      expect(two).toMatchObject({ maxSlots: 2 });
      expect(two!.features?.map((f) => f.featureId)).toEqual(["stance:martial-artist:stable"]);
      if (order === "stable-first") {
        expect(await a.respond(a.player, requestId, a.w.characterA, a.feature("stance:martial-artist:stable"))).toMatchObject({ status: "open" });
        // One slot left to mark; the preview counts Stable's step: Severe → (Stable) Major → (a slot) Minor.
        const [left] = await a.pending(a.player, a.w.characterA);
        expect(left).toMatchObject({ awaiting: true, maxSlots: 1, armorPreview: [{ slots: 0, severity: "major", hp: 2 }, { slots: 1, severity: "minor", hp: 1 }] });
        expect(left!.armorAnswered).toBeUndefined();
        expect(await code(a.respond(a.player, requestId, a.w.characterA, { kind: "armor", slots: 2 }))).toBe("INVALID");
        expect(await a.respond(a.player, requestId, a.w.characterA, { kind: "armor", slots: 1 })).toMatchObject({ status: "resolved" });
      } else {
        expect(await a.respond(a.player, requestId, a.w.characterA, { kind: "armor", slots: 1 })).toMatchObject({ status: "open" });
        const [after] = await a.pending(a.player, a.w.characterA);
        expect(after).toMatchObject({ awaiting: true, armorAnswered: true });
        expect(after!.features?.map((f) => f.featureId)).toEqual(["stance:martial-artist:stable"]);
        expect(await a.respond(a.player, requestId, a.w.characterA, a.feature("stance:martial-artist:stable"))).toMatchObject({ status: "resolved" });
      }
      const s = await a.sheet(a.w.characterA);
      expect(s).toMatchObject({ hp: 1, armorMarked: 1 });
      expect(s.classState.martial?.focus).toBe(0);
    }
  });

  it("A1: with both of Iron Will's slots marked, Stable no longer fits (it replaces a slot, never adds one)", async () => {
    const a = await arena();
    await a.edit(a.w.characterA, (s) => ({ classId: "guardian", subclassId: "stalwart", subclassRank: "foundation", classState: { ...s.classState, martial: { known: ["stable"], active: "stable", focus: 1 } } }));
    const { requestId } = await a.hit(a.w.characterA, 40);
    await a.respond(a.player, requestId, a.w.characterA, a.feature("subclass:stalwart:iron-will"));
    expect(await a.respond(a.player, requestId, a.w.characterA, { kind: "armor", slots: 2 })).toMatchObject({ status: "resolved" });
    const s = await a.sheet(a.w.characterA);
    expect(s).toMatchObject({ hp: 1, armorMarked: 2 });
    expect(s.classState.martial?.focus).toBe(1);
  });

  it("Dark Aegis (HF p.14) after an Armor Slot: zero damage, no slot, no HP; Restrained still lands, the extra HP doesn't; undo restores all", async () => {
    const a = await arena();
    await a.edit(a.w.characterA, (s) => ({ classId: "warlock", subclassId: "pact-of-the-endless", subclassRank: "mastery", classState: { ...s.classState, favor: 1 } }));
    const groupId = `g-${key()}`;
    const { requestId } = await a.t.run(async (ctx) =>
      openIncomingHit(ctx, {
        campaignId: a.campaignId,
        encounterId: a.encounterId,
        createdBy: a.w.users.gm,
        groupId,
        attacker: { instanceId: a.bear, label: "Bear" },
        targetCharacterId: a.w.characterA,
        hit: { amount: 20, type: "physical", direct: false, forcedArmor: 0, critical: false },
        riders: [
          { kind: "condition", condition: "restrained" },
          { kind: "hp", amount: 1 },
        ],
        party: await partyMembers(ctx, a.campaignId),
        bands: await bandsOnMap(ctx, undefined),
      }),
    );
    expect(await a.respond(a.player, requestId, a.w.characterA, { kind: "armor", slots: 1 })).toMatchObject({ status: "open" });
    const [view] = await a.pending(a.player, a.w.characterA);
    expect(view!.features?.map((f) => f.featureId)).toContain("subclass:pact-of-the-endless:dark-aegis");
    expect(await a.respond(a.player, requestId, a.w.characterA, a.feature("subclass:pact-of-the-endless:dark-aegis"))).toMatchObject({ status: "resolved" });
    const after = await a.sheet(a.w.characterA);
    expect(after).toMatchObject({ hp: 0, armorMarked: 0 });
    expect(after.conditions).toContain("restrained");
    expect(after.classState.favor).toBe(0);
    const summaries = await a.t.run(async (ctx) => (await ctx.db.query("actionLog").collect()).filter((r) => r.groupId === groupId && r.visibility === "public").map((r) => r.summary));
    expect(summaries).toContain("Ash took no damage from Bear's hit");
    await a.undo((await a.groupRow(groupId))._id);
    const undone = await a.sheet(a.w.characterA);
    expect(undone).toMatchObject({ hp: 0, armorMarked: 0 });
    expect(undone.conditions).not.toContain("restrained");
    expect(undone.classState.favor).toBe(1);
  });

  it("DA1 follow-ups: a Drained attack's roll is found by its kind (d12s), the hit stores its own total, a forced reroll keeps the d12", async () => {
    const a = await arena();
    await a.t.run((ctx) => ctx.db.patch("encounterAdversaries", a.bear, { tags: ["Drained"] }));
    serverD20s(12);
    const res = await a.gm.mutation(api.adversaryActions.attack, { campaignId: a.campaignId, instanceId: a.bear, targets: [a.w.characterA], spendFear: 1, idempotencyKey: key() });
    vi.restoreAllMocks();
    const requestId = res.status === "resolved" ? res.targets[0]?.requestId : undefined;
    expect(requestId).toBeDefined();
    const row = await a.request(requestId!);
    if (row.payload.kind !== "incomingHit") throw new Error("not a hit");
    const groupId = row.payload.groupId;
    const record = await a.t.run((ctx) => attackRollOf(ctx, { campaignId: a.campaignId, payload: { groupId } }));
    expect(record?.dice[0]).toMatchObject({ sides: 12, value: 12 });
    expect(row.payload.kind === "incomingHit" && row.payload.attackTotal).toBe(record!.total);
    const [reroll] = resolveRerolls([{ kind: "rerollAttack" }], "seed", record, null);
    expect(reroll).toMatchObject({ kind: "attackRoll", critical: false });
    expect(reroll!.kind === "attackRoll" && reroll!.total - record!.modifier).toBeLessThanOrEqual(12);
    // A target with its own disadvantage rerolls with two dice and keeps the lower (seeded: the same two dice).
    const rng = seededRng("seed");
    const [x, y] = [rng(12), rng(12)];
    expect(resolveRerolls([{ kind: "rerollAttack" }], "seed", record, null, { disadvantage: 1 })).toEqual([{ kind: "attackRoll", total: Math.min(x, y) + record!.modifier, critical: false }]);
  });
});
