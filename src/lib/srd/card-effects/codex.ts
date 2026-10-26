// Card effects of the Codex domain (plan combat-actions, tracer CE-codex).
// Pure data: no framework imports, relative imports only (bundled into Convex).
//
// One entry per card classified combat or passive in ./classification.ts (20 cards; Safe Haven is out of combat).
// Grimoires hold several spells: each spell is its own `CardUse` (id = the spell's slug). A spell with two parts the
// engine starts separately (Ice Spike as a weapon or not, a construct's attack, Sigil of Retribution's dice) has one
// use per part. Each entry quotes its card text (CB = Core Book, printed pages). What the vocabulary
// (src/lib/domain/card-effects/types.ts) cannot express is a `manual` step with the card's words; every one is listed
// with its reason in docs/tasks/TASK-CA-CE-codex.md.
//
// Readings used throughout (book pages are printed pages):
// - "Make a Spellcast Roll against a target" rolls against the target's Difficulty; "Spellcast Roll (14)" is a fixed
//   Difficulty (CB p.96: "Spellcast Rolls can have a set Difficulty, such as 'Spellcast Roll (14).'"). A roll with
//   neither gets `difficulty: gm`: the GM sets it (CB p.92, Step 1: the GM "sets a Difficulty for the roll").
// - "On a success" against a target = the `hit` gate; against a fixed Difficulty = `success`.
// - "temporarily" = duration `temporary` (CB p.102); card-specific conditions (Asleep, Banished) are tags, "Special
//   conditions are cleared only when specific requirements are met … stated in the text" (CB p.102), so they use
//   duration `manual` with the card's words in `endsWhen`.
// - "Once per rest on a success" = limit `consumedOn: success` (Q4).

import type { CardEffect, NumberSource, RollSpec } from "../../domain/card-effects/types";

const fixed = (value: number): NumberSource => ({ kind: "fixed", value });
const prof: NumberSource = { kind: "proficiency" };
const vsTarget: RollSpec = { kind: "spellcast", difficulty: { kind: "target" } };
const vsFixed = (value: number): RollSpec => ({ kind: "spellcast", difficulty: { kind: "fixed", value } });
const vsGm: RollSpec = { kind: "spellcast", difficulty: { kind: "gm" } };

export const CODEX_EFFECTS: readonly CardEffect[] = [
  // Book of Ava (Level 1 grimoire, CB p.332)
  {
    cardId: "book-of-ava",
    uses: [
      // "Power Push: Make a Spellcast Roll against a target within Melee range. On a success, they're knocked back to
      // Far range and take d10+2 magic damage using your Proficiency."
      {
        id: "power-push",
        name: "Power Push",
        activation: { kind: "action" },
        roll: vsTarget,
        targets: { side: "enemy", range: "melee", count: { kind: "one" } },
        steps: [
          { kind: "move", to: "targets", when: ["hit"], mode: "knockBack", range: "far", relativeTo: "self" },
          { kind: "damage", to: "targets", when: ["hit"], roll: { kind: "dice", dice: { count: prof, sides: 10, plus: fixed(2) } }, type: "magic" },
        ],
      },
      // "Tava's Armor: Spend a Hope to give a target you can touch a +1 bonus to their Armor Score until their next rest
      // or you cast Tava's Armor again."
      {
        id: "tavas-armor",
        name: "Tava's Armor",
        activation: { kind: "action" },
        costs: [{ kind: "hope", amount: fixed(1) }],
        targets: { side: "selfOrAlly", range: "melee", count: { kind: "one" } },
        exclusive: true,
        steps: [
          {
            kind: "effect",
            to: "targets",
            label: "Tava's Armor",
            mods: [{ kind: "stat", stat: "armorScore", delta: fixed(1) }],
            duration: "rest",
            endsWhen: "their next rest, or you cast Tava's Armor again",
          },
        ],
      },
      // "Ice Spike: Make a Spellcast Roll (12) to summon a large ice spike within Far range. If you use it as a weapon,
      // make the Spellcast Roll against the target's Difficulty instead. On a success, deal d6 physical damage using
      // your Proficiency." As a weapon: this use. Summoned for anything else: `ice-spike-summon`.
      {
        id: "ice-spike",
        name: "Ice Spike",
        activation: { kind: "action" },
        roll: vsTarget,
        targets: { side: "enemy", range: "far", count: { kind: "one" } },
        steps: [{ kind: "damage", to: "targets", when: ["hit"], roll: { kind: "dice", dice: { count: prof, sides: 6 } }, type: "physical" }],
      },
      {
        id: "ice-spike-summon",
        name: "Ice Spike (not as a weapon)",
        activation: { kind: "action" },
        roll: vsFixed(12),
        targets: { side: "point", range: "far", count: { kind: "one" } },
        steps: [{ kind: "manual", to: "self", when: ["success"], text: "A large ice spike appears within Far range." }],
      },
    ],
  },

  // Book of Illiat (Level 1 grimoire, CB p.332)
  {
    cardId: "book-of-illiat",
    uses: [
      // "Slumber: Make a Spellcast Roll against a target within Very Close range. On a success, they're Asleep until they
      // take damage or the GM spends a Fear on their turn to clear this condition."
      {
        id: "slumber",
        name: "Slumber",
        activation: { kind: "action" },
        roll: vsTarget,
        targets: { side: "enemy", range: "veryClose", count: { kind: "one" } },
        steps: [
          {
            kind: "condition",
            to: "targets",
            when: ["hit"],
            condition: { kind: "tag", tag: "Asleep" },
            duration: "manual",
            endsWhen: "they take damage, or the GM spends a Fear on their turn to clear it",
          },
        ],
      },
      // "Arcane Barrage: Once per rest, spend any number of Hope and shoot magical projectiles that strike a target of
      // your choice within Close range. Roll a number of d6s equal to the Hope spent and deal that much magic damage to
      // the target."
      {
        id: "arcane-barrage",
        name: "Arcane Barrage",
        activation: { kind: "action" },
        limit: { per: "rest" },
        choices: [{ id: "hope", label: "Hope to spend", min: 1 }],
        costs: [{ kind: "hope", amount: { kind: "chosen", choice: "hope" } }],
        targets: { side: "enemy", range: "close", count: { kind: "one" } },
        steps: [{ kind: "damage", to: "targets", roll: { kind: "dice", dice: { count: { kind: "spent", resource: "hope" }, sides: 6 } }, type: "magic" }],
      },
      // "Telepathy: Spend a Hope to open a line of mental communication with one target you can see. This connection
      // lasts until your next rest or you cast Telepathy again."
      {
        id: "telepathy",
        name: "Telepathy",
        activation: { kind: "action" },
        costs: [{ kind: "hope", amount: fixed(1) }],
        targets: { side: "any", range: "unlimited", count: { kind: "one" }, sight: true },
        exclusive: true,
        steps: [
          {
            kind: "manual",
            to: "targets",
            text: "A line of mental communication is open with the target until your next rest or until you cast Telepathy again.",
          },
        ],
      },
    ],
  },

  // Book of Tyfar (Level 1 grimoire, CB p.332)
  {
    cardId: "book-of-tyfar",
    uses: [
      // "Wild Flame: Make a Spellcast Roll against up to three adversaries within Melee range. Targets you succeed
      // against take 2d6 magic damage and must mark a Stress as flames erupt from your hand."
      {
        id: "wild-flame",
        name: "Wild Flame",
        activation: { kind: "action" },
        roll: vsTarget,
        targets: { side: "enemy", range: "melee", count: { kind: "upTo", n: fixed(3) } },
        steps: [
          { kind: "damage", to: "targets", when: ["hit"], roll: { kind: "dice", dice: { count: fixed(2), sides: 6 } }, type: "magic" },
          { kind: "markStress", to: "targets", when: ["hit"], amount: fixed(1) },
        ],
      },
      // "Magic Hand: You conjure a magical hand with the same size and strength as your own within Far range."
      {
        id: "magic-hand",
        name: "Magic Hand",
        activation: { kind: "action" },
        steps: [{ kind: "manual", to: "self", text: "You conjure a magical hand with the same size and strength as your own within Far range." }],
      },
      // "Mysterious Mist: Make a Spellcast Roll (13) to cast a temporary thick fog that gathers in a stationary area
      // within Very Close range. The fog heavily obscures this area and everything in it."
      {
        id: "mysterious-mist",
        name: "Mysterious Mist",
        activation: { kind: "action" },
        roll: vsFixed(13),
        targets: { side: "point", range: "veryClose", count: { kind: "one" } },
        steps: [
          {
            kind: "manual",
            to: "self",
            when: ["success"],
            text: "A temporary thick fog gathers in a stationary area within Very Close range; it heavily obscures the area and everything in it.",
          },
        ],
      },
    ],
  },

  // Book of Sitil (Level 2 grimoire, CB p.332)
  {
    cardId: "book-of-sitil",
    uses: [
      // "Adjust Appearance: You magically shift your appearance and clothing to avoid recognition."
      {
        id: "adjust-appearance",
        name: "Adjust Appearance",
        activation: { kind: "action" },
        steps: [{ kind: "manual", to: "self", text: "You magically shift your appearance and clothing to avoid recognition." }],
      },
      // "Parallela: Spend 2 Hope to cast this spell on yourself or an ally within Close range. The next time the target
      // makes an attack, they can hit an additional target within range that their attack roll would succeed against.
      // You can only hold this spell on one creature at a time."
      {
        id: "parallela",
        name: "Parallela",
        activation: { kind: "action" },
        costs: [{ kind: "hope", amount: fixed(2) }],
        targets: { side: "selfOrAlly", range: "close", count: { kind: "one" } },
        exclusive: true,
        steps: [
          { kind: "effect", to: "targets", label: "Parallela", mods: [], duration: "manual", endsWhen: "the bearer's next attack" },
          {
            kind: "manual",
            to: "targets",
            text: "The next time the target makes an attack, they can hit an additional target within range that their attack roll would succeed against.",
          },
        ],
      },
      // "Illusion: Make a Spellcast Roll (14). On a success, create a temporary visual illusion no larger than you within
      // Close range that lasts for as long as you look at it. It holds up to scrutiny until an observer is within Melee range."
      {
        id: "illusion",
        name: "Illusion",
        activation: { kind: "action" },
        roll: vsFixed(14),
        steps: [
          {
            kind: "manual",
            to: "self",
            when: ["success"],
            text: "A temporary visual illusion no larger than you appears within Close range for as long as you look at it; it holds up to scrutiny until an observer is within Melee range.",
          },
        ],
      },
    ],
  },

  // Book of Vagras (Level 2 grimoire, CB p.332)
  {
    cardId: "book-of-vagras",
    uses: [
      // "Runic Lock: Make a Spellcast Roll (15) on an object you're touching that can close (such as a lock, chest, or
      // box). Once per rest on a success, you can lock the object so it can only be opened by creatures of your choice.
      // Someone with access to magic and an hour of time to study the spell can break it."
      {
        id: "runic-lock",
        name: "Runic Lock",
        activation: { kind: "action" },
        limit: { per: "rest", consumedOn: "success" },
        roll: vsFixed(15),
        targets: { side: "object", range: "melee", count: { kind: "one" } },
        steps: [
          {
            kind: "manual",
            to: "self",
            when: ["success"],
            text: "The object is locked so it can only be opened by creatures of your choice (magic and an hour of study can break it).",
          },
        ],
      },
      // "Arcane Door: When you have no adversaries within Melee range, make a Spellcast Roll (13). On a success, spend a
      // Hope to create a portal from where you are to a point within Far range you can see. It closes once a creature
      // has passed through it."
      {
        id: "arcane-door",
        name: "Arcane Door",
        activation: { kind: "action" },
        requires: [{ kind: "noEnemyWithin", range: "melee" }],
        roll: vsFixed(13),
        targets: { side: "point", range: "far", count: { kind: "one" }, sight: true },
        steps: [
          { kind: "pay", when: ["success"], costs: [{ kind: "hope", amount: fixed(1) }] },
          {
            kind: "move",
            to: "self",
            when: ["success"],
            mode: "teleport",
            range: "far",
            relativeTo: "self",
            note: "Portal to the picked point; it closes once a creature has passed through it",
          },
        ],
      },
      // "Reveal: Make a Spellcast Roll. If there is anything magically hidden within Close range, it is revealed."
      {
        id: "reveal",
        name: "Reveal",
        activation: { kind: "action" },
        roll: vsGm,
        steps: [{ kind: "manual", to: "self", when: ["success"], text: "Anything magically hidden within Close range is revealed." }],
      },
    ],
  },

  // Book of Korvax (Level 3 grimoire, CB p.332)
  {
    cardId: "book-of-korvax",
    uses: [
      // "Levitation: Make a Spellcast Roll to temporarily lift a target you can see up into the air and move them within
      // Close range of their original position."
      {
        id: "levitation",
        name: "Levitation",
        activation: { kind: "action" },
        roll: vsGm,
        targets: { side: "any", range: "unlimited", count: { kind: "one" }, sight: true },
        steps: [
          { kind: "condition", to: "targets", when: ["success"], condition: { kind: "tag", tag: "Levitated" }, duration: "temporary" },
          { kind: "move", to: "targets", when: ["success"], mode: "move", range: "close", relativeTo: "target" },
        ],
      },
      // "Recant: Spend a Hope to force a target within Melee range to make a Reaction Roll (15). On a failure, they
      // forget the last minute of your conversation."
      {
        id: "recant",
        name: "Recant",
        activation: { kind: "action" },
        costs: [{ kind: "hope", amount: fixed(1) }],
        targets: { side: "any", range: "melee", count: { kind: "one" } },
        steps: [
          {
            kind: "save",
            to: "targets",
            difficulty: { kind: "fixed", value: 15 },
            onFail: [{ kind: "manual", to: "targets", text: "They forget the last minute of your conversation." }],
            onSuccess: [],
          },
        ],
      },
      // "Rune Circle: Mark a Stress to create a temporary magical circle on the ground where you stand. All adversaries
      // within Melee range, or who enter Melee range, take 2d12+4 magic damage and are knocked back to Very Close range."
      // Casting hits everyone in Melee now (this use); a later entrant is `rune-circle-enter`.
      {
        id: "rune-circle",
        name: "Rune Circle",
        activation: { kind: "action" },
        costs: [{ kind: "stress", amount: fixed(1) }],
        targets: { side: "enemy", range: "melee", count: { kind: "all" }, area: "aroundSelf" },
        steps: [
          { kind: "damage", to: "targets", roll: { kind: "dice", dice: { count: fixed(2), sides: 12, plus: fixed(4) } }, type: "magic" },
          { kind: "move", to: "targets", mode: "knockBack", range: "veryClose", relativeTo: "self" },
        ],
      },
      {
        id: "rune-circle-enter",
        name: "Rune Circle (an adversary enters)",
        activation: { kind: "action" },
        requires: [{ kind: "situation", text: "An adversary enters Melee range of your temporary Rune Circle" }],
        targets: { side: "enemy", range: "melee", count: { kind: "one" } },
        steps: [
          { kind: "damage", to: "targets", roll: { kind: "dice", dice: { count: fixed(2), sides: 12, plus: fixed(4) } }, type: "magic" },
          { kind: "move", to: "targets", mode: "knockBack", range: "veryClose", relativeTo: "self" },
        ],
      },
    ],
  },

  // Book of Norai (Level 3 grimoire, CB p.333)
  {
    cardId: "book-of-norai",
    uses: [
      // "Mystic Tether: Make a Spellcast Roll against a target within Far range. On a success, they're temporarily
      // Restrained and must mark a Stress. If you target a flying creature, this spell grounds and temporarily
      // Restrains them."
      {
        id: "mystic-tether",
        name: "Mystic Tether",
        activation: { kind: "action" },
        roll: vsTarget,
        targets: { side: "enemy", range: "far", count: { kind: "one" } },
        steps: [
          { kind: "condition", to: "targets", when: ["hit"], condition: { kind: "standard", condition: "restrained" }, duration: "temporary" },
          { kind: "markStress", to: "targets", when: ["hit"], amount: fixed(1) },
          { kind: "manual", to: "targets", when: ["hit"], text: "If the target was flying, it is grounded." },
        ],
      },
      // "Fireball: Make a Spellcast Roll against a target within Very Far range. On a success, hurl a sphere of fire
      // toward them that explodes on impact. The target and all creatures within Very Close range of them must make a
      // Reaction Roll (13). Targets who fail take d20+5 magic damage using your Proficiency. Targets who succeed take
      // half damage." The roll is against the target only; the others in the blast (`followUp`, allies too: "all
      // creatures") save on that success. The damage is rolled once (R9); half rounds up (CB p.107).
      {
        id: "fireball",
        name: "Fireball",
        activation: { kind: "action" },
        roll: vsTarget,
        targets: { side: "any", range: "veryFar", count: { kind: "one" } },
        steps: [
          {
            kind: "save",
            to: "targets",
            when: ["hit"],
            difficulty: { kind: "fixed", value: 13 },
            onFail: [{ kind: "damage", to: "targets", roll: { kind: "dice", dice: { count: prof, sides: 20, plus: fixed(5) } }, type: "magic" }],
            onSuccess: [{ kind: "damage", to: "targets", roll: { kind: "dice", dice: { count: prof, sides: 20, plus: fixed(5) } }, type: "magic", scale: "half" }],
          },
          {
            kind: "followUp",
            when: ["success"],
            targets: { side: "any", range: "veryFar", count: { kind: "all" }, area: "aroundTarget", areaRange: "veryClose" },
            steps: [
              {
                kind: "save",
                to: "targets",
                when: ["success"],
                difficulty: { kind: "fixed", value: 13 },
                onFail: [{ kind: "damage", to: "targets", roll: { kind: "dice", dice: { count: prof, sides: 20, plus: fixed(5) } }, type: "magic" }],
                onSuccess: [{ kind: "damage", to: "targets", roll: { kind: "dice", dice: { count: prof, sides: 20, plus: fixed(5) } }, type: "magic", scale: "half" }],
              },
            ],
          },
        ],
      },
    ],
  },

  // Book of Exota (Level 4 grimoire, CB p.333)
  {
    cardId: "book-of-exota",
    uses: [
      // "Repudiate: You can interrupt a magical effect taking place. Make a reaction roll using your Spellcast trait.
      // Once per rest on a success, the effect stops and any consequences are avoided."
      {
        id: "repudiate",
        name: "Repudiate",
        activation: { kind: "reaction", trigger: { kind: "magicalEffect" } },
        limit: { per: "rest", consumedOn: "success" },
        roll: { kind: "reaction", trait: "spellcast", difficulty: { kind: "gm" } },
        steps: [{ kind: "negate", to: "self", when: ["success"], what: "effect", note: "The effect stops and any consequences are avoided" }],
      },
      // "Create Construct: Spend a Hope to choose a group of objects around you and create an animated construct from
      // them that obeys basic commands. Make a Spellcast Roll to command them to take action. When necessary, they share
      // your Evasion and traits and their attacks deal 2d10+3 physical damage. You can only maintain one construct at a
      // time, and they fall apart when they take any amount of damage."
      {
        id: "create-construct",
        name: "Create Construct",
        activation: { kind: "action" },
        costs: [{ kind: "hope", amount: fixed(1) }],
        exclusive: true,
        steps: [
          { kind: "effect", to: "self", label: "Construct", mods: [], duration: "manual", endsWhen: "the construct takes any damage, or you create another" },
          {
            kind: "manual",
            to: "self",
            text: "An animated construct of nearby objects obeys basic commands; it shares your Evasion and traits and falls apart when it takes any damage.",
          },
        ],
      },
      // The construct attacks: the command roll against the target's Difficulty, 2d10+3 physical on a success.
      {
        id: "construct-attack",
        name: "Command Construct: Attack",
        activation: { kind: "action" },
        requires: [{ kind: "effectActive", cardId: "book-of-exota" }],
        roll: vsTarget,
        targets: { side: "enemy", range: "unlimited", count: { kind: "one" } },
        steps: [{ kind: "damage", to: "targets", when: ["hit"], roll: { kind: "dice", dice: { count: fixed(2), sides: 10, plus: fixed(3) } }, type: "physical" }],
      },
      // Any other command: a Spellcast Roll the GM sets.
      {
        id: "construct-command",
        name: "Command Construct",
        activation: { kind: "action" },
        requires: [{ kind: "effectActive", cardId: "book-of-exota" }],
        roll: vsGm,
        steps: [{ kind: "manual", to: "self", when: ["success"], text: "The construct carries out your command." }],
      },
    ],
  },

  // Book of Grynn (Level 4 grimoire, CB p.333)
  {
    cardId: "book-of-grynn",
    uses: [
      // "Arcane Deflection: Once per long rest, spend a Hope to negate the damage of an attack targeting you or an ally
      // within Very Close range."
      {
        id: "arcane-deflection",
        name: "Arcane Deflection",
        activation: { kind: "reaction", trigger: { kind: "whenAllyWouldTakeDamage", range: "veryClose", includeSelf: true } },
        limit: { per: "longRest" },
        costs: [{ kind: "hope", amount: fixed(1) }],
        steps: [{ kind: "negate", to: "triggerSubject", what: "damage" }],
      },
      // "Time Lock: Target an object within Far range. That object stops in time and space exactly where it is until your
      // next rest. If a creature tries to move it, make a Spellcast Roll against them to maintain this spell."
      {
        id: "time-lock",
        name: "Time Lock",
        activation: { kind: "action" },
        targets: { side: "object", range: "far", count: { kind: "one" } },
        steps: [{ kind: "manual", to: "self", text: "The object stops in time and space exactly where it is until your next rest." }],
      },
      {
        id: "time-lock-maintain",
        name: "Time Lock (maintain)",
        activation: { kind: "action" },
        requires: [{ kind: "situation", text: "A creature tries to move your time-locked object" }],
        roll: vsTarget,
        targets: { side: "any", range: "unlimited", count: { kind: "one" } },
        steps: [
          { kind: "manual", to: "targets", when: ["hit"], text: "Time Lock holds: the object doesn't move." },
          { kind: "manual", to: "targets", when: ["miss"], text: "Time Lock ends: the creature moves the object." },
        ],
      },
      // "Wall of Flame: Make a Spellcast Roll (15). On a success, create a temporary wall of magical flame between two
      // points within Far range. All creatures in its path must choose a side to be on, and anything that subsequently
      // passes through the wall takes 4d10+3 magic damage."
      {
        id: "wall-of-flame",
        name: "Wall of Flame",
        activation: { kind: "action" },
        roll: vsFixed(15),
        targets: { side: "point", range: "far", count: { kind: "upTo", n: fixed(2) } },
        steps: [
          {
            kind: "manual",
            to: "self",
            when: ["success"],
            text: "A temporary wall of magical flame stands between the two points; every creature in its path chooses a side to be on.",
          },
        ],
      },
      {
        id: "wall-of-flame-cross",
        name: "Wall of Flame (something passes through)",
        activation: { kind: "action" },
        requires: [{ kind: "situation", text: "A creature passes through your Wall of Flame" }],
        targets: { side: "any", range: "unlimited", count: { kind: "one" } },
        steps: [{ kind: "damage", to: "targets", roll: { kind: "dice", dice: { count: fixed(4), sides: 10, plus: fixed(3) } }, type: "magic" }],
      },
    ],
  },

  // Manifest Wall (Level 5 spell, CB p.333)
  // "Make a Spellcast Roll (15). Once per rest on a success, spend a Hope to create a temporary magical wall between two
  // points within Far range. It can be up to 50 feet high and form at any angle. Creatures or objects in its path are
  // shunted to a side of your choice. The wall stays up until your next rest or you cast Manifest Wall again."
  {
    cardId: "manifest-wall",
    uses: [
      {
        id: "main",
        name: "Manifest Wall",
        activation: { kind: "action" },
        limit: { per: "rest", consumedOn: "success" },
        roll: vsFixed(15),
        targets: { side: "point", range: "far", count: { kind: "upTo", n: fixed(2) } },
        exclusive: true,
        steps: [
          { kind: "pay", when: ["success"], costs: [{ kind: "hope", amount: fixed(1) }] },
          { kind: "effect", to: "self", when: ["success"], label: "Manifest Wall", mods: [], duration: "rest", endsWhen: "your next rest, or you cast Manifest Wall again" },
          {
            kind: "manual",
            to: "self",
            when: ["success"],
            text: "A magical wall up to 50 feet high stands between the two points at any angle; creatures and objects in its path are shunted to a side of your choice.",
          },
        ],
      },
    ],
  },

  // Teleport (Level 5 spell, CB p.333)
  // "Once per long rest, you can instantly teleport yourself and any number of willing targets within Close range to a
  // place you've been before. Choose one of the following options, then make a Spellcast Roll (16): • If you know the
  // place very well, gain a +3 bonus. • If you've visited the place frequently, gain a +1 bonus. • If you've visited the
  // place infrequently, gain no modifier. • If you've only been there once, gain a -2 penalty. On a success, you appear
  // where you were intending to go. On a failure, you appear off course, with the range of failure determining how far
  // off course."
  {
    cardId: "teleport",
    uses: [
      {
        id: "main",
        name: "Teleport",
        activation: { kind: "action" },
        limit: { per: "longRest" },
        choices: [{ id: "familiarity", label: "Very well +3, frequently +1, infrequently 0, only once −2", min: -2, max: fixed(3) }],
        roll: { kind: "spellcast", difficulty: { kind: "fixed", value: 16 }, modifier: { kind: "chosen", choice: "familiarity" } },
        targets: { side: "ally", range: "close", count: { kind: "any" }, willing: true },
        steps: [
          { kind: "move", to: "self", mode: "teleport", range: "veryFar", note: "Teleport to a place you've been before" },
          { kind: "move", to: "targets", mode: "teleport", range: "veryFar", note: "Teleport with you to a place you've been before" },
          { kind: "manual", to: "self", when: ["success"], text: "You appear where you intended to go." },
          { kind: "manual", to: "self", when: ["failure"], text: "You appear off course; the GM decides how far from how much the roll failed by." },
        ],
      },
    ],
  },

  // Banish (Level 6 spell, CB p.333)
  // "Make a Spellcast Roll against a target within Close range. On a success, roll a number of d20s equal to your
  // Spellcast trait. The target must make a reaction roll with a Difficulty equal to your highest result. On a success,
  // the target must mark a Stress but isn't banished. Once per rest on a failure, they are banished from this realm.
  // When the PCs roll with Fear, the Difficulty gains a -1 penalty and the target makes another reaction roll. On a
  // success, they return from banishment."
  {
    cardId: "banish",
    uses: [
      {
        id: "main",
        name: "Banish",
        activation: { kind: "action" },
        roll: vsTarget,
        targets: { side: "enemy", range: "close", count: { kind: "one" } },
        steps: [
          {
            kind: "save",
            to: "targets",
            when: ["hit"],
            difficulty: { kind: "number", value: { kind: "dice", dice: { count: { kind: "spellcast" }, sides: 20 }, keep: "highest" } },
            onSuccess: [{ kind: "markStress", to: "targets", amount: fixed(1) }],
            onFail: [
              {
                kind: "optional",
                id: "banish",
                label: "Banish them from this realm (once per rest)",
                limit: { per: "rest" },
                steps: [
                  {
                    kind: "condition",
                    to: "targets",
                    condition: { kind: "tag", tag: "Banished" },
                    duration: "manual",
                    endsWhen: "they succeed on the reaction roll made each time the PCs roll with Fear (the Difficulty drops by 1 each time)",
                  },
                  {
                    kind: "manual",
                    to: "targets",
                    text: "Each time the PCs roll with Fear, the Difficulty gains a −1 penalty and the target makes another reaction roll; on a success they return from banishment.",
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },

  // Sigil of Retribution (Level 6 spell, CB p.333)
  // "Mark an adversary within Close range with a sigil of retribution. The GM gains a Fear. When the marked adversary
  // deals damage to you or your allies, place a d8 on this card. You can hold a number of d8s equal to your level. When
  // you successfully attack the marked adversary, roll the dice on this card and add the total to your damage roll, then
  // clear the dice. This effect ends when the marked adversary is defeated or you cast Sigil of Retribution again."
  // The d8s are card tokens (`die: 8`); the mark is the tag "Sigil of Retribution" on the adversary.
  {
    cardId: "sigil-of-retribution",
    uses: [
      {
        id: "main",
        name: "Sigil of Retribution",
        activation: { kind: "action" },
        targets: { side: "enemy", range: "close", count: { kind: "one" } },
        exclusive: true,
        steps: [
          {
            kind: "condition",
            to: "targets",
            condition: { kind: "tag", tag: "Sigil of Retribution" },
            duration: "manual",
            endsWhen: "the marked adversary is defeated, or you cast Sigil of Retribution again",
          },
          { kind: "fear", to: "self", change: "gain", amount: fixed(1) },
        ],
      },
      {
        id: "gather-self",
        name: "Sigil of Retribution: it damages you",
        activation: { kind: "auto", trigger: { kind: "whenYouTakeDamage" } },
        targets: { side: "trigger", who: "source" },
        steps: [
          {
            kind: "tokens",
            to: "self",
            when: [{ kind: "targetHas", condition: { kind: "tag", tag: "Sigil of Retribution" } }],
            op: "add",
            amount: fixed(1),
            max: { kind: "level" },
            die: 8,
          },
        ],
      },
      {
        id: "gather-ally",
        name: "Sigil of Retribution: it damages an ally",
        activation: { kind: "auto", trigger: { kind: "whenAllyTakesDamage", range: "veryFar" } },
        targets: { side: "trigger", who: "source" },
        steps: [
          {
            kind: "tokens",
            to: "self",
            when: [{ kind: "targetHas", condition: { kind: "tag", tag: "Sigil of Retribution" } }],
            op: "add",
            amount: fixed(1),
            max: { kind: "level" },
            die: 8,
          },
        ],
      },
      {
        id: "strike",
        name: "Sigil of Retribution: add the dice",
        activation: { kind: "rider", trigger: { kind: "whenYouAttack", result: "success" } },
        steps: [
          {
            kind: "modifyDamage",
            to: "targets",
            when: ["hit", { kind: "targetHas", condition: { kind: "tag", tag: "Sigil of Retribution" } }],
            change: { kind: "add", amount: { kind: "dice", dice: { count: { kind: "cardTokens" }, sides: 8 } } },
          },
          {
            kind: "tokens",
            to: "self",
            when: ["hit", { kind: "targetHas", condition: { kind: "tag", tag: "Sigil of Retribution" } }],
            op: "clear",
            die: 8,
          },
        ],
      },
    ],
  },

  // Book of Homet (Level 7 grimoire, CB p.333)
  {
    cardId: "book-of-homet",
    uses: [
      // "Pass Through: Make a Spellcast Roll (13). Once per rest on a success, you and all creatures touching you can
      // pass through a wall or door within Close range. The effect ends once everyone is on the other side."
      {
        id: "pass-through",
        name: "Pass Through",
        activation: { kind: "action" },
        limit: { per: "rest", consumedOn: "success" },
        roll: vsFixed(13),
        targets: { side: "any", range: "melee", count: { kind: "any" }, excludeSelf: true },
        steps: [
          { kind: "move", to: "self", when: ["success"], mode: "move", range: "close", note: "Pass through a wall or door within Close range" },
          { kind: "move", to: "targets", when: ["success"], mode: "move", range: "close", note: "Pass through the wall or door with you" },
        ],
      },
      // "Plane Gate: Make a Spellcast Roll (14). Once per long rest on a success, open a gateway to a location in another
      // dimension or plane of existence you've been to before. This gateway lasts until your next rest."
      {
        id: "plane-gate",
        name: "Plane Gate",
        activation: { kind: "action" },
        limit: { per: "longRest", consumedOn: "success" },
        roll: vsFixed(14),
        steps: [
          {
            kind: "manual",
            to: "self",
            when: ["success"],
            text: "A gateway opens to a location in another dimension or plane you've been to before; it lasts until your next rest.",
          },
        ],
      },
    ],
  },

  // Codex-Touched (Level 7 ability, CB p.333)
  // "When 4 or more of the domain cards in your loadout are from the Codex domain, gain the following benefits: • You can
  // mark a Stress to add your Proficiency to a Spellcast Roll. • Once per rest, replace this card with any card from your
  // vault without paying its Recall Cost."
  {
    cardId: "codex-touched",
    uses: [
      {
        id: "proficiency",
        name: "Codex-Touched: add Proficiency",
        activation: { kind: "rider", trigger: { kind: "beforeYouRoll", roll: "spellcast" } },
        requires: [{ kind: "loadoutDomainCount", domain: "codex", min: 4 }],
        costs: [{ kind: "stress", amount: fixed(1) }],
        steps: [{ kind: "modifyRoll", to: "self", change: { kind: "add", amount: prof } }],
      },
      {
        id: "swap",
        name: "Codex-Touched: swap from the vault",
        activation: { kind: "action" },
        requires: [{ kind: "loadoutDomainCount", domain: "codex", min: 4 }],
        limit: { per: "rest" },
        steps: [{ kind: "manual", to: "self", text: "Replace this card with any card from your vault without paying its Recall Cost." }],
      },
    ],
  },

  // Book of Vyola (Level 8 grimoire, CB p.333)
  {
    cardId: "book-of-vyola",
    uses: [
      // "Memory Delve: Make a Spellcast Roll against a target within Far range. On a success, peer into the target's mind
      // and ask the GM a question. The GM describes any memories the target has pertaining to the answer."
      {
        id: "memory-delve",
        name: "Memory Delve",
        activation: { kind: "action" },
        roll: vsTarget,
        targets: { side: "any", range: "far", count: { kind: "one" } },
        steps: [
          {
            kind: "manual",
            to: "targets",
            when: ["hit"],
            text: "Peer into the target's mind and ask the GM a question; the GM describes any memories the target has pertaining to the answer.",
          },
        ],
      },
      // "Shared Clarity: Once per long rest, spend a Hope to choose two willing creatures. When one of them would mark
      // Stress, they can choose between the two of them who marks it. This spell lasts until their next rest."
      {
        id: "shared-clarity",
        name: "Shared Clarity",
        activation: { kind: "action" },
        limit: { per: "longRest" },
        costs: [{ kind: "hope", amount: fixed(1) }],
        targets: { side: "selfOrAlly", range: "unlimited", count: { kind: "upTo", n: fixed(2) }, willing: true },
        steps: [
          { kind: "effect", to: "targets", label: "Shared Clarity", mods: [], duration: "rest" },
          {
            kind: "manual",
            to: "targets",
            text: "When one of the two would mark Stress, they choose between the two of them who marks it (until their next rest).",
          },
        ],
      },
    ],
  },

  // Book of Ronin (Level 9 grimoire, CB p.334)
  {
    cardId: "book-of-ronin",
    uses: [
      // "Transform: Make a Spellcast Roll (15). On a success, transform into an inanimate object no larger than twice
      // your normal size. You can remain in this shape until you take damage."
      {
        id: "transform",
        name: "Transform",
        activation: { kind: "action" },
        roll: vsFixed(15),
        steps: [
          { kind: "effect", to: "self", when: ["success"], label: "Transformed", mods: [], duration: "manual", endsWhen: "you take damage (or choose to change back)" },
          { kind: "manual", to: "self", when: ["success"], text: "You transform into an inanimate object no larger than twice your normal size." },
        ],
      },
      // "Eternal Enervation: Once per long rest, make a Spellcast Roll against a target within Close range. On a success,
      // they become permanently Vulnerable. They can't clear this condition by any means."
      {
        id: "eternal-enervation",
        name: "Eternal Enervation",
        activation: { kind: "action" },
        limit: { per: "longRest" },
        roll: vsTarget,
        targets: { side: "enemy", range: "close", count: { kind: "one" } },
        steps: [
          {
            kind: "condition",
            to: "targets",
            when: ["hit"],
            condition: { kind: "standard", condition: "vulnerable" },
            duration: "permanent",
            endsWhen: "never: they can't clear this condition by any means",
          },
        ],
      },
    ],
  },

  // Disintegration Wave (Level 9 spell, CB p.334)
  // "Make a Spellcast Roll (18). Once per long rest on a success, the GM tells you which adversaries within Far range have
  // a Difficulty of 18 or lower. Mark a Stress for each one you wish to hit with this spell. They are killed and can't
  // come back to life by any means."
  // The server drops picked adversaries above Difficulty 18 without telling their number (U1); a Stress per remaining one.
  {
    cardId: "disintegration-wave",
    uses: [
      {
        id: "main",
        name: "Disintegration Wave",
        activation: { kind: "action" },
        limit: { per: "longRest", consumedOn: "success" },
        roll: vsFixed(18),
        targets: { side: "enemy", range: "far", count: { kind: "any" }, maxDifficulty: 18 },
        steps: [
          { kind: "pay", when: ["success"], costs: [{ kind: "stress", amount: { kind: "targetCount", which: "picked" } }] },
          { kind: "defeat", to: "targets", when: ["success"], note: "Killed; they can't come back to life by any means" },
        ],
      },
    ],
  },

  // Book of Yarrow (Level 10 grimoire, CB p.334)
  {
    cardId: "book-of-yarrow",
    uses: [
      // "Timejammer: Make a Spellcast Roll (18). On a success, time temporarily slows to a halt for everyone within Far
      // range except for you. It resumes the next time you make an action roll that targets another creature."
      {
        id: "timejammer",
        name: "Timejammer",
        activation: { kind: "action" },
        roll: vsFixed(18),
        targets: { side: "any", range: "far", count: { kind: "all" }, area: "aroundSelf", excludeSelf: true },
        steps: [
          {
            kind: "condition",
            to: "targets",
            when: ["success"],
            condition: { kind: "tag", tag: "Time-Stopped" },
            duration: "manual",
            endsWhen: "you next make an action roll that targets another creature",
          },
        ],
      },
      // "Magic Immunity: Spend 5 Hope to become immune to magic damage until your next rest."
      {
        id: "magic-immunity",
        name: "Magic Immunity",
        activation: { kind: "action" },
        costs: [{ kind: "hope", amount: fixed(5) }],
        steps: [{ kind: "effect", to: "self", label: "Magic Immunity", mods: [{ kind: "resistance", type: "magic", level: "immune" }], duration: "rest" }],
      },
    ],
  },

  // Transcendent Union (Level 10 spell, CB p.334)
  // "Once per long rest, spend 5 Hope to cast this spell on two or more willing creatures. Until your next rest, when a
  // creature connected by this union would mark Stress or Hit Points, the connected creatures can choose who marks it."
  {
    cardId: "transcendent-union",
    uses: [
      {
        id: "main",
        name: "Transcendent Union",
        activation: { kind: "action" },
        limit: { per: "longRest" },
        costs: [{ kind: "hope", amount: fixed(5) }],
        targets: { side: "selfOrAlly", range: "unlimited", count: { kind: "any" }, willing: true },
        steps: [
          { kind: "effect", to: "targets", label: "Transcendent Union", mods: [], duration: "rest", endsWhen: "your next rest" },
          {
            kind: "manual",
            to: "targets",
            text: "Until your next rest, when a connected creature would mark Stress or Hit Points, the connected creatures choose who marks it.",
          },
        ],
      },
    ],
  },
];
