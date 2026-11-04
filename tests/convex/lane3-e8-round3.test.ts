/**
 * Plan lanes-2 wave 9, tracer E8.3 (docs/tasks/TASK-LN3-E8.md): the feature runner round 3. Inline fixtures where the
 * SRD entry is not switched yet (Otherworldly Ire's rolled count, Vitality's pick).
 *
 * Expected values come from the book and the user's answers:
 * - HF p.15, Otherworldly Ire: "spend any number of Favor to roll that many Patron Dice and target a number of creatures
 *   within Close range equal to the highest result". User 2026-10-31 (dcm-atiu): the Favor is paid at the roll, no
 *   backing out.
 * - CB p.104: "If you ever have more than 1 chest, you'll need to store some of your gold before you can take more."
 *   User 2026-10-31 (dcm-i5e1): the excess goes to a party member within Close who is under the cap, else it is dropped.
 * - CB p.330, Vitality: "When you choose this card, permanently gain two of the following benefits: • One Stress slot •
 *   One Hit Point slot • +2 bonus to your damage thresholds Then place this card in your vault permanently."
 * - HF p.176, Locate Soul Echoes: "the players gain access to an additional downtime move: Locate Soul Echoes."
 * - CB p.40: "your companion's damage die is a d6 ... Choose whether they deal physical or magic damage."
 */
import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { actorFill, GIFT_EXCESS_TO, giveTo, goldRoom, passExcessGold, splitFeatureChoices, withExtraFacts } from "../../convex/lib/featureRunner";
import { countMark, paidAtRoll, payRollCosts, rollAndStoreCount, withoutRollCosts } from "../../convex/lib/featurePrompts";
import { locateSoulEchoesRestHook } from "../../convex/lib/restHooks";
import type { CardEffect, CardUse } from "../../src/lib/domain/card-effects/types";
import { featureCostShort, flagsOf, runOnChoose, sheetNumbers } from "../../src/lib/domain/feature-effects/run";
import { applyChosenPicks, cardsGained, chosenPicks, permanentThresholds, revertChosenPicks } from "../../src/lib/domain/level-up/on-choose";
import { applyMoves, interruptedMoves } from "../../src/lib/domain/rest/index";
import { frameRestMoves } from "../../src/lib/domain/rest/frame-hooks/index";
import { MOVE_LABELS } from "../../src/lib/domain/rest/moves";
import { actorOf, sheetOf } from "../unit/feature-effects/engine/fixtures";
import { allowWorldEmails, buildWorld } from "./authz/world";
import { key } from "./helpers";

allowWorldEmails();

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (e) {
    return (e as { data?: { code?: string } }).data?.code;
  }
  return undefined;
};

/** Otherworldly Ire as the wave-10 data will read: a count rolled first from the Favor chosen, paid with Favor. */
const ire = {
  id: "main",
  name: "Otherworldly Ire",
  activation: { kind: "action" },
  choices: [{ id: "favor", label: "Favor to spend", min: 1 }],
  costs: [
    { kind: "tokens", amount: { kind: "chosen", choice: "favor" }, pool: "favor" },
    { kind: "hope", amount: { kind: "fixed", value: 1 } },
  ],
  targets: { side: "enemy", range: "close", count: { kind: "upTo", rolledFirst: true, n: { kind: "dice", dice: { count: { kind: "chosen", choice: "favor" }, sides: 6, sidesOf: "patron" }, keep: "highest" } } },
  steps: [],
} as unknown as CardUse;

describe("dcm-atiu / dcm-nw7h: Otherworldly Ire pays its Favor at the roll", () => {
  it("every cost is paid at the roll (lanes-2 E8.4, dcm-szfg); the use skips them", () => {
    expect(paidAtRoll(ire)).toEqual(ire.costs);
    expect(withoutRollCosts(ire).costs).toBeUndefined();
    // Warden's Protection (a fixed 1d4 count) pays everything with the use.
    const warden = { ...ire, costs: [{ kind: "hope", amount: { kind: "fixed", value: 2 } }], targets: { side: "ally", range: "close", count: { kind: "upTo", rolledFirst: true, n: { kind: "dice", dice: { count: { kind: "fixed", value: 1 }, sides: 4 } } } } } as unknown as CardUse;
    expect(paidAtRoll(warden)).toEqual([]);
    expect(withoutRollCosts(warden)).toBe(warden);
  });

  it("payRollCosts takes the chosen Favor from the sheet", () => {
    const sheet = sheetOf("warlock", "pact-of-the-wrathful", { classState: { favor: 5 } } as never);
    expect(payRollCosts(sheet, paidAtRoll(ire), { favor: 3 }).classState.favor).toBe(2);
  });

  it("rollCount's store pays the Favor, keeps the marks and logs an undoable row", async () => {
    const w = await buildWorld();
    const out = await w.t.run(async (ctx) => {
      const character = (await ctx.db.get("characters", w.characterA))!;
      const sheet = { ...readSheet(character.sheet), classState: { favor: 4 } };
      await saveSheet(ctx, w.characterA, sheet);
      const rolled = await rollAndStoreCount(ctx, { campaignId: w.campaignId, character, sheet, featureId: "test:ire", use: ire, userId: w.users.player, choices: { favor: 3 } });
      const after = readSheet((await ctx.db.get("characters", w.characterA))!.sheet);
      const rows = await ctx.db
        .query("actionLog")
        .withIndex("by_character_at", (q) => q.eq("characterId", w.characterA))
        .collect();
      return { rolled, after, rows };
    });
    expect(out.rolled.count).toBeGreaterThanOrEqual(1);
    expect(out.rolled.count).toBeLessThanOrEqual(8);
    expect(out.after.classState.favor).toBe(1);
    expect(out.after.featureUses.map((u) => u.key)).toEqual(expect.arrayContaining([countMark(out.rolled.requestId), `${countMark(out.rolled.requestId)}:favor=3`]));
    const row = out.rows.find((r) => r.summary.includes("3 Favor"));
    expect(row?.undoable).toBe(true);
    expect(row?.before).toBeDefined();
  });

  it("a roll without enough Favor is refused and pays nothing", async () => {
    const w = await buildWorld();
    const code = await w.t.run(async (ctx) => {
      const character = (await ctx.db.get("characters", w.characterA))!;
      const sheet = { ...readSheet(character.sheet), classState: { favor: 1 } };
      try {
        await rollAndStoreCount(ctx, { campaignId: w.campaignId, character, sheet, featureId: "test:ire", use: ire, userId: w.users.player, choices: { favor: 3 } });
      } catch (e) {
        return (e as { data?: { code?: string } }).data?.code;
      }
      return "none";
    });
    expect(code).toBe("FEATURE_COST_UNPAID");
  });
});

describe("dcm-i5e1: gold past the cap is passed on or dropped", () => {
  const full = { handfuls: 9, bags: 9, chest: true };

  it("goldRoom: the handfuls that still fit", () => {
    expect(goldRoom(full, 5)).toBe(0);
    expect(goldRoom({ handfuls: 8, bags: 9, chest: true }, 5)).toBe(1);
    expect(goldRoom({ handfuls: 0, bags: 0, chest: false }, 5)).toBe(5);
  });

  it("giveTo with an overflow keeps what fits and counts the excess; without one it refuses", () => {
    const sheet = { ...sheetOf("rogue", "nightwalker"), gold: { handfuls: 8, bags: 9, chest: true } };
    const overflow = { excess: 0 };
    const out = giveTo(sheet, [{ kind: "gold", handfuls: 3 }], overflow);
    expect(out.gold).toEqual(full);
    expect(overflow.excess).toBe(2);
    expect(codeOf(() => giveTo(sheet, [{ kind: "gold", handfuls: 3 }]))).toBe("INVALID");
  });

  it("the pick decides; without one the nearest with room takes it; the rest is dropped", () => {
    const near = { id: "t1", name: "Bryn", distance: 2, room: 1 };
    const far = { id: "t2", name: "Cael", distance: 5, room: 9 };
    expect(passExcessGold(3, [far, near], undefined)).toEqual({ to: near, given: 1, dropped: 2 });
    expect(passExcessGold(3, [far, near], "t2")).toEqual({ to: far, given: 3, dropped: 0 });
    expect(passExcessGold(3, [far, near], "drop")).toEqual({ to: null, given: 0, dropped: 3 });
    expect(passExcessGold(3, [], undefined)).toEqual({ to: null, given: 0, dropped: 3 });
    expect(codeOf(() => passExcessGold(3, [near], "t9"))).toBe("COMBAT_TARGET_INVALID");
  });

  it("splitFeatureChoices takes giftExcessTo out of the card choices", () => {
    expect(splitFeatureChoices([{ id: GIFT_EXCESS_TO, value: "t1" }, { id: "x", value: 1 }] as never).rest).toEqual([{ id: "x", value: 1 }]);
  });
});

describe("dcm-pqbo / dcm-2z2 / dcm-b9hc: the actor's fill", () => {
  it("carries the companion die and type, Tide tokens, class dice and stats", () => {
    const sheet = sheetOf("ranger", "beastbound", { sessionFeatures: { tideTokens: 2 } } as never);
    const numbers = sheetNumbers(sheet);
    const fill = actorFill(sheet, numbers, { dieSides: 8, range: "melee", damageType: "magic", trainingLeft: 0, evasion: 10, stressMax: 3 });
    expect(fill.dieSides?.companion).toBe(8);
    expect(fill.companionDamageType).toBe("magic");
    expect(fill.tideTokens).toBe(2);
    expect(fill.stats).toEqual(numbers.stats);
    // Without a companion sheet: no companion fields (the runner's d6 / physical defaults).
    const none = actorFill(sheet, numbers, null);
    expect(none.dieSides?.companion).toBeUndefined();
    expect(none.companionDamageType).toBeUndefined();
  });
});

describe("dcm-576v / dcm-753y: extra facts", () => {
  it("weapons merge over the sheet's ranges; target / subject replace", () => {
    const own = { weapons: { primary: "melee" as const, secondary: null }, conditions: [] };
    const out = withExtraFacts(own, { weapons: { attacking: "melee" }, target: { conditions: ["vulnerable"], hp: 0, hpMax: 3, areas: [{ featureId: "circle", own: false }] } });
    expect(out.weapons).toEqual({ primary: "melee", secondary: null, attacking: "melee" });
    expect(out.target?.areas).toEqual([{ featureId: "circle", own: false }]);
    expect(withExtraFacts(own, undefined)).toBe(own);
  });
});

describe("dcm-hgvx: the payer's rules flags", () => {
  it("a Ravenous payer (cannotSpendHope) is short of Hope", () => {
    const sheet = sheetOf("guardian", "stalwart", { hope: 5 });
    const use = { id: "u", name: "U", activation: { kind: "action" }, costs: [{ kind: "hope", amount: { kind: "fixed", value: 1 } }], steps: [] } as unknown as CardUse;
    const actor = actorOf(sheet);
    expect(featureCostShort(actor, use)).toEqual([]);
    const flags = flagsOf([{ kind: "flag", flag: "cannotSpendHope" }, { kind: "stat" }]);
    expect(flags).toEqual(["cannotSpendHope"]);
    expect(featureCostShort(actor, use, {}, flags)).toEqual(["hope"]);
  });
});

/** Vitality as the wave-10 data could read: a pick of two distinct benefits when the card is chosen, then the vault. */
const vitality = {
  cardId: "vitality",
  uses: [
    {
      id: "main",
      name: "Vitality",
      activation: { kind: "auto", trigger: { kind: "whenYouChooseThisCard" } },
      steps: [
        {
          kind: "choose",
          id: "benefits",
          label: "Two benefits",
          count: { kind: "fixed", value: 2 },
          distinct: true,
          options: [
            { id: "stress", label: "One Stress slot", steps: [{ kind: "effect", to: "self", label: "Vitality", duration: "permanent", mods: [{ kind: "stat", stat: "stressMax", delta: { kind: "fixed", value: 1 } }] }] },
            { id: "hp", label: "One Hit Point slot", steps: [{ kind: "effect", to: "self", label: "Vitality", duration: "permanent", mods: [{ kind: "stat", stat: "hpMax", delta: { kind: "fixed", value: 1 } }] }] },
            {
              id: "thresholds",
              label: "+2 to your damage thresholds",
              steps: [
                {
                  kind: "effect",
                  to: "self",
                  label: "Vitality",
                  duration: "permanent",
                  mods: [
                    { kind: "stat", stat: "majorThreshold", delta: { kind: "fixed", value: 2 } },
                    { kind: "stat", stat: "severeThreshold", delta: { kind: "fixed", value: 2 } },
                  ],
                },
              ],
            },
          ],
        },
        { kind: "toVault", to: "self", permanent: true },
      ],
    },
  ],
} as unknown as CardEffect;

describe("dcm-31hq / dcm-40mj: Vitality's permanent picks", () => {
  const base = sheetOf("warrior", "call-of-the-brave");
  const sheet = { ...base, domainCards: { owned: [...base.domainCards.owned, "vitality"], loadout: [...base.domainCards.loadout.slice(0, 4), "vitality"] } };
  const actor = actorOf(sheet);
  const run = (options: Record<string, string[]>) => runOnChoose(vitality, { actor, gmFear: 0, rng: () => 1, targets: [], options });

  it("two picks: the slots rise once, the bonus is recorded, the card goes to the vault", () => {
    const out = run({ benefits: ["hp", "thresholds"] });
    if (out === null || !out.ok) throw new Error("expected a plan");
    const picks = chosenPicks(out.plan, actor.id);
    expect(picks).toMatchObject({ hp: 1, stress: 0, major: 2, severe: 2, toVault: true, missing: [] });
    const after = applyChosenPicks(sheet, "vitality", picks);
    expect(after.hpMax).toBe(sheet.hpMax + 1);
    expect(after.stressMax).toBe(sheet.stressMax);
    expect(permanentThresholds(after)).toEqual({ major: 2, severe: 2 });
    expect(after.domainCards.loadout).not.toContain("vitality");
    expect(after.domainCards.owned).toContain("vitality");
    // Applied twice: no second slot.
    expect(applyChosenPicks(after, "vitality", picks).hpMax).toBe(after.hpMax);
    // Undo of the level: the slots and bonuses go back.
    const undone = revertChosenPicks(after, ["vitality"]);
    expect(undone.hpMax).toBe(sheet.hpMax);
    expect(permanentThresholds(undone)).toEqual({ major: 0, severe: 0 });
  });

  it("without the pick the plan asks for it", () => {
    const out = run({});
    if (out === null || !out.ok) throw new Error("expected a plan");
    expect(chosenPicks(out.plan, actor.id).missing).toEqual(["Two benefits"]);
  });

  it("cardsGained lists the level's card, the domain card option's and the trade's", () => {
    expect(cardsGained({ cardId: "a", picks: [{ option: "domainCard", targets: ["b"] }, { option: "hp" }], tradeIn: "c" })).toEqual(["a", "b", "c"]);
  });

  it("levelUp.apply accepts cardChoices and levels a card without a choosing use as before", async () => {
    const w = await buildWorld();
    await w.as("gm").mutation(api.levelUp.partyLevelUp, { campaignId: w.campaignId, idempotencyKey: key() });
    const sheetBefore = await w.t.run(async (ctx) => readSheet((await ctx.db.get("characters", w.characterA))!.sheet));
    const { cardsForDomains, getClass } = await import("../../src/lib/srd/index");
    const domains = getClass(sheetBefore.classId)!.domains;
    const cardId = cardsForDomains(domains, 2).find((c) => c.level <= 2 && !sheetBefore.domainCards.owned.includes(c.id))!.id;
    const res = await w.as("player").mutation(api.levelUp.apply, {
      characterId: w.characterA as Id<"characters">,
      choice: { picks: [{ option: "hp", tier: 2 }, { option: "stress", tier: 2 }], experienceName: "Grit", cardId, cardChoices: { [cardId]: { x: ["y"] } } },
      idempotencyKey: key(),
    });
    expect(res.level).toBe(2);
  });
});

describe("dcm-dvia: Locate Soul Echoes (Journey to Horizon)", () => {
  it("is a frame move on either rest, only in Journey to Horizon; no sheet change; dropped when interrupted", () => {
    expect(frameRestMoves({ frameId: "journey-to-horizon", transformations: false, warlock: false }).extra).toEqual(["locateSoulEchoes"]);
    expect(frameRestMoves({ frameId: "witherwild", transformations: false, warlock: false }).extra).toEqual([]);
    expect(MOVE_LABELS.locateSoulEchoes).toBe("Locate Soul Echoes");
    expect(interruptedMoves("long", [{ move: "locateSoulEchoes" }])).toEqual([]);
    const sheet = sheetOf("guardian", "stalwart");
    const out = applyMoves("short", { a: sheet }, [{ characterId: "a", moves: [{ move: "locateSoulEchoes" }] }], () => 1);
    expect(out.sheets.a).toEqual(sheet);
  });

  it("the rest hook asks the GM for the bearing of each PC who chose it", async () => {
    const sheet = sheetOf("guardian", "stalwart");
    const id = "c1" as Id<"characters">;
    const input = (frameId: string, interrupted: boolean) =>
      ({
        campaign: { frameId },
        interrupted,
        choices: [{ characterId: id, moves: [{ move: "locateSoulEchoes" }] }],
        sheets: new Map([[id, sheet]]),
      }) as never;
    const lines = await locateSoulEchoesRestHook({} as never, input("journey-to-horizon", false));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("Locate Soul Echoes");
    expect(await locateSoulEchoesRestHook({} as never, input("witherwild", false))).toEqual([]);
    expect(await locateSoulEchoesRestHook({} as never, input("journey-to-horizon", true))).toEqual([]);
  });
});
