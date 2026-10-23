import { describe, expect, it } from "vitest";

import type { CardUse, Step } from "@/lib/domain/card-effects/types";
import { runFeature } from "@/lib/domain/feature-effects/run";
import type { FeatureEffect } from "@/lib/domain/feature-effects/types";
import { activeUpgrades, applyUpgrades, patchUse, upgradedDieSides, upgradeHolds, type Holdings } from "@/lib/domain/feature-effects/upgrades";
import { queueRng } from "@/lib/domain/dice";
import { actorOf, adversary, fixed, sheetOf } from "./fixtures";

// Plan sheet-drawer, SD1 (NV3): upgrades by rank, feature and level, one test per upgrade the acceptance names. The
// entries here are test fixtures written from the book text (the FE-* tracers write the real ones):
// - Virtuoso (CB p.28): "You can perform each of your 'Gifted Performer' feature's songs twice per long rest."
// - Fueled by Fear / Have No Fear (CB p.51): "The extra magic damage from your 'Face Your Fear' feature increases to 2d10"
//   / "to 3d10".
// - Ambush / Backstab (HF p.8): "Your 'Marked for Death' feature uses d6s instead of d4s" / "d8s instead of d6s".
// - Rally (CB p.28): "At level 5, your Rally Die increases to a d8." Epic Poetry (CB p.29): "Your Rally Die increases to a d10."
// - Regenerative Reach (CB p.31): "You can target creatures within Very Close range with your 'Regeneration' feature."
// - Devout (CB p.44): "you can use your 'Sparing Touch' feature twice instead of once per long rest."
// - Power of the Gods (CB p.45): "While flying, you deal an extra 1d12 damage instead of 1d8 from your 'Wings of Light' feature."
// - Poison Compendium / Venomancer (HF p.9): "You also know these poisons: …"

const holdings = (over: Partial<Holdings> = {}): Holdings => ({ rank: "foundation", featureIds: new Set(), level: 1, ...over });
const has = (...ids: string[]) => new Set(ids);

const cardUse = (over: Partial<CardUse>): CardUse => ({ id: "main", name: "Test", activation: { kind: "action" }, steps: [], ...over });

describe("when an upgrade holds", () => {
  it("rank: that card or a higher one; feature: held; level: at least", () => {
    expect(upgradeHolds({ kind: "rank", rank: "specialization" }, holdings({ rank: "mastery" }))).toBe(true);
    expect(upgradeHolds({ kind: "rank", rank: "mastery" }, holdings({ rank: "specialization" }))).toBe(false);
    expect(upgradeHolds({ kind: "feature", featureId: "x" }, holdings({ featureIds: has("x") }))).toBe(true);
    expect(upgradeHolds({ kind: "level", atLeast: 5 }, holdings({ level: 4 }))).toBe(false);
    expect(upgradeHolds({ kind: "level", atLeast: 5 }, holdings({ level: 5 }))).toBe(true);
  });
});

describe("Virtuoso: Gifted Performer songs twice per long rest", () => {
  const song = (id: string): CardUse => cardUse({ id, name: id, limit: { per: "longRest" }, steps: [{ kind: "hope", to: "self", change: "gain", amount: fixed(1) }] });
  const giftedPerformer: FeatureEffect = {
    featureId: "subclass:troubadour:gifted-performer",
    source: "subclass",
    owner: "troubadour",
    card: "foundation",
    uses: [song("relaxing"), song("epic"), song("heartbreaking")],
    upgrades: [{ when: { kind: "feature", featureId: "subclass:troubadour:virtuoso" }, patch: { limitTimes: 2 }, note: "Virtuoso" }],
  };

  it("once each without it, twice each with it (the use records under feat:<featureId>:<useId>)", () => {
    const sheet = sheetOf("bard", "troubadour");
    const first = runFeature(giftedPerformer, "relaxing", { actor: actorOf(sheet), gmFear: 0, rng: queueRng([]) });
    if (!first.ok) throw new Error(first.detail);
    expect(first.plan.limit).toEqual({ key: "feat:subclass:troubadour:gifted-performer:relaxing", until: "longRest", consumed: true });
    const used = actorOf(sheet, { featureUses: first.plan.actor.featureUses });
    expect(runFeature(giftedPerformer, "relaxing", { actor: used, gmFear: 0, rng: queueRng([]) })).toMatchObject({ ok: false, reason: "exhausted" });
    // Another song is its own use.
    expect(runFeature(giftedPerformer, "epic", { actor: used, gmFear: 0, rng: queueRng([]) }).ok).toBe(true);

    const virtuoso = holdings({ rank: "mastery", featureIds: has("subclass:troubadour:virtuoso") });
    const second = runFeature(giftedPerformer, "relaxing", { actor: used, gmFear: 0, rng: queueRng([]), holdings: virtuoso });
    if (!second.ok) throw new Error(second.detail);
    const twice = actorOf(sheet, { featureUses: second.plan.actor.featureUses });
    expect(runFeature(giftedPerformer, "relaxing", { actor: twice, gmFear: 0, rng: queueRng([]), holdings: virtuoso })).toMatchObject({ ok: false, reason: "exhausted", detail: "Back after a long rest" });
    expect(activeUpgrades(giftedPerformer, virtuoso).map((u) => u.note)).toEqual(["Virtuoso"]);
  });
});

describe("Face Your Fear: 1d10, 2d10 with Fueled by Fear, 3d10 with Have No Fear", () => {
  const faceYourFear: FeatureEffect = {
    featureId: "subclass:school-of-war:face-your-fear",
    source: "subclass",
    owner: "school-of-war",
    card: "foundation",
    uses: [
      cardUse({
        activation: { kind: "auto", trigger: { kind: "whenYouAttack", result: "successWithFear" } },
        steps: [{ kind: "modifyDamage", to: "self", change: { kind: "add", amount: { kind: "dice", dice: { count: fixed(1), sides: 10 } }, type: "magic" } }],
      }),
    ],
    upgrades: [
      { when: { kind: "feature", featureId: "subclass:school-of-war:fueled-by-fear" }, patch: { diceCount: fixed(2) } },
      { when: { kind: "feature", featureId: "subclass:school-of-war:have-no-fear" }, patch: { diceCount: fixed(3) } },
    ],
  };
  const extra = (h: Holdings, rolls: number[]) => {
    const r = runFeature(faceYourFear, undefined, { actor: actorOf(sheetOf("wizard", "school-of-war")), gmFear: 0, rng: queueRng(rolls), holdings: h });
    if (!r.ok) throw new Error(r.detail);
    return r.plan.steps.find((s) => s.kind === "fold");
  };

  it("the dice count grows with each upgrade card; the later one wins", () => {
    expect(extra(holdings(), [7])).toMatchObject({ amount: 7 });
    expect(extra(holdings({ featureIds: has("subclass:school-of-war:fueled-by-fear") }), [7, 3])).toMatchObject({ amount: 10 });
    expect(extra(holdings({ featureIds: has("subclass:school-of-war:fueled-by-fear", "subclass:school-of-war:have-no-fear") }), [7, 3, 9])).toMatchObject({ amount: 19 });
  });
});

describe("Marked for Death: d4s, d6s with Ambush, d8s with Backstab", () => {
  const marked: FeatureEffect = {
    featureId: "class:assassin:marked-for-death",
    source: "class",
    owner: "assassin",
    uses: [
      cardUse({
        targets: { side: "enemy", range: "far", count: { kind: "one" } },
        // "add a number of d4s equal to your tier to the damage roll" (tier 1 here: one die).
        steps: [{ kind: "damage", to: "targets", roll: { kind: "dice", dice: { count: { kind: "byTier", values: [1, 2, 3, 4] }, sides: 4 } }, type: "physical" }],
      }),
    ],
    upgrades: [
      { when: { kind: "feature", featureId: "subclass:executioners-guild:ambush" }, patch: { dieSides: 6 } },
      { when: { kind: "feature", featureId: "subclass:executioners-guild:backstab" }, patch: { dieSides: 8 } },
    ],
  };
  const sides = (h: Holdings) => {
    const r = runFeature(marked, undefined, { actor: actorOf(sheetOf("assassin", "executioners-guild")), gmFear: 0, rng: queueRng([4]), targets: [adversary("a")], holdings: h });
    if (!r.ok) throw new Error(r.detail);
    const roll = r.plan.steps.find((s) => s.kind === "damageRoll");
    return roll && roll.kind === "damageRoll" ? roll.record.dice.map((d) => d.sides) : [];
  };

  it("the die size follows the upgrades", () => {
    expect(sides(holdings())).toEqual([4]);
    expect(sides(holdings({ featureIds: has("subclass:executioners-guild:ambush") }))).toEqual([6]);
    expect(sides(holdings({ featureIds: has("subclass:executioners-guild:ambush", "subclass:executioners-guild:backstab") }))).toEqual([8]);
  });
});

describe("Rally: d6, d8 at level 5, d10 with Epic Poetry", () => {
  const rally: FeatureEffect = {
    featureId: "class:bard:rally",
    source: "class",
    owner: "bard",
    uses: [cardUse({ steps: [{ kind: "delegate", to: "self", feature: "rally" }] })],
    upgrades: [
      { when: { kind: "level", atLeast: 5 }, patch: { dieSides: 8 }, note: "level 5" },
      { when: { kind: "feature", featureId: "subclass:wordsmith:epic-poetry" }, patch: { dieSides: 10 }, note: "Epic Poetry" },
    ],
  };

  it("the die size an upgrade gives the use (the delegated Rally Dice take it, delegate.test.ts)", () => {
    expect(upgradedDieSides(rally, "main", holdings())).toBeUndefined();
    expect(upgradedDieSides(rally, "main", holdings({ level: 5 }))).toBe(8);
    expect(upgradedDieSides(rally, "main", holdings({ level: 5, featureIds: has("subclass:wordsmith:epic-poetry") }))).toBe(10);
    expect(upgradedDieSides(rally, "main", holdings({ level: 1, featureIds: has("subclass:wordsmith:epic-poetry") }))).toBe(10);
  });

  it("a dice expression of the use takes the size too", () => {
    const spend = patchUse(cardUse({ steps: [{ kind: "clear", to: "self", track: "stress", amount: { kind: "dice", dice: { count: fixed(1), sides: 6 } } }] }), { dieSides: 8 });
    const step = spend.steps[0] as Extract<Step, { kind: "clear" }>;
    expect(step.amount).toEqual({ kind: "dice", dice: { count: fixed(1), sides: 8 } });
  });
});

describe("range, limit times, die size and options", () => {
  it("Regenerative Reach: Regeneration reaches Very Close instead of touch", () => {
    const regeneration: FeatureEffect = {
      featureId: "subclass:warden-of-renewal:regeneration",
      source: "subclass",
      owner: "warden-of-renewal",
      card: "foundation",
      uses: [cardUse({ targets: { side: "selfOrAlly", range: "melee", count: { kind: "one" } }, costs: [{ kind: "hope", amount: fixed(3) }], steps: [] })],
      upgrades: [{ when: { kind: "feature", featureId: "subclass:warden-of-renewal:regenerative-reach" }, patch: { range: "veryClose" } }],
    };
    expect(applyUpgrades(regeneration, holdings()).uses[0]!.targets).toMatchObject({ range: "melee" });
    expect(applyUpgrades(regeneration, holdings({ featureIds: has("subclass:warden-of-renewal:regenerative-reach") })).uses[0]!.targets).toMatchObject({ range: "veryClose" });
  });

  it("Devout (the Divine Wielder's specialization): Sparing Touch twice per long rest, by rank", () => {
    const sparing: FeatureEffect = {
      featureId: "subclass:divine-wielder:sparing-touch",
      source: "subclass",
      owner: "divine-wielder",
      card: "foundation",
      uses: [cardUse({ limit: { per: "longRest" } })],
      upgrades: [{ when: { kind: "rank", rank: "specialization" }, useId: "main", patch: { limitTimes: 2 } }],
    };
    expect(applyUpgrades(sparing, holdings()).uses[0]!.limit).toEqual({ per: "longRest" });
    expect(applyUpgrades(sparing, holdings({ rank: "specialization" })).uses[0]!.limit).toEqual({ per: "longRest", times: 2 });
    // A use the upgrade does not name is unchanged.
    const other = { ...sparing, upgrades: [{ ...sparing.upgrades![0]!, useId: "other" }] };
    expect(applyUpgrades(other, holdings({ rank: "mastery" })).uses[0]!.limit).toEqual({ per: "longRest" });
  });

  it("Power of the Gods: Wings of Light's extra 1d8 becomes 1d12", () => {
    const wings: FeatureEffect = {
      featureId: "subclass:winged-sentinel:wings-of-light",
      source: "subclass",
      owner: "winged-sentinel",
      card: "foundation",
      uses: [cardUse({ id: "strike", steps: [{ kind: "modifyDamage", to: "self", change: { kind: "add", amount: { kind: "dice", dice: { count: fixed(1), sides: 8 } } } }] })],
      upgrades: [{ when: { kind: "feature", featureId: "subclass:winged-sentinel:power-of-the-gods" }, useId: "strike", patch: { dieSides: 12 } }],
    };
    const step = applyUpgrades(wings, holdings({ featureIds: has("subclass:winged-sentinel:power-of-the-gods") })).uses[0]!.steps[0]!;
    expect(step).toMatchObject({ change: { amount: { dice: { sides: 12 } } } });
  });

  it("Poison Compendium and Venomancer add poisons to Toxic Concoctions' choice", () => {
    const poison = (id: string) => ({ id, label: id, steps: [] });
    const toxic: FeatureEffect = {
      featureId: "subclass:poisoners-guild:toxic-concoctions",
      source: "subclass",
      owner: "poisoners-guild",
      card: "foundation",
      uses: [cardUse({ id: "poison", steps: [{ kind: "optional", id: "afflict", label: "Poison", steps: [{ kind: "choose", id: "poison", label: "Poison", options: [poison("ghost-petal"), poison("grave-spore"), poison("leech-weed")] }] }] })],
      upgrades: [
        { when: { kind: "feature", featureId: "subclass:poisoners-guild:poison-compendium" }, patch: { chooseId: "poison", extraOptions: [poison("midnight-vine"), poison("gorgon-root")] } },
        { when: { kind: "feature", featureId: "subclass:poisoners-guild:venomancer" }, patch: { chooseId: "poison", extraOptions: [poison("blight-seed"), poison("fear-leaf"), poison("corpse-thorn")] } },
      ],
    };
    const options = (h: Holdings) => {
      const optional = applyUpgrades(toxic, h).uses[0]!.steps[0] as Extract<Step, { kind: "optional" }>;
      return (optional.steps[0] as Extract<Step, { kind: "choose" }>).options.map((o) => o.id);
    };
    expect(options(holdings())).toHaveLength(3);
    expect(options(holdings({ featureIds: has("subclass:poisoners-guild:poison-compendium") }))).toEqual(["ghost-petal", "grave-spore", "leech-weed", "midnight-vine", "gorgon-root"]);
    expect(options(holdings({ featureIds: has("subclass:poisoners-guild:poison-compendium", "subclass:poisoners-guild:venomancer") }))).toHaveLength(8);
  });

  it("extra steps (Reliable Backup's new Contacts Everywhere options, CB p.43) are appended", () => {
    const patched = patchUse(cardUse({ steps: [{ kind: "manual", to: "self", text: "a" }] }), { extraSteps: [{ kind: "manual", to: "self", text: "b" }] });
    expect(patched.steps.map((s) => (s.kind === "manual" ? s.text : ""))).toEqual(["a", "b"]);
  });
});
