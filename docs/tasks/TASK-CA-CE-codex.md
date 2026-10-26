# TASK CA CE-codex: Card effects, Codex

Plan `.omc/plans/combat-actions.yaml`, tracer CE-codex (wave 3). Book pages are printed pages; CB = Core Book.
Implements **U3** ("Automate EVERY domain card usable in combat") for the Codex domain, with **Q3/Q4** (once-per limits;
"on a success" limits are used up only by a success) and **Q9** (movement as a prompt, temporary conditions on the
tracker, choices in a dialog, leftovers as a manual step with the card text).

## What landed

| File | What |
|------|------|
| `src/lib/srd/card-effects/codex.ts` | `CODEX_EFFECTS`: 20 entries (every Codex card classified combat or passive; Safe Haven is out of combat), **50 uses**. Every grimoire spell is its own use. Each entry quotes its card text. |
| `tests/unit/card-effects/codex.test.ts` | 53 tests: the table matches the classification (no missing, extra or duplicate id), every grimoire spell is a use, every use runs through `run()`, and one or more fixed-dice tests per use checking costs, limit, roll, targets and outcomes. |

No vocabulary change. 27 `manual` steps, 9 vocabulary-gap beads (below).

## Readings used throughout

- **Roll Difficulty.** "Make a Spellcast Roll against a target" = the target's Difficulty; "Spellcast Roll (14)" = fixed.
  CB p.96: "Like other trait rolls, Spellcast Rolls can have a set Difficulty, such as 'Spellcast Roll (14).' If a Spellcast
  Roll can damage a target, it's also considered an attack roll." A Spellcast Roll with neither (Reveal, Levitation, a
  construct's command, Repudiate's reaction roll) uses `difficulty: gm`: CB p.92, Step 1, the GM "sets a Difficulty for the
  roll". "On a success" against a target is the `hit` gate; against a fixed or GM Difficulty, `success`.
- **Conditions.** "temporarily" = `temporary` (CB p.102). Card-specific conditions are tags: CB p.102 "Special conditions
  are cleared only when specific requirements are met … stated in the text when the condition is applied", so Asleep,
  Banished, Time-Stopped and the Sigil use duration `manual` with the card's words in `endsWhen`.
- **Limits.** "Once per rest on a success" = `consumedOn: success` (Q4). "Once per long rest, make a Spellcast Roll" (Eternal
  Enervation, Teleport) limits the use itself, so a miss still spends it. Grimoire limits are per spell: key
  `card:<cardId>:<spellId>` (Arcane Barrage, Runic Lock, Repudiate, Arcane Deflection, Pass Through, Plane Gate, Shared
  Clarity, Eternal Enervation, Codex-Touched's swap).
- **Persistent parts** (a circle that hurts whoever enters, a wall that burns whoever crosses, a time-locked object, a
  construct) get a second use. Where the engine can't see the event, the use is behind a `situation` requirement the
  player confirms (`rune-circle-enter`, `wall-of-flame-cross`, `time-lock-maintain`); the construct's uses require the
  card's own `Construct` effect (`effectActive`).
- **"exclusive"** ("or you cast X again", "only one … at a time"): Tava's Armor, Telepathy, Parallela, Create Construct,
  Manifest Wall, Sigil of Retribution.

## Every card

| Lv | Card (page) | Use id | Reading | Manual step (why) |
|---:|-------------|--------|---------|-------------------|
| 1 | Book of Ava (p.332) | `power-push` | Spellcast vs target, enemy Melee; on hit knock back to Far (prompt) + `{Prof}d10+2` magic | — |
| | | `tavas-armor` | 1 Hope; you or an ally in Melee ("a target you can touch"); effect Armor Score +1 until rest; exclusive | — |
| | | `ice-spike` | As a weapon: Spellcast vs target, enemy Far; `{Prof}d6` physical on hit | — |
| | | `ice-spike-summon` | Spellcast (12), a point in Far | "A large ice spike appears" (no mechanics) |
| 1 | Book of Illiat (p.332) | `slumber` | Spellcast vs target, enemy Very Close; tag **Asleep**, ends "they take damage, or the GM spends a Fear on their turn" | duration manual (gap dcm-utu) |
| | | `arcane-barrage` | Once per rest; choose Hope ≥ 1, pay it; that many d6 magic to one enemy in Close; no roll | — |
| | | `telepathy` | 1 Hope; any target you can see; exclusive | the mental link (narrative) |
| 1 | Book of Tyfar (p.332) | `wild-flame` | Spellcast vs target, up to 3 enemies in Melee; hit: `2d6` magic (not Proficiency) + 1 Stress | — |
| | | `magic-hand` | — | the conjured hand (narrative) |
| | | `mysterious-mist` | Spellcast (13), a point in Very Close | the fog (map terrain is not modelled, gap dcm-cma) |
| 2 | Book of Sitil (p.332) | `adjust-appearance` | — | the disguise (narrative) |
| | | `parallela` | 2 Hope; you or an ally in Close; effect label "Parallela" until the bearer's next attack; exclusive | the extra target on that attack (gap dcm-y3e) |
| | | `illusion` | Spellcast (14) | the illusion (narrative) |
| 2 | Book of Vagras (p.332) | `runic-lock` | Spellcast (15) on an object in Melee; once per rest on a success | the lock (out of combat; kept so the grimoire is whole) |
| | | `arcane-door` | Requires no adversary within Melee; Spellcast (13); on success pay 1 Hope (the roll's own Hope may pay, CB p.90), teleport prompt to a point in Far you can see | — (the portal closing is in the prompt's note) |
| | | `reveal` | Spellcast, GM Difficulty | what is revealed (GM) |
| 3 | Book of Korvax (p.332) | `levitation` | Spellcast, GM Difficulty; a target you can see; tag **Levitated** temporary + move prompt within Close of where they were | — |
| | | `recant` | 1 Hope; target in Melee makes a Reaction Roll (15) (adversary: server d20; PC: prompt) | "they forget the last minute" (narrative) |
| | | `rune-circle` | 1 Stress; every enemy in Melee takes `2d12+4` magic (rolled once, R9) and is knocked back to Very Close; no roll | — |
| | | `rune-circle-enter` | Player confirms an adversary entered the circle; same damage and knock-back, no Stress | — (gap dcm-cma) |
| 3 | Book of Norai (p.333) | `mystic-tether` | Spellcast vs target, enemy Far; hit: Restrained (temporary) + 1 Stress | "If the target was flying, it is grounded" (gap dcm-yzr) |
| | | `fireball` | Spellcast vs **the target only** (Very Far, any creature); on hit the target saves (13); `followUp` (no new roll): every creature within Very Close of it (allies too: "all creatures") saves (13) on that success; fail `{Prof}d20+5` magic, success half (rounded up, CB p.107); rolled once (R9) | — |
| 4 | Book of Exota (p.333) | `repudiate` | Reaction to a magical effect; Spellcast reaction roll vs GM Difficulty (no Hope/Fear, CB p.99); once per rest on a success: negate the effect (fold) | — |
| | | `create-construct` | 1 Hope; self effect "Construct" until it takes damage or you make another; exclusive | the construct itself (summons are manual by design, CA0) |
| | | `construct-attack` | Requires the Construct effect; Spellcast vs target; `2d10+3` physical on hit | — |
| | | `construct-command` | Requires the Construct effect; Spellcast, GM Difficulty | the command's outcome |
| 4 | Book of Grynn (p.333) | `arcane-deflection` | Reaction `whenAllyWouldTakeDamage` Very Close, includeSelf; once per long rest; 1 Hope; negate the damage (fold) | — |
| | | `time-lock` | An object in Far | the frozen object (narrative) |
| | | `time-lock-maintain` | Player confirms a creature tries to move it; Spellcast vs that creature | "holds" / "ends" text (the spell has no tracked state) |
| | | `wall-of-flame` | Spellcast (15), two points in Far | the wall and choosing sides (gap dcm-cma) |
| | | `wall-of-flame-cross` | Player confirms something crossed; `4d10+3` magic to that creature (PC: `pcDamage`) | — |
| 5 | Manifest Wall (p.333) | `main` | Spellcast (15); once per rest on a success; pay 1 Hope; self effect until rest; exclusive | the wall and shunting (map walls are not modelled) |
| 5 | Teleport (p.333) | `main` | Once per long rest; choose familiarity −2..+3 as the roll modifier; Spellcast (16); teleport prompts for you and the willing allies in Close | success / off-course text (the GM decides where) ; option set (gap dcm-uyc) |
| 6 | Banish (p.333) | `main` | Spellcast vs target, enemy Close; on hit roll Spellcast-many d20s, highest = the save Difficulty; save success: 1 Stress; failure: optional "banish" (once per rest, key `card:banish:main:banish`) tags **Banished** | the return roll on each PC Fear roll with −1 each time (gap dcm-b77) |
| 6 | Sigil of Retribution (p.333) | `main` | Enemy in Close tagged "Sigil of Retribution"; GM gains a Fear; exclusive | — |
| | | `gather-self` / `gather-ally` | Auto when you / an ally take damage from a tagged source: +1 d8 on the card (card tokens, die 8), max your level | — |
| | | `strike` | Rider on a successful attack against the tagged adversary: add the card's d8s to the damage, then clear them | — |
| 7 | Book of Homet (p.333) | `pass-through` | Spellcast (13); once per rest on a success; move prompts for you and the creatures touching you | — |
| | | `plane-gate` | Spellcast (14); once per long rest on a success | the gateway (out of combat in practice) |
| 7 | Codex-Touched (p.333) | `proficiency` | Requires 4 Codex cards; rider before a Spellcast Roll: 1 Stress, +Proficiency to the roll | — |
| | | `swap` | Requires 4 Codex cards; once per rest | replace with a vault card free (gap dcm-p1r) |
| 8 | Book of Vyola (p.333) | `memory-delve` | Spellcast vs target, any creature in Far | the question to the GM (by design, CA0) |
| | | `shared-clarity` | Once per long rest; 1 Hope; two willing creatures get the "Shared Clarity" effect until rest | who marks the Stress (by design, CA0; count minimum gap dcm-d7h) |
| 9 | Book of Ronin (p.334) | `transform` | Spellcast (15); self effect "Transformed" until you take damage | the object form (narrative; duration gap dcm-utu) |
| | | `eternal-enervation` | Once per long rest; Spellcast vs target, enemy Close; hit: Vulnerable, permanent | — |
| 9 | Disintegration Wave (p.334) | `main` | Spellcast (18); once per long rest on a success; targets filtered to Difficulty ≤ 18 by the server without showing numbers (U1); pay 1 Stress per remaining target; `defeat` them | — |
| 10 | Book of Yarrow (p.334) | `timejammer` | Spellcast (18); everyone else within Far gets tag **Time-Stopped** until your next action roll that targets another creature | duration manual (gap dcm-cwh) |
| | | `magic-immunity` | 5 Hope; self effect: immune to magic damage until rest | — |
| 10 | Transcendent Union (p.334) | `main` | Once per long rest; 5 Hope; the willing creatures get the "Transcendent Union" effect until your next rest | who marks it (by design, CA0; minimum 2, gap dcm-d7h) |

Not in the table: **Safe Haven** (Level 8, p.334), out of combat (CA0).

## Vocabulary gaps (beads)

| Bead | Gap | Cards |
|------|-----|-------|
| dcm-utu | No duration "until the bearer takes damage" | Slumber, Transform |
| dcm-y3e | No modifier for an extra target on the bearer's next attack | Parallela |
| dcm-uyc | `NumberChoice` cannot restrict to listed values (+3/+1/0/−2) | Teleport |
| dcm-yzr | No outcome that clears a creature's `flying` | Mystic Tether |
| dcm-b77 | Recurring reaction roll with a falling Difficulty | Banish |
| dcm-cma | No persistent area that triggers on entry or crossing | Rune Circle, Wall of Flame (Mysterious Mist, Manifest Wall) |
| dcm-p1r | No step that swaps a loadout card with a vault card | Codex-Touched |
| dcm-d7h | `TargetCount` has no minimum | Shared Clarity, Transcendent Union |
| dcm-cwh | Duration ending on the caster's next targeted roll | Timejammer |

## For CA4 / CA5 / AA1

- Pass `useId` for every Codex use (grimoires have no `main`). The default `pickUse` picks the first action use.
- `followUp` (Fireball): pass the creatures within Very Close of the target as `followUp`, not as `targets`; `targets` is the
  one creature the roll is against.
- Banish: offer the optional `banish` (default on) so the player doesn't have to opt in; it only runs on a failed save and
  while its once-per-rest key is free.
- Sigil of Retribution: `gather-self` / `gather-ally` are `auto` with `targets: trigger source`; AA1 passes the damaging
  adversary as `trigger.source`. `strike` is a rider (default on) offered when the attack's target has the tag.
- Disintegration Wave: pass every picked adversary as `targets`; the runner drops those above 18 into `excluded`, which
  the player must not see as a number (U1).

## QUESTIONS

1. **Ice Spike** (p.332): "Make a Spellcast Roll (12) to summon a large ice spike within Far range. If you use it as a weapon,
   make the Spellcast Roll against the target's Difficulty instead. On a success, deal d6 physical damage using your
   Proficiency." Read as two uses: a weapon cast (vs the target's Difficulty, damage) and a summon-only cast (12, no damage).
   Confirm that the summon-only cast deals no damage.
2. **Levitation** (p.332): "Make a Spellcast Roll to temporarily lift a target you can see …" has no "against" and no number,
   so the GM sets the Difficulty even for an unwilling adversary. Should an adversary target use its Difficulty instead?
3. **Fireball** (p.333): "Make a Spellcast Roll against a target … The target and all creatures within Very Close range of them
   must make a Reaction Roll (13)." Read as: the roll is against the first target only; allies in the blast also save and
   take damage ("all creatures"). Confirm that allies are hit.
4. **Banish** (p.333): "On a success, the target must mark a Stress but isn't banished. Once per rest on a failure, they are
   banished from this realm." Read as: the spell can be cast any number of times; only the banishment is once per rest
   (a second failed save that rest does nothing). Confirm, or should the whole card be once per rest?
5. **Sigil of Retribution** (p.333): "When you successfully attack the marked adversary, roll the dice on this card and add the
   total to your damage roll, then clear the dice." Read as mandatory (a rider the dialog shows switched on). Should the
   player be able to save the dice for a later attack?
6. **Eternal Enervation / Teleport** (p.334 / p.333): "Once per long rest, make a Spellcast Roll …" Read as spent by any cast,
   even a miss (unlike "Once per long rest on a success"). Confirm.
7. **Tava's Armor** (p.332): "a target you can touch" read as you or an ally in Melee (adversaries have no Armor Score).
   Confirm that an adversary can't be targeted.
8. **Disintegration Wave** (p.334): the GM normally names the eligible adversaries after the roll; here the player picks the
   adversaries first and the server silently drops those above Difficulty 18 (U1), charging a Stress for each remaining one.
   Confirm that the player is not told which picks were dropped.
9. **Pass Through** (p.333): "you and all creatures touching you" read as creatures in Melee range (willing or not). Should it
   be willing creatures only?
