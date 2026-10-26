import { describe, expect, it } from "vitest";

import type { CardUse } from "@/lib/domain/card-effects/types";
import { createDelegator, delegatedExhaustion, delegatedKeys, delegateFeature } from "@/lib/domain/feature-effects/delegate";
import { featureAvailability, runFeature } from "@/lib/domain/feature-effects/run";
import type { FeatureEffect } from "@/lib/domain/feature-effects/types";
import { queueRng } from "@/lib/domain/dice";
import { actorOf, fixed, sheetOf } from "./fixtures";

// Plan sheet-drawer, SD1 (NV2): D5 features run inside the feature's plan, so D5's classState, held dice and once-per
// keys stay the one record. Book: Rally (CB p.28: "Once per session, … give yourself and each of your allies a Rally Die.
// At level 1, your Rally Die is a d6"; Epic Poetry CB p.29: d10), Unstoppable (CB p.36: "Once per long rest"), Beastform
// (CB p.30: "Mark a Stress to magically transform"), Patron's Pact (HF p.14: spend a Favor).

const entry = (featureId: string, owner: string, use: Partial<CardUse>, extra: Partial<FeatureEffect> = {}): FeatureEffect => ({
  featureId,
  source: "class",
  owner,
  uses: [{ id: "main", name: featureId, activation: { kind: "action" }, steps: [], ...use }],
  ...extra,
});

const rally = entry("class:bard:rally", "bard", { steps: [{ kind: "delegate", to: "self", feature: "rally" }] }, {
  upgrades: [
    { when: { kind: "level", atLeast: 5 }, patch: { dieSides: 8 } },
    { when: { kind: "feature", featureId: "subclass:wordsmith:epic-poetry" }, patch: { dieSides: 10 } },
  ],
});

describe("finding the delegated D5 features", () => {
  it("lists delegate steps anywhere in a use, and finds the D5 feature on the class or the multiclass", () => {
    const use: CardUse = {
      id: "main",
      name: "x",
      activation: { kind: "action" },
      steps: [
        { kind: "optional", id: "o", label: "o", steps: [{ kind: "delegate", to: "self", feature: "unstoppable" }] },
        { kind: "choose", id: "c", label: "c", options: [{ id: "a", label: "a", steps: [{ kind: "delegate", to: "self", feature: "rally" }] }] },
      ],
    };
    expect(delegatedKeys(use)).toEqual(["unstoppable", "rally"]);
    expect(delegateFeature(sheetOf("bard", "troubadour"), "rally")?.name).toBe("Rally");
    expect(delegateFeature(sheetOf("guardian", "stalwart", { multiclass: { classId: "bard", subclassId: "troubadour", domainId: "grace" } }), "rally")?.name).toBe("Rally");
    expect(delegateFeature(sheetOf("guardian", "stalwart"), "rally")).toBeUndefined();
  });
});

describe("Rally through the feature runner", () => {
  const ally = { characterId: "mira", sheet: sheetOf("guardian", "stalwart") };

  it("gives the bard and each ally a Rally Die (d10 with Epic Poetry) and records D5's `rally` key", () => {
    const sheet = sheetOf("bard", "wordsmith", { subclassRank: "specialization" });
    const result = runFeature(rally, undefined, {
      actor: actorOf(sheet),
      gmFear: 0,
      rng: queueRng([]),
      sheet,
      others: [ally],
      holdings: { rank: "specialization", featureIds: new Set(["subclass:wordsmith:epic-poetry"]), level: 1 },
    });
    if (!result.ok) throw new Error(result.detail);
    expect(result.sheet!.heldDice).toMatchObject([{ kind: "rally", sides: 10, until: "session" }]);
    expect(result.others).toHaveLength(1);
    expect(result.others[0]!.sheet.heldDice).toMatchObject([{ kind: "rally", sides: 10 }]);
    expect(result.plan.actor.featureUses).toEqual([{ key: "rally", until: "session" }]);
    expect(result.plan.actor.after.heldDice).toMatchObject([{ kind: "rally", sides: 10 }]);
    expect(result.plan.steps.find((s) => s.kind === "delegate")).toMatchObject({ done: true, summary: "rallied the party: 2 Rally Dice (d6)" });
  });

  it("without an upgrade D5's own size stands (d6 at level 1)", () => {
    const sheet = sheetOf("bard", "troubadour");
    const result = runFeature(rally, undefined, { actor: actorOf(sheet), gmFear: 0, rng: queueRng([]), sheet, holdings: { rank: "foundation", featureIds: new Set(), level: 1 } });
    if (!result.ok) throw new Error(result.detail);
    expect(result.sheet!.heldDice).toMatchObject([{ kind: "rally", sides: 6 }]);
  });

  it("a `rally` key D5 already wrote reads as exhausted, in the runner and the drawer", () => {
    const sheet = sheetOf("bard", "troubadour", { featureUses: [{ key: "rally", until: "session" }] });
    expect(runFeature(rally, undefined, { actor: actorOf(sheet), gmFear: 0, rng: queueRng([]), sheet })).toMatchObject({ ok: false, reason: "exhausted", detail: "Back next session" });
    expect(featureAvailability(sheet, rally)).toEqual({ state: "exhausted", until: "session", label: "Back next session" });
    expect(featureAvailability(sheetOf("bard", "troubadour"), rally)).toEqual({ state: "ready" });
  });
});

describe("the other D5 once-per keys", () => {
  it("Unstoppable writes its die and `unstoppable` (long rest); Channel Raw Power and Commune read as exhausted", () => {
    const unstoppable = entry("class:guardian:unstoppable", "guardian", { steps: [{ kind: "delegate", to: "self", feature: "unstoppable" }] });
    const sheet = sheetOf("guardian", "stalwart");
    const result = runFeature(unstoppable, undefined, { actor: actorOf(sheet), gmFear: 0, rng: queueRng([]), sheet });
    if (!result.ok) throw new Error(result.detail);
    expect(result.sheet!.classState.unstoppable).toEqual({ value: 1, max: 4 });
    expect(result.plan.actor.featureUses).toEqual([{ key: "unstoppable", until: "longRest" }]);
    const used = { ...sheet, featureUses: result.plan.actor.featureUses };
    expect(featureAvailability(used, unstoppable)).toMatchObject({ state: "exhausted", label: "Back after a long rest" });

    const channel = entry("class:sorcerer:channel-raw-power", "sorcerer", { steps: [{ kind: "delegate", to: "self", feature: "channelRawPower" }] });
    expect(delegatedExhaustion(sheetOf("sorcerer", "elemental-origin", { featureUses: [{ key: "channelRawPower", until: "longRest" }] }), channel.uses[0]!)).toMatchObject({ key: "channelRawPower" });
    const commune = entry("class:witch:commune", "witch", { steps: [{ kind: "delegate", to: "self", feature: "commune" }] });
    expect(delegatedExhaustion(sheetOf("witch", "hedge", { featureUses: [{ key: "commune", until: "longRest" }] }), commune.uses[0]!)).toMatchObject({ key: "commune", label: "Back after a long rest" });
    expect(delegatedExhaustion(sheetOf("witch", "hedge"), commune.uses[0]!)).toBeNull();
  });
});

describe("resources pass both ways", () => {
  it("Beastform: the entry's Stress is marked before D5 runs; the form's effect lands on the sheet", () => {
    const beastform = entry("class:druid:beastform", "druid", {
      costs: [{ kind: "stress", amount: fixed(1) }],
      steps: [{ kind: "delegate", to: "self", feature: "beastform", params: { choiceFrom: "form" } }],
    });
    const sheet = sheetOf("druid", "warden-of-the-elements");
    const result = runFeature(beastform, undefined, { actor: actorOf(sheet), gmFear: 0, rng: queueRng([]), sheet, options: { form: ["agile-scout"] } });
    if (!result.ok) throw new Error(result.detail);
    expect(result.plan.actor.after.stress).toBe(2);
    expect(result.sheet!.stress).toBe(2);
    expect(result.sheet!.effects.find((e) => e.id === "beastform")?.text).toMatch(/^Agile Scout/);
    // D5 refuses a form that does not exist: the whole use is refused.
    expect(runFeature(beastform, undefined, { actor: actorOf(sheet), gmFear: 0, rng: queueRng([]), sheet, options: { form: ["dragon"] } })).toMatchObject({ ok: false, reason: "choice", detail: "Choose a Beastform." });
  });

  it("Patron's Pact: D5 spends the Favor; the runner's actor takes the Favor back", () => {
    const pact = entry("class:warlock:patrons-pact", "warlock", { steps: [{ kind: "delegate", to: "self", feature: "patronsPact" }] });
    const sheet = sheetOf("warlock", "pact-of-the-endless", { classState: { favor: 3 } });
    const result = runFeature(pact, undefined, { actor: actorOf(sheet, { favor: 3 }), gmFear: 0, rng: queueRng([]), sheet });
    if (!result.ok) throw new Error(result.detail);
    expect(result.plan.actor.after.favor).toBe(2);
    expect(result.plan.actor.after.heldDice).toMatchObject([{ kind: "patron", sides: 6 }]);
  });

  it("a delegator alone: unknown keys refuse, the sheet and the changed others are kept", () => {
    const sheet = sheetOf("guardian", "stalwart");
    const d = createDelegator({ sheet, rng: queueRng([]) });
    expect(d.handler({ feature: "rally", params: {}, actor: { hope: 3, stress: 1, hp: 2, armor: 0, heldDice: [], featureUses: [] } })).toEqual({ ok: false, detail: 'No automated feature "rally".' });
    expect(d.sheet()).toBe(sheet);
    expect(d.others()).toEqual([]);
    expect(d.rolls()).toEqual([]);
  });
});
