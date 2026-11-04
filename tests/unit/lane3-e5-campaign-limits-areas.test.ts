import { describe, expect, it } from "vitest";

import {
  CAMPAIGN_UNTIL,
  EXPIRING_UNTIL,
  USED_ON_EVER,
  featureLimitUntil,
  keyAvailability,
  limitPeriod,
  limitUntil,
  recordUse,
  recordUsedOn,
  stateCheckMet,
  usedOnBefore,
  usedOnKey,
  type CreatureFacts,
  type RequirementState,
  type StateFacts,
} from "@/lib/domain/card-effects/availability";
import type { Limit, StateCheck } from "@/lib/domain/card-effects/types";
import { EXPIRING_FEATURE_USES, expire, type ExpiryEvent } from "@/lib/domain/characters/expiry";
import { resolveNumber, type NumberEnv } from "@/lib/domain/combat-actions/numbers";
import { queueRng } from "@/lib/domain/dice";
import { FEATURE_USE_UNTIL, featureUseSchema } from "@/lib/validation/characters";

// Plan lanes-2 wave 9, tracer E5.3 (label w1-e5-checks-limits-numbers): Words of Discord's campaign-long memory
// (dcm-pg8x, dcm-c75), limits stored with their real period (dcm-bc67), inArea for the subject / target (dcm-753y) and
// the tideTokens / moonPhase readers (dcm-rm9). docs/tasks/TASK-LN3-E5.md.

const state = (facts: StateFacts = {}): RequirementState => ({
  hp: 2,
  hpMax: 6,
  stress: 1,
  stressMax: 6,
  armor: 1,
  hope: 3,
  armorWorn: true,
  loadoutDomains: [],
  activeCardEffects: [],
  situations: [],
  facts,
});
const met = (check: StateCheck, facts: StateFacts = {}) => stateCheckMet(check, state(facts));
const creature = (over: Partial<CreatureFacts> = {}): CreatureFacts => ({ conditions: [], hp: 0, hpMax: 6, ...over });

const ALL_EVENTS: readonly ExpiryEvent[] = ["shortRest", "longRest", "session", "scene", "hit", "gmTurn", "day", "week"];

describe("Words of Discord remembers a target for the whole campaign (dcm-pg8x, dcm-c75; CB p.335)", () => {
  // CB p.335: "The next time you cast Words of Discord on them, gain a -5 penalty to the Spellcast Roll."
  const key = "card:words-of-discord";

  it("featureUses stores `campaign` (the widen), and the memory is recorded with it", () => {
    expect(FEATURE_USE_UNTIL).toContain(CAMPAIGN_UNTIL);
    expect(featureUseSchema.safeParse({ key: usedOnKey(key, "adv-1"), until: "campaign" }).success).toBe(true);
    // Old rows stay valid: a pure widen.
    for (const until of ["rest", "longRest", "session", "scene", "gmTurn", "day", "week"]) {
      expect(featureUseSchema.safeParse({ key, until }).success).toBe(true);
    }
    expect(USED_ON_EVER).toBe("campaign");
    expect(recordUsedOn([], key, "adv-1")).toEqual([{ key: usedOnKey(key, "adv-1"), until: "campaign" }]);
  });

  it("no expiry event ends the memory: every later cast on that creature still sees it", () => {
    const uses = recordUsedOn([{ key: "card:other", until: "session" }], key, "adv-1");
    for (const event of ALL_EVENTS) {
      const after = expire({ featureUses: uses }, event);
      expect(usedOnBefore(after, key, "adv-1")).toBe(true);
    }
    expect(EXPIRING_FEATURE_USES).not.toContain("campaign");
    expect(EXPIRING_UNTIL).not.toContain("campaign");
    // A memory with `since` still ends with its period.
    expect(usedOnBefore(expire({ featureUses: recordUsedOn([], key, "adv-1", "rest") }, "shortRest"), key, "adv-1")).toBe(false);
  });

  it("a campaign entry is the longest period an exhausted key names", () => {
    expect(keyAvailability({ featureUses: [{ key: "k", until: "week" }, { key: "k", until: "campaign" }] }, "k")).toEqual({
      state: "exhausted",
      until: "campaign",
      label: "Not again this campaign",
    });
  });
});

describe("limits store their real period (dcm-bc67)", () => {
  it("limitUntil / featureLimitUntil return limitPeriod(limit) for every period expire ends", () => {
    const cases: [Limit, Limit["per"] | NonNullable<Limit["period"]>][] = [
      // Resurrection (CB p.341): "you can't cast Resurrection again for a week".
      [{ per: "session", period: "week", consumedOn: "failure" }, "week"],
      // Summon Tormentors (CB p.237): "Once per day".
      [{ per: "session", period: "day" }, "day"],
      // Ravenous (HF p.97): "Once per GM turn".
      [{ per: "scene", period: "gmTurn" }, "gmTurn"],
      [{ per: "rest" }, "rest"],
      [{ per: "longRest" }, "longRest"],
      [{ per: "session" }, "session"],
    ];
    for (const [limit, period] of cases) {
      expect(limitPeriod(limit)).toBe(period);
      expect(featureLimitUntil(limit)).toBe(period);
      expect(limitUntil(limit)).toBe(period);
      expect(EXPIRING_UNTIL).toContain(period);
    }
    // Cards keep a plain "once per scene" as session; features store scene.
    expect(limitUntil({ per: "scene" })).toBe("session");
    expect(featureLimitUntil({ per: "scene" })).toBe("scene");
    expect(featureLimitUntil("rest")).toBe("rest");
  });

  it("the stored period comes back when campaign time passes (CT fires day / week, dcm-ztb8)", () => {
    const resurrection: Limit = { per: "session", period: "week", consumedOn: "failure" };
    const uses = recordUse([], "card:resurrection", resurrection);
    expect(keyAvailability({ featureUses: uses }, "card:resurrection").state).toBe("exhausted");
    // A session or a day does not bring it back; a week does.
    expect(expire({ featureUses: uses }, "session").featureUses).toHaveLength(1);
    expect(expire({ featureUses: uses }, "day").featureUses).toHaveLength(1);
    expect(expire({ featureUses: uses }, "week").featureUses).toEqual([]);
    // Ravenous: back after the GM's turn.
    const ravenous = recordUse([], "feat:x", { per: "scene", period: "gmTurn" });
    expect(expire({ featureUses: ravenous }, "gmTurn").featureUses).toEqual([]);
  });
});

describe("inArea for the trigger's subject / the target (dcm-753y; Circle of Power, HF p.16)", () => {
  // HF p.16: "Remove a token each time you or an ally within the circle makes an action roll or evades an attack."
  const inCircle = { kind: "inArea", featureId: "circle-of-power", who: "subject" } as const;
  const areas = [{ featureId: "circle-of-power", own: false }];

  it("reads the subject's areas, not the actor's", () => {
    expect(met(inCircle, { subject: creature({ areas }) })).toBe(true);
    expect(met(inCircle, { subject: creature({ areas: [] }) })).toBe(false);
    expect(met(inCircle, { areas, subject: creature({ areas: [] }) })).toBe(false);
    // Unknown areas: the engine can't decide (the player's box decides).
    expect(met(inCircle, { subject: creature() })).toBeUndefined();
    expect(met(inCircle, {})).toBeUndefined();
  });

  it("reads the target's areas, and owner self needs the actor's own area", () => {
    expect(met({ kind: "inArea", featureId: "circle-of-power", who: "target" }, { target: creature({ areas }) })).toBe(true);
    expect(met({ kind: "inArea", featureId: "circle-of-power", who: "target", owner: "self" }, { target: creature({ areas }) })).toBe(false);
    const own = [{ featureId: "circle-of-power", own: true }];
    expect(met({ kind: "inArea", featureId: "circle-of-power", who: "target", owner: "self" }, { target: creature({ areas: own }) })).toBe(true);
  });
});

describe("tideTokens and moonPhase resolve (dcm-rm9)", () => {
  const env = (over: Partial<NumberEnv> = {}): NumberEnv => ({
    traits: { agility: 0, strength: 0, finesse: 0, instinct: 0, presence: 0, knowledge: 0 },
    spellcast: 0,
    proficiency: 1,
    level: 1,
    tier: 1,
    spent: {},
    choices: {},
    cardTokens: 0,
    gmFear: 0,
    self: { hp: 0, stress: 0 },
    markedThisMove: { self: {}, byTarget: {} },
    targetCount: { picked: 0, hit: 0, failedSave: 0 },
    loadoutDomains: [],
    vaultDomains: [],
    ...over,
  });

  it("Know the Tide (CB p.77): 'you can spend any number of these tokens'", () => {
    expect(resolveNumber({ kind: "tideTokens" }, env({ tideTokens: 3 }), queueRng([]))).toBe(3);
    expect(resolveNumber({ kind: "tideTokens" }, env(), queueRng([]))).toBe(0);
  });

  it("Lunar Phases (HF p.17): '1 New: Spend a Hope to negate Minor damage'", () => {
    expect(met({ kind: "moonPhase", phase: 1 }, { moonPhase: 1 })).toBe(true);
    expect(met({ kind: "moonPhase", phase: 1 }, { moonPhase: 3 })).toBe(false);
    expect(met({ kind: "moonPhase", phase: 1 }, {})).toBeUndefined();
  });
});
