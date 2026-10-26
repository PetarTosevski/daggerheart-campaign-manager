// Feature effects of Seraph and Witch (FE-seraph-witch) (plan sheet-drawer). Pure data: no framework imports, relative
// imports only (bundled into Convex). Each entry quotes its feature with the printed page (CB = Core Book p.44-45, HF =
// Hope & Fear p.16-17) and uses only the vocabulary of src/lib/domain/card-effects/types.ts; a step the vocabulary cannot
// express is a `manual` step with the feature's words plus a bead labelled `feature-effects vocabulary-gap`.
//
// One entry per Seraph and Witch feature classified combat or passive in ./classification.ts (20 of the 22; Commune and
// Walk Between Worlds are out of combat). Readings, manual steps and open rulings: docs/tasks/TASK-SD-FE-seraph-witch.md.

import type { FeatureEffect } from "../../domain/feature-effects/types";
import type { ConditionRef, NumberSource, Requirement, Step, TargetSpec } from "../../domain/card-effects/types";

const n = (value: number): NumberSource => ({ kind: "fixed", value });

/** "a penalty … equal to your tier" (Hex, HF p.16). */
const MINUS_TIER: NumberSource = { kind: "byTier", values: [-1, -2, -3, -4] };

/** Q16: "While flying" reads the drawer's Flying toggle (SD3 `setFlying`); without the fact the player confirms it. */
const WHILE_FLYING: Requirement = { kind: "situation", text: "While flying", check: { kind: "flying" } };

/** "aid yourself or an ally within Far range" (Prayer Dice, CB p.44). */
const SELF_OR_ALLY_FAR: TargetSpec = { side: "selfOrAlly", range: "far", count: { kind: "one" } };

const HEXED: ConditionRef = { kind: "tag", tag: "Hexed" };
const TALISMAN_HOLDER: ConditionRef = { kind: "tag", tag: "Enchanted Talisman" };

const NIGHTS_GLAMOUR = "subclass:moon:nights-glamour";
const GLAMOURED: Requirement = { kind: "situation", text: "You are Glamoured", check: { kind: "featureEffect", featureId: NIGHTS_GLAMOUR } };

/** Sparing Touch: "clear 2 Hit Points or 2 Stress from them" (CB p.44). */
const TWO_HP_OR_STRESS: Step = {
  kind: "choose",
  id: "clear",
  label: "Clear 2 Hit Points or 2 Stress",
  options: [
    { id: "hp", label: "2 Hit Points", steps: [{ kind: "clear", to: "targets", track: "hp", amount: n(2) }] },
    { id: "stress", label: "2 Stress", steps: [{ kind: "clear", to: "targets", track: "stress", amount: n(2) }] },
  ],
};

/** Prayer Dice: "You can spend any number of Prayer Dice" (CB p.44): the count the player picks, paid from the held Prayer Dice. */
const PRAYER_CHOICE = { id: "dice", label: "Prayer Dice to spend", min: 1 } as const;
const PRAYER_COST = { kind: "tokens", amount: { kind: "chosen", choice: "dice" }, pool: "prayer" } as const;
const PRAYER_VALUE: NumberSource = { kind: "spent", resource: "heldDie" };

export const SERAPH_WITCH_EFFECTS: readonly FeatureEffect[] = [
  // ================================================================ Seraph (CB p.44-45)

  // Life Support (Seraph's Hope feature, CB p.44): "Spend 3 Hope to clear a Hit Point on an ally within Close range."
  // D5's `lifeSupport` keeps no state, so the map clears the ally token's Hit Point directly (SD3: the character's sheet).
  {
    featureId: "hope:seraph",
    source: "hope",
    owner: "seraph",
    uses: [
      {
        id: "main",
        name: "Life Support",
        activation: { kind: "action" },
        costs: [{ kind: "hope", amount: n(3) }],
        targets: { side: "ally", range: "close", count: { kind: "one" }, excludeSelf: true },
        steps: [{ kind: "clear", to: "targets", track: "hp", amount: n(1) }],
      },
    ],
  },

  // Prayer Dice (class feature, CB p.44): "At the beginning of each session, roll a number of d4s equal to your
  // subclass's Spellcast trait and place them on your character sheet in the space provided. These are your Prayer Dice.
  // You can spend any number of Prayer Dice to aid yourself or an ally within Far range. You can use a spent die's value
  // to reduce incoming damage, add to a roll's result after the roll is made, or gain Hope equal to the result. At the
  // end of each session, clear all unspent Prayer Dice."
  // D5 rolls and clears the dice (seraph.ts `onSessionStart`, session end); here they are spent (NV1 pool `prayer`, the
  // stored values counted as is). Incoming damage is the reaction window's (CB p.107 "Incoming damage"); a roll's result
  // after the roll is the after-roll step (CB p.107 "Using features after a roll", Q1).
  {
    featureId: "class:seraph:prayer-dice",
    source: "class",
    owner: "seraph",
    uses: [
      {
        id: "damage",
        name: "Prayer Dice: reduce incoming damage",
        activation: { kind: "reaction", trigger: { kind: "whenAllyWouldTakeDamage", range: "far", includeSelf: true } },
        choices: [PRAYER_CHOICE],
        costs: [PRAYER_COST],
        targets: { side: "trigger", who: "subject" },
        steps: [{ kind: "reduceDamage", to: "triggerSubject", amount: PRAYER_VALUE, note: "Reduce incoming damage by the spent dice's value." }],
      },
      {
        id: "roll",
        name: "Prayer Dice: add to a roll",
        activation: { kind: "reaction", trigger: { kind: "afterAllyRolls", range: "far", result: "any", includeSelf: true } },
        choices: [PRAYER_CHOICE],
        costs: [PRAYER_COST],
        targets: { side: "trigger", who: "subject" },
        steps: [{ kind: "modifyRoll", to: "triggerSubject", change: { kind: "add", amount: PRAYER_VALUE }, note: "Add the spent dice's value to the roll's result." }],
      },
      {
        id: "hope",
        name: "Prayer Dice: gain Hope",
        activation: { kind: "action" },
        choices: [PRAYER_CHOICE],
        costs: [PRAYER_COST],
        targets: SELF_OR_ALLY_FAR,
        steps: [{ kind: "hope", to: "targets", change: "gain", amount: PRAYER_VALUE }],
      },
    ],
  },

  // Spirit Weapon (Divine Wielder foundation, CB p.44): "When you have an equipped weapon with a range of Melee or Very
  // Close, it can fly from your hand to attack an adversary within Close range and then return to you. You can mark a
  // Stress to target an additional adversary within range with the same attack roll."
  {
    featureId: "subclass:divine-wielder:spirit-weapon",
    source: "subclass",
    owner: "divine-wielder",
    card: "foundation",
    uses: [
      {
        id: "reach",
        name: "Spirit Weapon",
        activation: { kind: "passive" },
        mods: [{ kind: "set", stat: "meleeWeaponRange", to: n(2) }],
        steps: [],
      },
      {
        id: "extra-target",
        name: "Spirit Weapon: an additional adversary",
        activation: { kind: "rider", trigger: { kind: "beforeYouRoll", roll: "weaponAttack" } },
        requires: [{ kind: "situation", text: "You attack with your Spirit Weapon (an equipped weapon with a range of Melee or Very Close)" }],
        costs: [{ kind: "stress", amount: n(1) }],
        steps: [{ kind: "addTargets", to: "self", count: n(1), targets: { side: "enemy", range: "close", count: { kind: "one" } }, damage: "same" }],
      },
    ],
  },

  // Sparing Touch (Divine Wielder foundation, CB p.44): "Once per long rest, touch a creature and clear 2 Hit Points or 2
  // Stress from them." Devout (CB p.44): "you can use your 'Sparing Touch' feature twice instead of once per long rest."
  {
    featureId: "subclass:divine-wielder:sparing-touch",
    source: "subclass",
    owner: "divine-wielder",
    card: "foundation",
    uses: [
      {
        id: "main",
        name: "Sparing Touch",
        activation: { kind: "action" },
        limit: { per: "longRest" },
        targets: { side: "any", range: "melee", count: { kind: "one" } },
        steps: [TWO_HP_OR_STRESS],
      },
    ],
    upgrades: [{ when: { kind: "feature", featureId: "subclass:divine-wielder:devout" }, useId: "main", patch: { limitTimes: 2 }, note: "Devout" }],
  },

  // Devout (Divine Wielder specialization, CB p.44): "When you roll your Prayer Dice, you can roll an additional die and
  // discard the lowest result. Additionally, you can use your 'Sparing Touch' feature twice instead of once per long
  // rest." Sparing Touch's second use is the upgrade on its entry; the extra Prayer Die is D5's session-start roll
  // (seraph.ts `rollPrayerDice`, tracer SD8). Nothing to apply here.
  {
    featureId: "subclass:divine-wielder:devout",
    source: "subclass",
    owner: "divine-wielder",
    card: "specialization",
    uses: [{ id: "main", name: "Devout", activation: { kind: "passive" }, mods: [], steps: [] }],
  },

  // Sacred Resonance (Divine Wielder mastery, CB p.44): "When you roll damage for your 'Spirit Weapon' feature, if any of
  // the die results match, double the value of each matching die. For example, if you roll two 5s, they count as two
  // 10s." Which attacks are Spirit Weapon attacks is open (task doc, question 1); until it is answered the player
  // confirms it on the attack (Q13).
  {
    featureId: "subclass:divine-wielder:sacred-resonance",
    source: "subclass",
    owner: "divine-wielder",
    card: "mastery",
    uses: [
      {
        id: "main",
        name: "Sacred Resonance",
        activation: { kind: "rider", trigger: { kind: "whenYouAttack", result: "success", weapon: true } },
        requires: [{ kind: "situation", text: "You roll damage for your Spirit Weapon" }],
        steps: [{ kind: "modifyDamage", to: "targets", change: { kind: "doubleDice", which: "matching" } }],
      },
    ],
  },

  // Wings of Light (Winged Sentinel foundation, CB p.45): "You can fly. While flying, you can do the following: • Mark a
  // Stress to pick up and carry another willing creature approximately your size or smaller. • Spend a Hope to deal an
  // extra 1d8 damage on a successful attack." Flying is the drawer's toggle (Q16). Power of the Gods (CB p.45): "While
  // flying, you deal an extra 1d12 damage instead of 1d8 from your 'Wings of Light' feature."
  {
    featureId: "subclass:winged-sentinel:wings-of-light",
    source: "subclass",
    owner: "winged-sentinel",
    card: "foundation",
    uses: [
      {
        id: "carry",
        name: "Wings of Light: carry a creature",
        activation: { kind: "action" },
        requires: [WHILE_FLYING, { kind: "situation", text: "The creature is approximately your size or smaller" }],
        costs: [{ kind: "stress", amount: n(1) }],
        targets: { side: "ally", range: "melee", count: { kind: "one" }, willing: true, excludeSelf: true },
        steps: [{ kind: "manual", to: "targets", text: "You pick up and carry this willing creature as you fly (move their token with yours)." }],
      },
      {
        id: "strike",
        name: "Wings of Light: extra damage",
        activation: { kind: "rider", trigger: { kind: "whenYouAttack", result: "success" } },
        requires: [WHILE_FLYING],
        costs: [{ kind: "hope", amount: n(1) }],
        steps: [{ kind: "modifyDamage", to: "targets", change: { kind: "add", amount: { kind: "dice", dice: { count: n(1), sides: 8 } } } }],
      },
    ],
    upgrades: [{ when: { kind: "feature", featureId: "subclass:winged-sentinel:power-of-the-gods" }, useId: "strike", patch: { dieSides: 12 }, note: "Power of the Gods" }],
  },

  // Ethereal Visage (Winged Sentinel specialization, CB p.45): "Your supernatural visage strikes awe and fear. While
  // flying, you have advantage on Presence Rolls. When you succeed with Hope on a Presence Roll, you can remove a Fear
  // from the GM's Fear pool instead of gaining Hope." The second sentence is not limited to flying.
  {
    featureId: "subclass:winged-sentinel:ethereal-visage",
    source: "subclass",
    owner: "winged-sentinel",
    card: "specialization",
    uses: [
      {
        id: "presence",
        name: "Ethereal Visage",
        activation: { kind: "passive" },
        requires: [WHILE_FLYING],
        mods: [{ kind: "advantage", on: "presence" }],
        steps: [],
      },
      {
        id: "fear",
        name: "Ethereal Visage: remove a Fear",
        activation: { kind: "reaction", trigger: { kind: "afterYouRoll", roll: "presence", result: "withHope" } },
        steps: [{ kind: "replaceHopeGain", to: "self", with: "removeFear", note: "Only on a success with Hope (a critical counts, CB p.90)." }],
      },
    ],
  },

  // Ascendant (Winged Sentinel mastery, CB p.45): "Gain a permanent +4 bonus to your Severe damage threshold."
  {
    featureId: "subclass:winged-sentinel:ascendant",
    source: "subclass",
    owner: "winged-sentinel",
    card: "mastery",
    uses: [{ id: "main", name: "Ascendant", activation: { kind: "passive" }, mods: [{ kind: "stat", stat: "severeThreshold", delta: n(4) }], steps: [] }],
  },

  // Power of the Gods (Winged Sentinel mastery, CB p.45): "While flying, you deal an extra 1d12 damage instead of 1d8 from
  // your 'Wings of Light' feature." The upgrade on Wings of Light's `strike` (which already needs flying).
  {
    featureId: "subclass:winged-sentinel:power-of-the-gods",
    source: "subclass",
    owner: "winged-sentinel",
    card: "mastery",
    uses: [{ id: "main", name: "Power of the Gods", activation: { kind: "passive" }, mods: [], steps: [] }],
  },

  // ================================================================ Witch (HF p.16-17)

  // Witch's Charm (Witch's Hope feature, HF p.16): "When you or an ally within Far range fails an action roll, you can
  // spend 3 Hope to change it into a success with Fear instead." The after-roll step (Q1) for your own roll, the
  // after-roll window for an ally's. A failure with Hope becomes a success with Fear, so the roll's Hope is taken back and
  // the GM gains a Fear (as D5's `witchsCharm`), when the server folds the outcome in.
  {
    featureId: "hope:witch",
    source: "hope",
    owner: "witch",
    uses: [
      {
        id: "main",
        name: "Witch’s Charm",
        activation: { kind: "reaction", trigger: { kind: "afterAllyRolls", range: "far", result: "failure", includeSelf: true } },
        costs: [{ kind: "hope", amount: n(3) }],
        targets: { side: "trigger", who: "subject" },
        steps: [{ kind: "modifyRoll", to: "triggerSubject", change: { kind: "setOutcome", outcome: "successWithFear" } }],
      },
    ],
  },

  // Hex (class feature, HF p.16): "Mark a Stress to temporarily Hex a target within Far range. While Hexed, the target
  // gains a penalty to their damage rolls and Difficulty equal to your tier. The maximum number of creatures you can Hex
  // at one time is equal to your Spellcast trait."
  // D5's `hex` keeps the Hexed list (`classState.hexes`, cleared at rest and session end) that Vexing Malison and Ire of
  // Pale Light read (NV9 `hexed`); D5 refuses a Hex past the maximum (task doc, question 2).
  {
    featureId: "class:witch:hex",
    source: "class",
    owner: "witch",
    uses: [
      {
        id: "main",
        name: "Hex",
        activation: { kind: "action" },
        costs: [{ kind: "stress", amount: n(1) }],
        targets: { side: "enemy", range: "far", count: { kind: "one" } },
        holdLimit: { kind: "spellcast" },
        steps: [
          { kind: "delegate", to: "targets", feature: "hex" },
          { kind: "condition", to: "targets", condition: HEXED, duration: "temporary" },
          {
            kind: "effect",
            to: "targets",
            label: "Hexed",
            mods: [
              { kind: "stat", stat: "difficulty", delta: MINUS_TIER },
              { kind: "stat", stat: "damage", delta: MINUS_TIER },
            ],
            duration: "temporary",
          },
        ],
      },
    ],
  },

  // Herbal Remedies (Hedge foundation, HF p.16): "When you or an ally in the scene clears 1 or more Hit Points or Stress as
  // the result of using a consumable, increase the number cleared by 1." Consumables are used on the sheet, not the map.
  {
    featureId: "subclass:hedge:herbal-remedies",
    source: "subclass",
    owner: "hedge",
    card: "foundation",
    uses: [{ id: "main", name: "Herbal Remedies", activation: { kind: "passive" }, mods: [{ kind: "stat", stat: "consumableClear", delta: n(1) }], steps: [] }],
  },

  // Enchanted Talisman (Hedge foundation, HF p.16): "Once per rest, you can imbue a small item with your protective
  // essence. Spend any number of Hope to place an equal number of tokens on this card. When the person holding the
  // talisman takes damage, spend a token to reduce the number of Hit Points they mark by one. Clear all tokens from this
  // card when you take a rest."
  {
    featureId: "subclass:hedge:enchanted-talisman",
    source: "subclass",
    owner: "hedge",
    card: "foundation",
    uses: [
      {
        id: "imbue",
        name: "Enchanted Talisman",
        activation: { kind: "action" },
        limit: { per: "rest" },
        choices: [{ id: "hope", label: "Hope to spend", min: 1 }],
        costs: [{ kind: "hope", amount: { kind: "chosen", choice: "hope" } }],
        targets: { side: "selfOrAlly", range: "melee", count: { kind: "one" } },
        steps: [
          { kind: "tokens", to: "self", op: "set", amount: { kind: "spent", resource: "hope" } },
          { kind: "condition", to: "targets", condition: TALISMAN_HOLDER, duration: "rest", note: "Holds the talisman." },
        ],
      },
      {
        id: "protect",
        name: "Enchanted Talisman: fewer Hit Points",
        activation: { kind: "reaction", trigger: { kind: "whenAllyWouldTakeDamage", range: "veryFar", includeSelf: true } },
        requires: [{ kind: "situation", text: "The creature taking damage holds your talisman", check: { kind: "hasCondition", condition: TALISMAN_HOLDER, who: "subject" } }],
        costs: [{ kind: "tokens", amount: n(1) }],
        targets: { side: "trigger", who: "subject" },
        steps: [{ kind: "adjustHpMarked", to: "triggerSubject", change: "fewer", amount: n(1) }],
      },
      {
        id: "rest",
        name: "Enchanted Talisman: clear tokens",
        activation: { kind: "auto", trigger: { kind: "timing", at: "afterRest" } },
        steps: [{ kind: "tokens", to: "self", op: "clear" }],
      },
    ],
  },

  // Vexing Malison (Hedge specialization, HF p.16): "You have advantage on attacks against Hexed creatures."
  {
    featureId: "subclass:hedge:vexing-malison",
    source: "subclass",
    owner: "hedge",
    card: "specialization",
    uses: [
      {
        id: "main",
        name: "Vexing Malison",
        activation: { kind: "passive" },
        mods: [{ kind: "advantage", on: "attack", versus: { creature: { kind: "hexed" }, on: "attacksAgainstThem" } }],
        steps: [],
      },
    ],
  },

  // Circle of Power (Hedge mastery, HF p.16): "Once per rest, mark a circle on the ground outlining a Very Close area
  // around you, and place a number of tokens equal to your Spellcast trait on this card. While within this circle, you
  // and your allies gain a +2 bonus to damage thresholds, attack rolls, and Evasion. Remove a token each time you or an
  // ally within the circle makes an action roll or evades an attack. This spell lasts until the last token is removed or
  // you exit the circle."
  // The circle is marked on the ground (it stays where it was drawn: "you exit the circle"), so its centre is the square
  // the witch stands on when she draws it (Q14 live members, SD-A). The token uses fire only for a roller or an evader
  // inside the circle: no state check reads the trigger subject's areas (`inArea` reads the actor's), so SD-A matches the
  // trigger to the area's members (bead, task doc). The end on the last token or on leaving the circle is SD-A's too.
  {
    featureId: "subclass:hedge:circle-of-power",
    source: "subclass",
    owner: "hedge",
    card: "mastery",
    uses: [
      {
        id: "main",
        name: "Circle of Power",
        activation: { kind: "action" },
        limit: { per: "rest" },
        targets: { side: "point", range: "melee", count: { kind: "one" } },
        steps: [
          { kind: "tokens", to: "self", op: "set", amount: { kind: "spellcast" } },
          {
            kind: "area",
            to: "self",
            area: {
              label: "Circle of Power",
              centre: "point",
              radius: "veryClose",
              side: "selfAndAllies",
              mods: [
                { kind: "stat", stat: "majorThreshold", delta: n(2) },
                { kind: "stat", stat: "severeThreshold", delta: n(2) },
                { kind: "stat", stat: "attack", delta: n(2) },
                { kind: "stat", stat: "evasion", delta: n(2) },
              ],
              duration: "manual",
            },
            note: "Lasts until the last token is removed or you exit the circle.",
          },
        ],
      },
      {
        id: "roll",
        name: "Circle of Power: a token per roll",
        activation: { kind: "auto", trigger: { kind: "afterAllyRolls", result: "any", includeSelf: true } },
        steps: [{ kind: "tokens", to: "self", op: "spend", amount: n(1) }],
      },
      {
        id: "evade",
        name: "Circle of Power: a token per evaded attack",
        activation: { kind: "auto", trigger: { kind: "whenCreatureAttacked", subject: "selfOrAlly", stage: "failed" } },
        steps: [{ kind: "tokens", to: "self", op: "spend", amount: n(1) }],
      },
    ],
  },

  // Night's Glamour (Moon foundation, HF p.17): "Make a Spellcast Roll (13) to Glamour yourself in a bewitching facade.
  // While Glamoured, you have advantage on rolls that leverage your illusory appearance. Additionally, adversaries within
  // Close range must mark a Stress to attack you. Unless you mark a Stress to maintain your Glamour, it drops when you
  // mark a Hit Point or deal damage."
  {
    featureId: NIGHTS_GLAMOUR,
    source: "subclass",
    owner: "moon",
    card: "foundation",
    uses: [
      {
        id: "main",
        name: "Night’s Glamour",
        activation: { kind: "action" },
        roll: { kind: "spellcast", difficulty: { kind: "fixed", value: 13 } },
        steps: [
          {
            kind: "effect",
            to: "self",
            when: ["success"],
            label: "Glamoured",
            mods: [{ kind: "flag", flag: "attackersMarkStress" }],
            duration: "manual",
            endsOn: ["markHp", "dealDamage"],
            endsWhen: "You mark a Hit Point or deal damage, unless you mark a Stress to maintain your Glamour",
          },
        ],
      },
      {
        id: "appearance",
        name: "Night’s Glamour: illusory appearance",
        activation: { kind: "passive" },
        requires: [GLAMOURED, { kind: "situation", text: "The roll leverages your illusory appearance" }],
        mods: [{ kind: "advantage", on: "action" }],
        steps: [],
      },
      {
        id: "maintain-hp",
        name: "Night’s Glamour: maintain (marking a Hit Point)",
        activation: { kind: "reaction", trigger: { kind: "whenYouMarkHp" } },
        requires: [GLAMOURED],
        costs: [{ kind: "stress", amount: n(1) }],
        steps: [{ kind: "manual", to: "self", text: "You mark a Stress to maintain your Glamour: it does not drop." }],
      },
      {
        id: "maintain-damage",
        name: "Night’s Glamour: maintain (dealing damage)",
        activation: { kind: "reaction", trigger: { kind: "whenYouDealDamage" } },
        requires: [GLAMOURED],
        costs: [{ kind: "stress", amount: n(1) }],
        steps: [{ kind: "manual", to: "self", text: "You mark a Stress to maintain your Glamour: it does not drop." }],
      },
    ],
  },

  // Moonbeam (Moon specialization, HF p.17): "Once per session, you can conjure a column of moonlight that illuminates the
  // area within Close range until the end of the scene. While bathed in this moonlight, you and your allies gain a +1
  // bonus to Spellcast Rolls and can see through illusions." Whether the column follows the witch is open (task doc,
  // question 3); the entry centres it on her.
  {
    featureId: "subclass:moon:moonbeam",
    source: "subclass",
    owner: "moon",
    card: "specialization",
    uses: [
      {
        id: "main",
        name: "Moonbeam",
        activation: { kind: "action" },
        limit: { per: "session" },
        steps: [
          {
            kind: "area",
            to: "self",
            area: { label: "Moonbeam", centre: "self", radius: "close", side: "selfAndAllies", mods: [{ kind: "stat", stat: "spellcast", delta: n(1) }], duration: "scene" },
            note: "Those bathed in the moonlight can see through illusions.",
          },
        ],
      },
    ],
  },

  // Ire of Pale Light (Moon specialization, HF p.17): "When a Hexed creature within Very Far range fails an attack, they
  // must mark a Stress."
  {
    featureId: "subclass:moon:ire-of-pale-light",
    source: "subclass",
    owner: "moon",
    card: "specialization",
    uses: [
      {
        id: "main",
        name: "Ire of Pale Light",
        activation: { kind: "auto", trigger: { kind: "whenEnemyFailsAttack", range: "veryFar", source: { kind: "hexed" } } },
        targets: { side: "trigger", who: "source" },
        steps: [{ kind: "markStress", to: "triggerSource", amount: n(1) }],
      },
    ],
  },

  // Lunar Phases (Moon mastery, HF p.17): "At the beginning of each session, roll a d6 and place it on this card. You gain
  // the matching effect until the end of session. 1 New: Spend a Hope to negate Minor damage. 2–3 Waxing: +2 to damage
  // rolls. 4 Full: +3 to damage thresholds. 5–6 Waning: +1 to Evasion. Once per rest, you can spend a Hope to increase the
  // value of this die by one. If you increase the value of a 6, it becomes a 1."
  // The moon die and the Waxing, Full and Waning numbers are the session features' (session-features/lunar.ts
  // `lunarBonuses`, read by derived.ts and hooks.ts), so `phases` adds no mods (no double count). The bump changes the
  // moon die, which no step reaches: a manual step (bead, task doc).
  {
    featureId: "subclass:moon:lunar-phases",
    source: "subclass",
    owner: "moon",
    card: "mastery",
    uses: [
      { id: "phases", name: "Lunar Phases", activation: { kind: "passive" }, mods: [], steps: [] },
      {
        id: "new",
        name: "Lunar Phases: New",
        activation: { kind: "reaction", trigger: { kind: "whenYouWouldTakeDamage", severity: "minor" } },
        requires: [{ kind: "situation", text: "Your moon die shows a 1 (New)" }],
        costs: [{ kind: "hope", amount: n(1) }],
        steps: [{ kind: "negate", to: "self", what: "damage" }],
      },
      {
        id: "bump",
        name: "Lunar Phases: turn the moon",
        activation: { kind: "action" },
        limit: { per: "rest" },
        costs: [{ kind: "hope", amount: n(1) }],
        steps: [{ kind: "manual", to: "self", text: "Increase the value of your moon die by one. If you increase the value of a 6, it becomes a 1." }],
      },
    ],
  },
];
