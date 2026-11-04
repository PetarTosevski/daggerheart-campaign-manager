# TASK LN-SRD-C2: SRD domain-card data, Midnight, Sage, Splendor, Valor

Plan `.omc/plans/lanes.yaml`, tracer SRD-C2 (lane `w2-srd-data`, wave 5). Wave 4 (V, E1-E8) widened the effect
vocabulary and taught the engines to run it with fixture entries. This tracer moves the real entries in
`src/lib/srd/card-effects/{midnight,sage,splendor,valor}.ts` onto that vocabulary. It also checks every remaining
`manual` step against the vocabulary. No types, runner or engine file was touched.

Book pages are printed pages (CB = Core Book). Card text was checked against `.reference-private/text/core.txt`.

## Manual steps

Counted the way `tests/unit/card-effects/coverage.test.ts` counts them: every object with `kind: "manual"`, nested ones
included.

| File | Before | After |
|---|---|---|
| `midnight.ts` | 13 | 9 |
| `sage.ts` | 19 | 10 |
| `splendor.ts` | 11 | 6 |
| `valor.ts` | 4 | 2 |
| Total | 47 | 27 |

## Beads done (data side; the engine side was done in wave 4)

| Bead | Card | Now |
|---|---|---|
| dcm-94h | Twilight Toll (CB p.337) | `toll` is an `auto` use on `afterYouRoll` `{ roll: action, result: success, against: { creature: tagged "Twilight Toll" }, noDamageRoll: true }`. The situation the player had to confirm is gone. |
| dcm-98d | Unyielding Armor (CB p.342) | The trigger is `whenArmorSlotMarked` with `stage: "would"`. On a 6 it does `reduceSeverity` with `insteadOfArmorSlot: true`, so no slot is marked and the armor answer counts as given. The manual step is gone. |
| dcm-z1a | Fane of the Wilds (CB p.339) | The critical use's trigger has `cardDomain: "sage"`. The situation is gone. |
| dcm-qdm | Shield Aura on yourself (CB p.341) | `aura-self` now requires a `situation` with `check: hasCondition "Shield Aura" who self`. The text is only the fallback (Q13). |
| dcm-sim | Shield Aura (CB p.341) | The aura condition has `endsOn: ["reducedToNoHp"]`. Both "clear its tag" manual steps are gone. |
| dcm-y45 | Stunning Sunlight (CB p.341) | The save's pick has `among: "hit"`. |

## Cards automated further (other beads' data side, for the orchestrator to close or keep)

| Card | Change | Bead | Engine still needed |
|---|---|---|---|
| Midnight Spirit, attack (CB p.336) | manual "dissipates" → `endEffect` self on a success | dcm-8x8 | card uses applying `endEffect`: dcm-9z2z / dcm-9nlr |
| Phantom Retreat, return (CB p.336) | manual "ends after you reappear" → `endEffect` | dcm-8x8 | as above |
| Chokehold (CB p.336) | manual "extra 2d6" → the tag's `mods: attackedRider { by: "others", onSuccess, damage +2d6 }` (your own attacks keep the `auto` use, so it never adds twice) | dcm-9gw | dcm-yd5h |
| Hush (CB p.336) | the `picked` effect + manual "follows the target" → an `area` (centre target, Very Close, `follows`, `silenced`), `endsOn: gmSpendsFear`; the target's effect also has `endsOnCaster: majorDamage` | dcm-cma, dcm-utu | areas from card uses: dcm-9nlr; the area's caster end: gap dcm-rx1k |
| Eclipse (CB p.337) | new `ally-shadow` auto (`afterAllyRolls` success with Hope against an enemy within Far) marks the Stress; the effect has `endsOn: gmSpendsFear`, `endsOnCaster: takeSevere`; the manual step now covers only the darkness | dcm-0gi, dcm-8bv | ally autos run on weapon attacks (E1) |
| Specter of the Dark (CB p.337) | `endsOnRoll { roll: action, targetsCreature: true }` | dcm-cwh | dcm-wn7 |
| Tekaira Armored Beetles (CB p.338) | the optional and two manual steps → `choose` keep (pay a Hope) or disperse (`endEffect`) | dcm-8x8 | dcm-9z2z |
| Wild Fortress (CB p.339) | manual "the dome falls" → `endEffect` on you and allies | dcm-8x8 | dcm-9z2z |
| Wild Surge (CB p.339) | two manual "the form drops" → `endEffect` | dcm-8x8 | dcm-9z2z |
| Forest Sprites, attack (CB p.339) | trigger narrowed: `roll: "attack"`, `against: { enemy: true }` | dcm-g6t | ally reactions: dcm-cfpv |
| Rejuvenation Barrier (CB p.339) | manual → resistance `from: "outsideArea"` (the reaction window reads it today) plus an `area` that follows you | dcm-nt4, dcm-cma | dcm-9nlr |
| Force of Nature, upkeep (CB p.339) | manual "revert" → `endEffect` with no Hope; the Hope `pay` is gated on `hopeAtLeast 1` | dcm-8x8 | dcm-9z2z |
| Tempest: Hurricane (CB p.339) | manual → a `choose` "wind" (eight map directions) and the tag's `moveLimit { direction: { choice: "wind" } }`, `endsOn: gmSpendsFear` | dcm-3oe | stored mod: dcm-3p7s |
| Tempest: Sandstorm (CB p.339) | manual → the tag's `disadvantage { on: attack, beyond: melee }`, `endsOn: gmSpendsFear` | dcm-4dc | E7 |
| Smite (CB p.340) | manual "end its charge" → `endEffect` | dcm-8x8 | dcm-9z2z |
| Zone of Protection (CB p.340) | manual "die exceeds 6" → a `check` on the die (7 or more) that clears it and runs `endEffect` on you and allies | dcm-8x8 | dcm-9z2z |
| Resurrection (CB p.341) | manual "a week" → `limit { per: session, period: week, consumedOn: failure }` | dcm-aym | dcm-55k |
| Goad Them On (CB p.341) | manual → the tag's `mods: [mustAttack caster, disadvantage attack]`, `endsOn: bearerAttacks` | dcm-e75 | E7 |
| Hold the Line (CB p.342) | the stance has `endsOn: moves, failWithFear`; Restrained has `endsOn: gmSpendsFear`, `endsOnCaster: moves, failWithFear` | dcm-bpr | dcm-g90o (below) |

## Manual steps left, and why

| Steps | Why | Bead |
|---|---|---|
| Veil of Night, Eclipse: the darkness (2) | No area blocks sight for some observers only; walls can't be placed yet; no end on "you cast another spell" | dcm-o44e (new) |
| Phantom Retreat: the return spot; Forest Sprites: placing the sprites (2) | No stored map point or placed markers | dcm-5yew (new) |
| Hold the Line: the pull reminder (1) | The trigger exists, but nothing runs a `whenEnemyEntersRange` use and the Hand starts only `action` uses | dcm-g90o (new) |
| Lead by Example (1) | Rule question: does the caster's own next attack count? | dcm-903q (new, `rule-question`) |
| 21 narrative steps: Midnight Spirit, Dark Whispers ×5, Natural Familiar ×4, Towering Stalk, Conjured Steeds' travel, Wild Surge's description, Plant Dominion, Force of Nature's absorb, Final Words ×3, Shape Material, Restoration's ailment, Resurrection's restore | Fiction or a GM ruling with nothing for the engine to do (Q9) | dcm-lezi (new, P4; close as won't-fix unless wanted) |

Left as they were, because switching now would lose behaviour that works today (dcm-vbzy):
- Midnight-Touched's Fear Die stays a dialog number. `dualityDie` reads 0 until riders pass `hostRoll` (dcm-n0dv).
- Critical Inspiration and Rousing Strike keep their two lists. `choose.by` waits on per-chooser picks (dcm-x4ft).
- Second Wind's "with Hope" stays a confirmation, because an after-roll rider's scope has no host result.

## Decisions

- Where the vocabulary says it but the server doesn't apply it yet, the data is switched anyway. The card's words move
  into the new step's `note`, so the feed still shows them. The engine bead is named in the table above.
- Twilight Toll's token and Unyielding Armor's check are mandatory in the text ("place a token", "roll"). Twilight
  Toll's `toll` is now `auto`. Unyielding Armor stays a reaction so the reaction window offers it before the armor
  answer (E2's design).
- Hurricane's direction is one of the eight map directions. The card says only "choose a direction the wind is
  blowing".

## Tests

Per-card tests in `tests/unit/card-effects/{midnight,sage,splendor,valor}.test.ts` cover every change above. Valor also
runs Unyielding Armor through the reaction window: it is offered only before the armor answer; a 6 resolves Severe to
Major with 0 slots and refuses a second armor answer; with no 6 the slot is still marked.
`tests/unit/card-effects/coverage.test.ts` is unchanged and passes.

## Checks

- `pnpm lint`: clean. `pnpm typecheck`: clean.
- `node scripts/tracer-guard.mjs .omc/plans/lanes.yaml SRD-C2 rebuild HEAD`: every changed file is owned.
- `pnpm test` ran with a load average of about 71 (other tracers were running in parallel): 9106 passed, 1 expected
  fail, 169 failed across 111 files. 159 of the failures were 15 s timeouts; the rest were timing or count checks. None
  is in a card-effect file.
- Rerun of those 111 files alone (`--testTimeout=180000 --maxWorkers=4`): 1576 passed, 1 failed. The one left is
  `tests/convex/auth-signup.test.ts` "the global sign-up bucket stops a flood" (66 > 63). It is load-sensitive: TASK-LN-E2
  lists it among the tests that fail under load, and this tracer touched no auth code.
- The four domain test files pass (midnight 45, sage 61, splendor 53, valor 48), and so does `coverage.test.ts`.
