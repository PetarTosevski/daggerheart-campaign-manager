// Card effects of the Valor domain (plan combat-actions, tracer CE-valor; CA0 shipped it empty).
// Pure data: no framework imports, relative imports only (bundled into Convex).
//
// One entry per card classified combat or passive in ./classification.ts (all 21 Valor cards). Each entry quotes its
// card text (CB p.341-342, printed pages); what the vocabulary (src/lib/domain/card-effects/types.ts) cannot express is a
// `manual` step, never a vocabulary change. Readings and manual steps: docs/tasks/TASK-CA-CE-valor.md.

import type { CardEffect, NumberSource, Requirement } from "../../domain/card-effects/types";

const fixed = (value: number): NumberSource => ({ kind: "fixed", value });
const dice = (count: number, sides: 4 | 6 | 8 | 10 | 12 | 20): NumberSource => ({ kind: "dice", dice: { count: fixed(count), sides } });
const strength: NumberSource = { kind: "trait", trait: "strength" };
const situation = (text: string): Requirement => ({ kind: "situation", text });
const valorTouched: Requirement = { kind: "loadoutDomainCount", domain: "valor", min: 4 };
const GOADED = { kind: "tag", tag: "Goaded" } as const;
const LED_BY_EXAMPLE = { kind: "tag", tag: "Lead by Example" } as const;

function buildTable(): CardEffect[] {
  return [
    // Bare Bones (Valor 1, CB p.341): "When you choose not to equip armor, you have a base Armor Score of 3 + your Strength
    // and use the following as your base damage thresholds: • Tier 1: 9/19 • Tier 2: 11/24 • Tier 3: 13/31 • Tier 4: 15/38"
    {
      cardId: "bare-bones",
      uses: [
        {
          id: "main",
          name: "Bare Bones",
          activation: { kind: "passive" },
          requires: [{ kind: "armor", worn: false }],
          mods: [
            { kind: "set", stat: "armorScore", to: { kind: "sum", of: [fixed(3), strength] } },
            { kind: "set", stat: "majorThreshold", to: { kind: "byTier", values: [9, 11, 13, 15] } },
            { kind: "set", stat: "severeThreshold", to: { kind: "byTier", values: [19, 24, 31, 38] } },
          ],
          steps: [],
        },
      ],
    },

    // Forceful Push (Valor 1, CB p.341): "Make an attack with your primary weapon against a target within Melee range. On a
    // success, you deal damage and knock them back to Close range. On a success with Hope, add a d6 to your damage roll.
    // Additionally, you can spend a Hope to make them temporarily Vulnerable." The Hope for Vulnerable is offered on a hit.
    {
      cardId: "forceful-push",
      uses: [
        {
          id: "main",
          name: "Forceful Push",
          activation: { kind: "action" },
          roll: { kind: "attack", weapon: "primary", difficulty: { kind: "target" } },
          targets: { side: "enemy", range: "melee", count: { kind: "one" } },
          steps: [
            { kind: "damage", to: "targets", when: ["hit"], roll: { kind: "weapon", weapon: "primary" }, type: "weapon" },
            { kind: "modifyDamage", to: "targets", when: ["hit", "withHope"], change: { kind: "add", amount: dice(1, 6) }, note: "On a success with Hope, add a d6" },
            { kind: "move", to: "targets", when: ["hit"], mode: "knockBack", range: "close", relativeTo: "self", note: "Knock the target back to Close range" },
            {
              kind: "optional",
              id: "vulnerable",
              label: "Spend a Hope to make the target temporarily Vulnerable",
              when: ["hit"],
              costs: [{ kind: "hope", amount: fixed(1) }],
              steps: [{ kind: "condition", to: "targets", when: ["hit"], condition: { kind: "standard", condition: "vulnerable" }, duration: "temporary" }],
            },
          ],
        },
      ],
    },

    // I Am Your Shield (Valor 1, CB p.341): "When an ally within Very Close range would take damage, you can mark a Stress
    // to stand in the way and make yourself the target of the attack instead. When you take damage from this attack, you
    // can mark any number of Armor Slots." Offered to allies in the adversary-hit reaction window (Q13, AA1).
    {
      cardId: "i-am-your-shield",
      uses: [
        {
          id: "main",
          name: "I Am Your Shield",
          activation: { kind: "reaction", trigger: { kind: "whenAllyWouldTakeDamage", range: "veryClose" } },
          costs: [{ kind: "stress", amount: fixed(1) }],
          steps: [
            { kind: "redirectDamage", to: "triggerSubject", target: "self", note: "You become the target of the attack instead" },
            { kind: "extraArmorSlots", to: "self", max: "any", note: "Mark any number of Armor Slots against this damage" },
          ],
        },
      ],
    },

    // Body Basher (Valor 2, CB p.341): "You use the full force of your body in a fight. On a successful attack using a
    // weapon with a Melee range, gain a bonus to your damage roll equal to your Strength."
    {
      cardId: "body-basher",
      uses: [
        {
          id: "main",
          name: "Body Basher",
          activation: { kind: "auto", trigger: { kind: "whenYouAttack", result: "success", weapon: true, weaponRange: "melee" } },
          steps: [{ kind: "modifyDamage", to: "targets", change: { kind: "add", amount: strength }, note: "+Strength to the damage roll" }],
        },
      ],
    },

    // Bold Presence (Valor 2, CB p.341): "When you make a Presence Roll, you can spend a Hope to add your Strength to the
    // roll. Additionally, once per rest when you would gain a condition, you can describe how your bold presence aids you
    // in the situation and avoid gaining the condition."
    {
      cardId: "bold-presence",
      uses: [
        {
          id: "main",
          name: "Bold Presence",
          activation: { kind: "rider", trigger: { kind: "beforeYouRoll", roll: "presence" } },
          costs: [{ kind: "hope", amount: fixed(1) }],
          steps: [{ kind: "modifyRoll", to: "self", change: { kind: "add", amount: strength }, note: "+Strength to the Presence Roll" }],
        },
        {
          id: "condition",
          name: "Bold Presence (avoid a condition)",
          activation: { kind: "reaction", trigger: { kind: "wouldGainCondition" } },
          limit: { per: "rest" },
          steps: [{ kind: "negate", to: "self", what: "condition", note: "You avoid gaining the condition" }],
        },
      ],
    },

    // Critical Inspiration (Valor 3, CB p.341): "Once per rest, when you critically succeed on an attack, all allies within
    // Very Close range can clear a Stress or gain a Hope." FH-AP (user 2026-11-05): each ally picks their own option on
    // their own screen (`by`); the server names the allies (every PC within Very Close range) and the card waits for them.
    // CU2 (user 2026-11-06): each ally may also pick Neither, and the actor unticks allies before the picks go out.
    {
      cardId: "critical-inspiration",
      uses: [
        {
          id: "main",
          name: "Critical Inspiration",
          activation: { kind: "rider", trigger: { kind: "whenYouAttack", result: "critical" } },
          limit: { per: "rest" },
          steps: [
            {
              kind: "choose",
              id: "inspiration",
              label: "Clear a Stress or gain a Hope",
              by: { to: "allies", pick: { side: "ally", range: "veryClose", count: { kind: "all" }, area: "aroundSelf", excludeSelf: true } },
              options: [
                { id: "stress", label: "Clear a Stress", steps: [{ kind: "clear", to: "chooser", track: "stress", amount: fixed(1) }] },
                { id: "hope", label: "Gain a Hope", steps: [{ kind: "hope", to: "chooser", change: "gain", amount: fixed(1) }] },
                // CU2 (bead dcm-bxp.99.32.46, user 2026-11-06): "can" clear or gain, so each ally may take neither.
                { id: "neither", label: "Neither", steps: [] },
              ],
            },
          ],
        },
      ],
    },

    // Lean on Me (Valor 3, CB p.341): "Once per long rest, when you console or inspire an ally who failed an action roll,
    // you can both clear 2 Stress."
    {
      cardId: "lean-on-me",
      uses: [
        {
          id: "main",
          name: "Lean on Me",
          activation: { kind: "reaction", trigger: { kind: "afterAllyRolls", result: "failure" } },
          requires: [situation("You console or inspire the ally who failed")],
          limit: { per: "longRest" },
          steps: [
            { kind: "clear", to: "self", track: "stress", amount: fixed(2) },
            { kind: "clear", to: "triggerSubject", track: "stress", amount: fixed(2) },
          ],
        },
      ],
    },

    // Goad Them On (Valor 4, CB p.341): "Describe how you taunt a target within Close range, then make a Presence Roll
    // against them. On a success, the target must mark a Stress, and the next time the GM spotlights them, they must target
    // you with an attack, which they make with disadvantage."
    {
      cardId: "goad-them-on",
      uses: [
        {
          id: "main",
          name: "Goad Them On",
          activation: { kind: "action" },
          roll: { kind: "trait", trait: "presence", difficulty: { kind: "target" } },
          targets: { side: "enemy", range: "close", count: { kind: "one" } },
          steps: [
            { kind: "markStress", to: "targets", when: ["hit"], amount: fixed(1) },
            {
              kind: "condition",
              to: "targets",
              when: ["hit"],
              condition: GOADED,
              duration: "manual",
              endsWhen: "The next time the GM spotlights them, they must target you with an attack, made with disadvantage",
              // SRD-C2 (dcm-e75): the forced attack is `mustAttack` plus a `disadvantage` on its roll, and the condition ends
              // with that attack (`bearerAttacks`). The adversary engine reads them (lane E7).
              mods: [
                { kind: "mustAttack", target: "caster" },
                { kind: "disadvantage", on: "attack" },
              ],
              endsOn: ["bearerAttacks"],
              note: "The next time the GM spotlights this adversary, it must target you with an attack, which it makes with disadvantage.",
            },
          ],
        },
      ],
    },

    // Support Tank (Valor 4, CB p.342): "When an ally within Close range fails a roll, you can spend 2 Hope to allow them to
    // reroll either their Hope or Fear Die."
    {
      cardId: "support-tank",
      uses: [
        {
          id: "main",
          name: "Support Tank",
          activation: { kind: "reaction", trigger: { kind: "afterAllyRolls", range: "close", result: "failure" } },
          costs: [{ kind: "hope", amount: fixed(2) }],
          steps: [{ kind: "modifyRoll", to: "triggerSubject", change: { kind: "reroll", dice: "hopeOrFear" }, note: "The ally rerolls their Hope or Fear Die" }],
        },
      ],
    },

    // Armorer (Valor 5, CB p.342): "While you're wearing armor, gain a +1 bonus to your Armor Score. During a rest, when you
    // choose to repair your armor as a downtime move, your allies also clear an Armor Slot."
    {
      cardId: "armorer",
      uses: [
        {
          id: "main",
          name: "Armorer",
          activation: { kind: "passive" },
          requires: [{ kind: "armor", worn: true }],
          mods: [{ kind: "stat", stat: "armorScore", delta: fixed(1) }],
          steps: [],
        },
        {
          id: "repair",
          name: "Armorer (repair)",
          activation: { kind: "reaction", trigger: { kind: "timing", at: "afterRest" } },
          requires: [situation("You chose to repair your armor as a downtime move during this rest")],
          steps: [
            {
              kind: "clear",
              to: "allies",
              pick: { side: "ally", range: "unlimited", count: { kind: "all" }, excludeSelf: true },
              track: "armor",
              amount: fixed(1),
              note: "Your allies also clear an Armor Slot",
            },
          ],
        },
      ],
    },

    // Rousing Strike (Valor 5, CB p.342): "Once per rest, when you critically succeed on an attack, you and all allies who
    // can see or hear you can clear a Hit Point or 1d4 Stress." FH-AP (user 2026-11-05): you and each ally pick your own
    // option, each on their own screen (`by`; each rolls their own d4); the server names the allies (every PC on the map)
    // and the card waits for every pick. CU2 (user 2026-11-06): each chooser may also pick Neither, and the actor unticks
    // allies who can't see or hear them before the picks go out.
    {
      cardId: "rousing-strike",
      uses: [
        {
          id: "main",
          name: "Rousing Strike",
          activation: { kind: "rider", trigger: { kind: "whenYouAttack", result: "critical" } },
          limit: { per: "rest" },
          steps: [
            {
              kind: "choose",
              id: "rousing",
              label: "Clear a Hit Point or 1d4 Stress",
              by: { to: "selfAndAllies", pick: { side: "ally", range: "unlimited", count: { kind: "all" }, excludeSelf: true } },
              options: [
                { id: "hp", label: "Clear a Hit Point", steps: [{ kind: "clear", to: "chooser", track: "hp", amount: fixed(1) }] },
                { id: "stress", label: "Clear 1d4 Stress", steps: [{ kind: "clear", to: "chooser", track: "stress", amount: dice(1, 4) }] },
                // CU2 (bead dcm-bxp.99.32.46, user 2026-11-06): "can" clear, so each chooser may take neither.
                { id: "neither", label: "Neither", steps: [] },
              ],
            },
          ],
        },
      ],
    },

    // Inevitable (Valor 6, CB p.342): "When you fail an action roll, your next action roll has advantage."
    {
      cardId: "inevitable",
      uses: [
        {
          id: "main",
          name: "Inevitable",
          activation: { kind: "auto", trigger: { kind: "afterYouRoll", roll: "action", result: "failure" } },
          steps: [
            {
              kind: "effect",
              to: "self",
              label: "Inevitable: advantage on your next action roll",
              mods: [{ kind: "advantage", on: "action" }],
              duration: "nextRoll",
            },
          ],
        },
      ],
    },

    // Rise Up (Valor 6, CB p.342): "Gain a bonus to your Severe threshold equal to your Proficiency. When you mark 1 or more
    // Hit Points from an attack, clear a Stress."
    {
      cardId: "rise-up",
      uses: [
        {
          id: "main",
          name: "Rise Up",
          activation: { kind: "passive" },
          mods: [{ kind: "stat", stat: "severeThreshold", delta: { kind: "proficiency" } }],
          steps: [],
        },
        {
          id: "stress",
          name: "Rise Up (clear a Stress)",
          activation: { kind: "auto", trigger: { kind: "whenYouMarkHp", fromAttack: true } },
          steps: [{ kind: "clear", to: "self", track: "stress", amount: fixed(1) }],
        },
      ],
    },

    // Shrug It Off (Valor 7, CB p.342): "When you would take damage, you can mark a Stress to reduce the severity of the
    // damage by one threshold. When you do, roll a d6. On a result of 3 or lower, place this card in your vault."
    // Offered to the hit PC in the reaction window (Q13, AA1).
    {
      cardId: "shrug-it-off",
      uses: [
        {
          id: "main",
          name: "Shrug It Off",
          activation: { kind: "reaction", trigger: { kind: "whenYouWouldTakeDamage" } },
          costs: [{ kind: "stress", amount: fixed(1) }],
          steps: [
            { kind: "reduceSeverity", to: "self", steps: 1 },
            { kind: "check", dice: { count: fixed(1), sides: 6 }, test: { kind: "totalAtMost", value: 3 }, then: [{ kind: "toVault", to: "self" }], otherwise: [] },
          ],
        },
      ],
    },

    // Valor-Touched (Valor 7, CB p.342): "When 4 or more of the domain cards in your loadout are from the Valor domain, gain
    // the following benefits: • +1 bonus to your Armor Score • When you mark 1 or more Hit Points without marking an Armor
    // Slot, clear an Armor Slot."
    {
      cardId: "valor-touched",
      uses: [
        {
          id: "main",
          name: "Valor-Touched",
          activation: { kind: "passive" },
          requires: [valorTouched],
          mods: [{ kind: "stat", stat: "armorScore", delta: fixed(1) }],
          steps: [],
        },
        {
          id: "armor",
          name: "Valor-Touched (clear an Armor Slot)",
          activation: { kind: "auto", trigger: { kind: "whenYouMarkHp", withoutArmor: true } },
          requires: [valorTouched],
          steps: [{ kind: "clear", to: "self", track: "armor", amount: fixed(1) }],
        },
      ],
    },

    // Full Surge (Valor 8, CB p.342): "Once per long rest, mark 3 Stress to push your body to its limits. Gain a +2 bonus to
    // all of your character traits until your next rest."
    {
      cardId: "full-surge",
      uses: [
        {
          id: "main",
          name: "Full Surge",
          activation: { kind: "action" },
          limit: { per: "longRest" },
          costs: [{ kind: "stress", amount: fixed(3) }],
          steps: [{ kind: "effect", to: "self", label: "Full Surge: +2 to all traits", mods: [{ kind: "trait", trait: "all", delta: fixed(2) }], duration: "rest" }],
        },
      ],
    },

    // Ground Pound (Valor 8, CB p.342): "Spend 2 Hope to strike the ground where you stand and make a Strength Roll against
    // all targets within Very Close range. Targets you succeed against are thrown back to Far range and must make a Reaction
    // Roll (17). Targets who fail take 4d10+8 damage. Targets who succeed take half damage." The card names no damage type:
    // physical (a strike with your body). The damage is rolled once (R9, CB p.104).
    {
      cardId: "ground-pound",
      uses: [
        {
          id: "main",
          name: "Ground Pound",
          activation: { kind: "action" },
          costs: [{ kind: "hope", amount: fixed(2) }],
          roll: { kind: "trait", trait: "strength", difficulty: { kind: "target" } },
          targets: { side: "enemy", range: "veryClose", count: { kind: "all" }, area: "aroundSelf" },
          steps: [
            { kind: "move", to: "targets", when: ["hit"], mode: "knockBack", range: "far", relativeTo: "self", note: "Targets you succeed against are thrown back to Far range" },
            {
              kind: "save",
              to: "targets",
              when: ["hit"],
              difficulty: { kind: "fixed", value: 17 },
              onFail: [{ kind: "damage", to: "targets", roll: { kind: "dice", dice: { count: fixed(4), sides: 10, plus: fixed(8) } }, type: "physical" }],
              onSuccess: [{ kind: "damage", to: "targets", roll: { kind: "dice", dice: { count: fixed(4), sides: 10, plus: fixed(8) } }, type: "physical", scale: "half" }],
            },
          ],
        },
      ],
    },

    // Hold the Line (Valor 9, CB p.342): "Describe the defensive stance you take and spend a Hope. If an adversary moves
    // within Very Close range, they're pulled into Melee range and Restrained. This condition lasts until you move or fail a
    // roll with Fear, or the GM spends 2 Fear on their turn to clear it." Two uses: the stance (a sheet effect) and, while
    // it holds, the pull for an adversary that moved in. Lanes-2 S1.4 (dcm-trib, dcm-g90o): the pull is `auto` on
    // `whenEnemyEntersRange`: the server runs it when an adversary's move ends within Very Close of you
    // (convex/combatAreas.ts `rangeTriggersAfterMove`), pulls it into Melee and Restrains it.
    {
      cardId: "hold-the-line",
      uses: [
        {
          id: "main",
          name: "Hold the Line",
          activation: { kind: "action" },
          costs: [{ kind: "hope", amount: fixed(1) }],
          steps: [
            {
              kind: "effect",
              to: "self",
              label: "Hold the Line",
              mods: [],
              duration: "manual",
              endsWhen: "Until you move or fail a roll with Fear",
              endsOn: ["moves", "failWithFear"],
            },
          ],
        },
        {
          id: "pull",
          name: "Hold the Line (adversary moves in)",
          activation: { kind: "auto", trigger: { kind: "whenEnemyEntersRange", range: "veryClose" } },
          requires: [{ kind: "effectActive", cardId: "hold-the-line" }],
          steps: [
            { kind: "move", to: "triggerSource", mode: "intoMelee", range: "melee", relativeTo: "self", note: "Pulled into Melee range" },
            {
              kind: "condition",
              to: "triggerSource",
              condition: { kind: "standard", condition: "restrained" },
              duration: "manual",
              endsWhen: "Until you move or fail a roll with Fear, or the GM spends 2 Fear on their turn to clear it",
              // SRD-C2 (dcm-bpr): the caster's move or failure with Fear ends it; the GM's Fear spend is `gmSpendsFear` (its
              // amount, 2, stays in `endsWhen`: EndEvent carries no amount).
              endsOn: ["gmSpendsFear"],
              endsOnCaster: ["moves", "failWithFear"],
            },
          ],
        },
      ],
    },

    // Lead by Example (Valor 9, CB p.342): "When you deal damage to an adversary, you can mark a Stress and describe how you
    // encourage your allies. The next PC to make an attack against that adversary can clear a Stress or gain a Hope."
    // User answer 2026-10-31 (dcm-903q): other PCs only; the caster's own next attack doesn't count (`attackedRider` with
    // `by: "others"` and `attackerSteps`). Lanes-2 S1.4 (dcm-kso9, dcm-903q): the PC attack path reads the tag's
    // `attackedRider` (E1.4b): another PC's next attack on the adversary (not yours: the tag's marker records you as its
    // caster, E1.4a) offers the pick in the Attack bar before the roll, and that attack uses it up, hit or miss (user
    // answer 2026-11-01).
    {
      cardId: "lead-by-example",
      uses: [
        {
          id: "main",
          name: "Lead by Example",
          activation: { kind: "reaction", trigger: { kind: "whenYouDealDamage", toEnemy: true } },
          costs: [{ kind: "stress", amount: fixed(1) }],
          targets: { side: "trigger", who: "subject" },
          steps: [
            {
              kind: "condition",
              to: "targets",
              condition: LED_BY_EXAMPLE,
              duration: "manual",
              endsWhen: "The next other PC (not you) to make an attack against this adversary can clear a Stress or gain a Hope",
              mods: [
                {
                  kind: "attackedRider",
                  rider: {
                    by: "others",
                    attackerSteps: [
                      {
                        kind: "choose",
                        id: "benefit",
                        label: "Lead by Example: clear a Stress or gain a Hope",
                        options: [
                          { id: "stress", label: "Clear a Stress", steps: [{ kind: "clear", to: "self", track: "stress", amount: fixed(1) }] },
                          { id: "hope", label: "Gain a Hope", steps: [{ kind: "hope", to: "self", change: "gain", amount: fixed(1) }] },
                        ],
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    },

    // Unbreakable (Valor 10, CB p.342): "When you mark your last Hit Point, instead of making a death move, you can roll a d6
    // and clear a number of Hit Points equal to the result. Then place this card in your vault."
    {
      cardId: "unbreakable",
      uses: [
        {
          id: "main",
          name: "Unbreakable",
          activation: { kind: "reaction", trigger: { kind: "whenYouMarkHp", last: true } },
          steps: [
            { kind: "negate", to: "self", what: "deathMove", note: "Instead of making a death move" },
            { kind: "clear", to: "self", track: "hp", amount: dice(1, 6) },
            { kind: "toVault", to: "self" },
          ],
        },
      ],
    },

    // Unyielding Armor (Valor 10, CB p.342): "When you would mark an Armor Slot, roll a number of d6s equal to your
    // Proficiency. If any roll a 6, reduce the severity by one threshold without marking an Armor Slot." A reaction so the
    // hit PC can play it in the reaction window (Q13, AA1) before the armor answer (`stage: "would"`: offered while they
    // can still mark a slot). SRD-C2 (dcm-98d): on a 6 the reduction stands for the hit's Armor Slot
    // (`insteadOfArmorSlot`: no slot is marked and the armor answer is in); otherwise they mark it as usual.
    {
      cardId: "unyielding-armor",
      uses: [
        {
          id: "main",
          name: "Unyielding Armor",
          activation: { kind: "reaction", trigger: { kind: "whenArmorSlotMarked", who: "self", stage: "would" } },
          steps: [
            {
              kind: "check",
              dice: { count: { kind: "proficiency" }, sides: 6 },
              test: { kind: "anyAtLeast", value: 6 },
              then: [{ kind: "reduceSeverity", to: "self", steps: 1, insteadOfArmorSlot: true, note: "A 6: the severity drops by one threshold without marking an Armor Slot" }],
              otherwise: [],
            },
          ],
        },
      ],
    },
  ];
}

let table: readonly CardEffect[] | undefined;

/** The table, built on its first read (dcm-uh6r): loading this module evaluates none of its entries. */
export function valorEffects(): readonly CardEffect[] {
  table ??= buildTable();
  return table;
}

/** The table itself (tests); bundles that only call `valorEffects` drop it. */
export const VALOR_EFFECTS: readonly CardEffect[] = /* @__PURE__ */ valorEffects();
