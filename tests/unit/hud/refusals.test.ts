/**
 * The refusal table and the shortfall helper (plan combat-hud H6.1; board CmpBlocked; docs/tasks/TASK-HUD-H6.1.md).
 * The inventory test fails when a combat error code in src/lib/errors/** has no entry in REFUSALS.
 */
import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";

import {
  readShortfall,
  shortfallLabel,
  shortfallOf,
  shortfallSentence,
  shortfallTag,
  shortResourcesFromText,
  visibleShortfall,
} from "@/lib/domain/combat-actions/shortfall";
import type { Cost } from "@/lib/domain/card-effects/types";
import { CLIENT_REFUSALS, REFUSALS, beforeText, isMappedRefusal, refusalFor, refusalForCode } from "@/lib/errors/refusals";

const refuse = (code: string, extra: Record<string, unknown> = {}) => new ConvexError({ code, ...extra });
const hope = (n: number): Cost => ({ kind: "hope", amount: { kind: "fixed", value: n } });
const stress = (n: number): Cost => ({ kind: "stress", amount: { kind: "fixed", value: n } });

// ---------------------------------------------------------------- inventory

/** Every module of src/lib/errors (a new file joins by itself). */
const MODULES = import.meta.glob<Record<string, unknown>>("../../../src/lib/errors/*.ts");
/** The combat domains: every `combat*.ts` module, plus the adversary actions and the spotlight. */
const COMBAT_FILE = /^(combat.*|adversaryActions|spotlight)\.ts$/;
/** Codes of any domain that a combat surface throws by name (ADVERSARY_* of the catalogue, D8, is not combat). */
const COMBAT_CODE = /^(COMBAT_|CARD_|FEATURE_|SPOTLIGHT_|MOVE_)/;

async function errorModules(): Promise<{ file: string; codes: string[] }[]> {
  const out: { file: string; codes: string[] }[] = [];
  for (const [path, load] of Object.entries(MODULES)) {
    const file = path.split("/").pop()!;
    if (file === "refusals.ts" || file === "app-error.ts") continue;
    const mod = await load();
    const codes = Object.entries(mod)
      .filter(([name, value]) => name.endsWith("Messages") && typeof value === "object" && value !== null)
      .flatMap(([, value]) => Object.keys(value as object));
    out.push({ file, codes });
  }
  return out;
}

describe("refusal table inventory", () => {
  it("maps every combat error code in src/lib/errors/**", async () => {
    const modules = await errorModules();
    const combat = modules.filter((m) => COMBAT_FILE.test(m.file));
    expect(combat.map((m) => m.file)).toEqual(expect.arrayContaining(["combatActions.ts", "combatFeatures.ts", "combatMap.ts", "adversaryActions.ts", "spotlight.ts"]));
    const unmapped = [
      ...combat.flatMap((m) => m.codes),
      ...modules.flatMap((m) => m.codes.filter((c) => COMBAT_CODE.test(c))),
    ].filter((code) => !(code in REFUSALS));
    expect(unmapped).toEqual([]);
  });

  it("keys only real codes or client-only ones (no invented server codes)", async () => {
    const real = new Set((await errorModules()).flatMap((m) => m.codes));
    for (const code of Object.keys(REFUSALS)) expect(real.has(code), code).toBe(true);
    for (const code of Object.keys(CLIENT_REFUSALS)) expect(real.has(code), code).toBe(false);
  });
});

// ---------------------------------------------------------------- board rows

describe("CmpBlocked rows", () => {
  it("CARD_COST_UNPAID, Hope: 'Wall Walk needs 1 Hope. You have 0.' from the structured shortfall", () => {
    const r = refusalFor(refuse("CARD_COST_UNPAID", { message: "Short of: hope.", shortfall: { resource: "hope", need: 1, have: 0 } }), { subject: "Wall Walk" });
    expect(r).toMatchObject({ code: "CARD_COST_UNPAID", title: "Not enough Hope", lead: "Wall Walk needs 1 Hope.", rest: "You have 0.", hint: "Roll with Hope, or rest, to gain Hope.", place: "inline" });
    expect(r.before).toEqual(["card-tag", "use-disabled"]);
  });

  it("CARD_COST_UNPAID, Stress: 'Beastform needs a Stress. Your Stress is full.' from the client pre-compute", () => {
    const short = shortfallOf([stress(1)], { stress: 0 });
    const r = refusalFor(refuse("FEATURE_COST_UNPAID", { message: "Short of: stress." }), { subject: "Beastform", shortfall: short });
    expect(r).toMatchObject({ title: "No Stress left to mark", lead: "Beastform needs a Stress.", rest: "Your Stress is full.", hint: "Clear Stress on a rest or with an ally’s help." });
    expect(r.before).toEqual(["feature-disabled"]);
  });

  it("a cost refusal with only today's 'Short of: …' text names the resource, no numbers", () => {
    const r = refusalFor(refuse("CARD_COST_UNPAID", { message: "Short of: hope." }), { subject: "Wall Walk" });
    expect(r).toMatchObject({ title: "Not enough Hope", lead: "Not enough Hope for Wall Walk.", rest: null });
  });

  it("No Armor Slot (no server code): a client-only row, option hidden", () => {
    expect(refusalForCode("NO_ARMOR_SLOT")).toMatchObject({ lead: "No Armor Slot left to mark.", hint: "Repair armor on a rest.", before: ["option-hidden"] });
    expect(shortfallSentence({ resource: "armor", need: 1, have: 0 }).lead).toBe("No Armor Slot left to mark.");
  });

  it("CARD_EXHAUSTED: 'Rune Ward is used until your next rest.'", () => {
    const r = refusalFor(refuse("CARD_EXHAUSTED", { message: "once per rest" }), { subject: "Rune Ward" });
    expect(r.text).toBe("Rune Ward is used until your next rest.");
    expect(beforeText("CARD_EXHAUSTED")).toBe("Used · back after a rest");
  });

  it("FEATURE_USED* → FEATURE_EXHAUSTED", () => {
    expect(refusalFor(refuse("FEATURE_EXHAUSTED"))).toMatchObject({ title: "Feature used", lead: "That feature is used up for now.", hint: "It comes back on a rest.", before: ["sheet-badge"] });
  });

  it("CONDITION_NOT_MET* → INVALID / FEATURE_STATE_MISSING (the server's sentence wins)", () => {
    const r = refusalFor(refuse("INVALID", { message: "You need to be inside the area first." }));
    expect(r).toMatchObject({ title: "Situation not met", lead: "You need to be inside the area first.", before: ["card-tag"] });
    expect(refusalFor(refuse("FEATURE_STATE_MISSING")).title).toBe("Situation not met");
  });

  it("TOO_MANY_TARGETS* and BAD_TARGET* → COMBAT_TARGET_INVALID", () => {
    expect(refusalFor(refuse("COMBAT_TARGET_INVALID"), { max: 2 }).lead).toBe("Pick up to 2 targets.");
    expect(refusalFor(refuse("COMBAT_TARGET_INVALID"), { target: "the Bandit" }).lead).toBe("The Bandit can’t be attacked right now.");
    expect(refusalFor(refuse("COMBAT_TARGET_INVALID", { message: "Pick at least 2 targets." })).lead).toBe("Pick at least 2 targets.");
    expect(REFUSALS.COMBAT_TARGET_INVALID.before).toEqual(["picker-counter", "ring-dimmed"]);
  });

  it("COMBAT_NO_LINE_OF_SIGHT: 'You can't see the Bandit from where you stand.'", () => {
    const r = refusalFor(refuse("COMBAT_NO_LINE_OF_SIGHT"), { target: "the Bandit" });
    expect(r).toMatchObject({ lead: "You can’t see the Bandit", rest: "from where you stand.", hint: "Move or remove what blocks the view.", before: ["ring-dotted"] });
  });

  it("OUT_OF_REACH* → COMBAT_OUT_OF_REACH", () => {
    expect(refusalFor(refuse("COMBAT_OUT_OF_REACH"), { target: "the Bandit" })).toMatchObject({ lead: "Move next to the Bandit first.", before: ["ring-hint"] });
  });

  it("NOT_IN_COMBAT* → CARD_NOT_COMBAT / FEATURE_NOT_COMBAT", () => {
    expect(refusalFor(refuse("CARD_NOT_COMBAT"), { subject: "Wall Walk" }).lead).toBe("Wall Walk can’t be used in combat.");
    expect(refusalFor(refuse("FEATURE_NOT_COMBAT"), { subject: "Evolution" }).before).toEqual(["feature-disabled"]);
  });

  it("NO_MAP* → FEATURE_NEEDS_MAP, as a toast", () => {
    expect(refusalFor(refuse("FEATURE_NEEDS_MAP"))).toMatchObject({ title: "No live map", text: "That needs a live map with its targets on it.", hint: "Ask the GM to set a map live.", place: "toast" });
  });

  it("the server's structured shortfall wins over the client pre-compute on all four cost codes (dcm-bxp.99.32.2)", () => {
    const client = [{ resource: "hope" as const, need: 9, have: 9 }];
    const cases: [string, Record<string, unknown>, string, string][] = [
      ["CARD_COST_UNPAID", { resource: "hope", need: 2, have: 1 }, "Wall Walk needs 2 Hope.", "You have 1."],
      ["FEATURE_COST_UNPAID", { resource: "stress", need: 1, have: 0 }, "Wall Walk needs a Stress.", "Your Stress is full."],
      ["NOT_ENOUGH_HOPE", { resource: "hope", need: 3, have: 2 }, "Wall Walk needs 3 Hope.", "You have 2."],
      ["NOT_ENOUGH_FEAR", { resource: "fear", need: 2, have: 0 }, "Wall Walk needs 2 Fear.", "You have 0."],
    ];
    for (const [code, shortfall, lead, rest] of cases) {
      const r = refusalFor(refuse(code, { message: "Short of: hope.", shortfall }), { subject: "Wall Walk", shortfall: client, viewer: "gm" });
      expect(r, code).toMatchObject({ code, lead, rest });
    }
    // Without one, the client's numbers are the fallback.
    expect(refusalFor(refuse("NOT_ENOUGH_HOPE"), { subject: "Wall Walk", shortfall: [{ resource: "hope", need: 3, have: 1 }] })).toMatchObject({ lead: "Wall Walk needs 3 Hope.", rest: "You have 1." });
    // A Fear shortfall from the server is the GM's.
    expect(refusalFor(refuse("NOT_ENOUGH_FEAR", { shortfall: { resource: "fear", need: 2, have: 1 } }), { viewer: "gm" }).shortfall).toEqual([{ resource: "fear", need: 2, have: 1, payer: "gm" }]);
  });

  it("NOT_ENOUGH_FEAR: 'This needs 2 Fear. You have 1.'", () => {
    const r = refusalFor(refuse("NOT_ENOUGH_FEAR"), { viewer: "gm", shortfall: [{ resource: "fear", need: 2, have: 1, payer: "gm" }] });
    expect(r).toMatchObject({ title: "GM: not enough Fear", lead: "This needs 2 Fear.", rest: "You have 1.", before: ["fear-disabled"] });
    expect(refusalFor(refuse("NOT_ENOUGH_FEAR"))).toMatchObject({ title: "GM: not enough Fear", lead: "Not enough Fear for that." });
  });

  it("SPOTLIGHT_FIRST* → ADVERSARY_NOT_SPOTLIT", () => {
    expect(refusalFor(refuse("ADVERSARY_NOT_SPOTLIT"), { adversary: "the Lieutenant", viewer: "gm" })).toMatchObject({
      title: "GM: spotlight first",
      lead: "Spotlight the Lieutenant first.",
      hint: "Spotlighting costs 1 Fear.",
      before: ["attack-disabled"],
    });
  });

  it("STALE_REQUEST* → REQUEST_NOT_OPEN: a neutral toast, then refresh", () => {
    expect(refusalFor(refuse("REQUEST_NOT_OPEN"))).toMatchObject({ title: "Already answered", lead: "Someone already answered this.", place: "toast", then: "refresh", tone: "neutral" });
  });

  it("MOVE_BLOCKED: the token snaps back", () => {
    expect(refusalFor(refuse("MOVE_BLOCKED", { message: "Something blocks the way." }))).toMatchObject({ lead: "Something blocks the way.", then: "snap-back" });
  });

  it("difficult terrain has no refusal: moving onto it rolls nothing (user answer 2026-11-02)", () => {
    expect(isMappedRefusal("DIFFICULT_TERRAIN")).toBe(false);
    expect(refusalForCode("DIFFICULT_TERRAIN").code).toBe("FALLBACK");
  });

  it("SPOTLIGHT_WITH_GM: the board's words, not the server's default", () => {
    expect(refusalFor(refuse("SPOTLIGHT_WITH_GM")).text).toBe("The GM has the spotlight. You can use reactions until it comes back.");
    expect(REFUSALS.SPOTLIGHT_WITH_GM.before).toEqual(["control-disabled"]);
  });

  it("FALLBACK: an unknown code, a non-refusal error, a bare string", () => {
    for (const e of [refuse("NO_SUCH_CODE"), new Error("network"), "NOPE", null]) {
      expect(refusalFor(e)).toMatchObject({ code: "FALLBACK", lead: "Something went wrong.", rest: "Check your connection and try again.", place: "toast" });
    }
  });

  it("an app code outside the combat table keeps its own words under the control", () => {
    expect(refusalFor(refuse("UNDO_STALE"))).toMatchObject({ code: "UNDO_STALE", lead: "That can't be undone any more: something newer happened since.", place: "inline" });
  });
});

// ---------------------------------------------------------------- shortfall

describe("shortfall helper", () => {
  it("pre-computes fixed costs against the payer's room; resources left out are not checked", () => {
    expect(shortfallOf([hope(3), stress(1)], { hope: 1 })).toEqual([{ resource: "hope", need: 3, have: 1 }]);
    expect(shortfallOf([hope(1)], { hope: 1 })).toEqual([]);
    expect(shortfallOf([{ kind: "hope", amount: { kind: "chosen", choice: "x" } }], { hope: 0 })).toEqual([]);
    expect(shortfallOf([{ kind: "tokens", amount: { kind: "fixed", value: 2 }, pool: "favor" }], { favor: 1 })).toEqual([{ resource: "favor", need: 2, have: 1 }]);
  });

  it("an either-cost is short only when every option is", () => {
    const either: Cost = { kind: "either", options: [[hope(1)], [stress(1)]] };
    expect(shortfallOf([either], { hope: 0, stress: 1 })).toEqual([]);
    expect(shortfallOf([either], { hope: 0, stress: 0 })).toEqual([{ resource: "hope", need: 1, have: 0 }]);
  });

  it("the board's before-the-click forms", () => {
    expect(shortfallLabel({ resource: "hope", need: 3, have: 1 })).toBe("Needs 3 Hope · you have 1");
    expect(shortfallTag({ resource: "hope", need: 1, have: 0 })).toBe("Needs 1 Hope");
    expect(shortfallLabel({ resource: "stress", need: 1, have: 0 })).toBe("Needs a Stress · your Stress is full");
    expect(shortfallLabel({ resource: "armor", need: 1, have: 0 })).toBe("No Armor Slot left");
    expect(shortfallLabel({ resource: "fear", need: 2, have: 1 }, "gm")).toBe("Needs 2 Fear · you have 1");
    expect(beforeText("CARD_COST_UNPAID", { shortfall: [{ resource: "hope", need: 3, have: 1 }] })).toBe("Needs 3 Hope · you have 1");
  });

  it("'needs' everywhere, the action ring included ('Evolution needs 3 Hope. You have 1.')", () => {
    const s = shortfallSentence({ resource: "hope", need: 3, have: 1 }, { subject: "Evolution" });
    expect(`${s.lead} ${s.rest}`).toBe("Evolution needs 3 Hope. You have 1.");
  });

  it("reads the planned structured shortfall (single or list) and drops malformed parts", () => {
    expect(readShortfall({ code: "CARD_COST_UNPAID", shortfall: { resource: "hope", need: 2, have: 0 } })).toEqual([{ resource: "hope", need: 2, have: 0 }]);
    expect(readShortfall({ shortfall: [{ resource: "stress", need: 1, have: 0 }, { resource: "mana", need: 1, have: 0 }] })).toEqual([{ resource: "stress", need: 1, have: 0 }]);
    expect(readShortfall({ shortfall: { resource: "hope", need: "2" } })).toEqual([{ resource: "hope", need: null, have: null }]);
    expect(readShortfall({ code: "X" })).toEqual([]);
    expect(readShortfall(null)).toEqual([]);
  });

  it("reads today's 'Short of: …' texts", () => {
    expect(shortResourcesFromText("Short of: hope, stress.")).toEqual([
      { resource: "hope", need: null, have: null },
      { resource: "stress", need: null, have: null },
    ]);
    expect(shortResourcesFromText("Short of: 2 Hope (Moss).")).toEqual([{ resource: "hope", need: null, have: null }]);
    expect(shortResourcesFromText("You can't do that.")).toEqual([]);
  });

  it("never shows an enemy's numbers to a player", () => {
    const enemy = { resource: "stress" as const, need: 2, have: 1, payer: "adversary" as const };
    expect(visibleShortfall(enemy, "player")).toEqual({ resource: "stress", need: null, have: null, payer: "adversary" });
    expect(visibleShortfall(enemy, "gm")).toEqual(enemy);
    const r = refusalFor(refuse("FEATURE_COST_UNPAID", { shortfall: enemy }), { subject: "Shield Wall" });
    expect(r.text).not.toMatch(/\d/);
    expect(r.shortfall).toEqual([{ resource: "stress", need: null, have: null, payer: "adversary" }]);
    expect(shortfallLabel(enemy)).toBe("Not enough Stress");
  });
});
