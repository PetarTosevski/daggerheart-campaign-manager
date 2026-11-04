# TASK-LN3-E1B: attack and roll paths (lanes-2 wave 9, tracer E1.3b)

Branch `lane3-e1b`, label `lane:w1-e1-triggers-rolls`. Owns: `convex/lib/combatActions.ts`, `convex/lib/rolls.ts`,
`convex/rolls.ts`, `src/components/combat-map/actions/attack/**`, `src/components/party/dice/**`,
`tests/convex/combat-riders.test.ts`, `tests/{convex,unit}/lane3-e1b-*.test.ts`, this doc.

(The first agent on this tracer died in the machine restart; its uncommitted work was kept and finished.)

## What landed

**What the target brings to a PC's map attack** (`resolveAttack`, `targetFacts`):
- dcm-c09o: the adversary's passive `selfConditions` (Hand of Glory, HF p.67) count as its conditions; Hidden / Cloaked
  give the attack disadvantage, Vulnerable advantage (CB p.102, `conditionEdge`); a passive `disadvantageAgainst` covering
  the attack adds one; a passive weakness doubles that target's damage (Made of Straw, HF p.79; type or keyword, the
  keywords come from riders' added damage, `Folds.keywords`); `noCritDamage` (No Vital Organs, HF p.69) gives that target
  the damage without the critical's maximum (the same dice replayed); `noForcedStress` (Tireless, HF p.68) keeps the
  instance's Stress on every rider / ally / after-roll write (`withoutForcedStress`).
- dcm-wuu / dcm-bhp: the area conditions on the target (`memberConditionsFor`, Shadow Swarm's Vulnerable inside, HF
  p.82) and toward the attacker (`observerConditions`, a sight-blocking area between them) join its conditions.
- dcm-yd5h / dcm-9gw: `instanceAttackedRiders` reads the `attackedRider` mods of what the instance carries: E7's `adv:`
  instance modifiers, a card's / feature's instance effect, and a bare tag or condition a card left (Breaking Blow CB
  p.331, Chokehold CB p.336). `by: "others"` skips the PC holding the card (no double 2d12), `caster` the reverse.
  Their damage (`add` rolled with the attack's rng, `multiply`) goes on that target; `advantage` riders give the roll
  advantage; `attackerSteps` and other damage kinds are logged as a public line in the attack's group (manual).
- Several targets (Parallela, Spirit Weapon): one roll, so only the edge every target gives counts (Q1).

**Party sheets (dcm-uwg1)**: `partyEndsFromAttack` ends, in the attack's undo group, this attacker's caster-side effects on
other PCs' sheets (`endForCasterOnSheets` on the roll and on the damage dealt) and other PCs' effects tied to an instance
this attack defeated (Marked for Death, HF p.8, `endOnDefeat`). Saved with the ally rows (one row per changed sheet).

**Rolls (convex/lib/rolls.ts)**:
- dcm-79v1 (roll half): a situational advantage the plain roll used ends its granted benefit (`endGrantedBenefit`,
  Forest Sprites CB p.339), and a shared grant's copies on the other party sheets go with it (`endSharedGrants`,
  Bird's-Eye View CB p.33): `grantEndsOnRoll`, each other sheet a row with its `before`.
- dcm-mm0f / dcm-kti (PC-roll half): `sheetBearerMods` reads what the PC carries back from the entry that gave it
  (adversary `card:<adv>/<feature>:n` effects and card / feature effects). Plain `disadvantage` mods apply to the roll
  (Taunted, Light and Shadow); `beyond` ones (Sandstorm, CB p.339) apply to a map attack from beyond the range;
  `bearerRider`s on action rolls / attacks are named in the roll's line (steps not run yet: dcm-l1er).
- dcm-6qrn (user answer): `dualityFields.weapon` ("primary" / "secondary", absent = no weapon). An attack roll with a
  weapon is a weapon attack for ends (`attack: "weapon"`) and the `weaponAttack` filter; the dice box asks which weapon
  (primary / secondary / none, only the equipped ones offered).
- dcm-bxp.99.19.66: the plain Duality roll (action and reaction) already ended sourced conditions on Fear through
  `rollEndsOnSheet` (wave 8); now tested end to end (Vanishing Act's Cloaked, CB p.42). Other reaction-roll paths:
  dcm-8fc2 (lane:w1-e2-damage-window).

**Spirit Weapon (dcm-xbtw engine half, user answer 2026-10-31)**: `attackRollFields.spiritWeapon`. Ticked, with a Melee /
Very Close weapon and Spirit Weapon held (`spiritWeaponOn`): the attack reaches Close (`checkTargets`), may take one
more target for a Stress (refused with INVALID when no Stress is left), and Sacred Resonance doubles each matching damage
die (`sacredResonance`). Unticked: an ordinary attack. The Attack bar shows "Use as Spirit Weapon" for a Divine Wielder
with such a weapon.

**Attack bar (dcm-jkhp)**: `actions/attack/mods.ts` reads the sheet's live mods the way the server does: the trait picker
shows for any weapon while a `weaponTrait` mod with a choice applies (Versatile Fighter, CB p.330), and the bar takes up
to 1 + extra targets (Parallela, CB p.332; a ticked Spirit Weapon +1). The button names every target.

**Dice box (dcm-hnbk)**: traits shown and labelled from `derivedTraits(withEffects(sheet))` (Beastform's bonus).

**dcm-lfbf**: combat-riders 'Kick' pins the dice (Hope 6, Fear 3), so Kick's Stress is always 1.

## Beads

| Bead | State |
| --- | --- |
| dcm-uwg1 (attack half) | closable for E1.3b's half (card half is E1.3a's) |
| dcm-79v1 (roll half) | closable for the roll half |
| dcm-c09o | partly: passives / weaknesses / noCritDamage / noForcedStress done; events + mindImmune left (dcm-iddp) |
| dcm-yea / dcm-cdz / dcm-2gn PC halves | closable (selfConditions, weakness, flags on PC attacks) |
| dcm-gtmp, dcm-raa | NOT done (Grace-Touched "would force HP": needs an offer before the HP are written; next round) |
| dcm-yd5h, dcm-9gw | closable |
| dcm-kso9 (+ dcm-7zb) | partly: the attacker side reads `attackerSteps` and logs them as a public line; the choice (clear a Stress or gain a Hope) is not applied, and the rider doesn't end on a missed attack ("The next PC to make an attack") |
| dcm-mm0f / dcm-kti PC-roll halves | partly: disadvantage applies, bearerRider steps are reminders (dcm-l1er) |
| dcm-wuu, dcm-bhp (attack-path halves) | closable for the attack path |
| dcm-cj8 | NOT done (an attack on the Wild Fortress dome routed to combatAreas damage: needs a dome target in the Attack bar and the attack args; next round) |
| dcm-jkhp | closable (trait pick and extra targets in the Attack bar) |
| dcm-xbtw engine half / dcm-13s | closable once the merge-time action below lands; stored holds lose the box until dcm-1sk4 |
| dcm-bxp.99.19.66 | closable for rolls.duality; other paths dcm-8fc2 |
| dcm-hnbk, dcm-lfbf, dcm-6qrn | closable |
| dcm-g6t / 1o3 / 0gi / 3ft / iu4 | not taken (time) |

## Follow-ups filed

- dcm-1sk4 (lane:w1-e4-targeting-areas): `sanctionRollOptionsValidator` carries `spiritWeapon` (widen).
- dcm-8fc2 (lane:w1-e2-damage-window): incomingHits / adversaryHits reaction rolls end Vanishing Act's Cloaked on Fear.
- dcm-l1er (lane:w1-e1-triggers-rolls): run bearerRider steps on the PC's own rolls.
- dcm-iddp (lane:w1-e1-triggers-rolls): adversary events from PC attacks, mindImmune.

## Data switches ready for wave 10

- `src/lib/srd/card-effects/valor.ts` lead-by-example: may switch to the tag's `attackedRider { by: "others",
  attackerSteps: [...] }` (user answer dcm-903q: other PCs only); the benefit still shows as a logged line (keep the
  manual reminder until dcm-kso9 applies it, per the silent-reminders answer).
- `src/lib/srd/feature-effects/seraph-witch.ts` spirit-weapon / sacred-resonance: the engine reads the check box; the
  entries' per-attack confirm rider can go (after dcm-1sk4 and the merge-time action).
- Adversary entries with `selfConditions`, `weakness`, `noCritDamage`, `noForcedStress` (HF p.67-79) are read on PC
  attacks: no data change needed.

## Merge-time actions

- `convex/combatActions.ts` (attack and afterRoll) and `convex/combatRequests.ts` (sanction) must pass the roll to
  `checkTargets(ctx, campaign, scene, weapon, ids, roll)` (`rollOf(options)` / `rollFromStored(...)`), or a ticked Spirit
  Weapon's Close target goes to the GM and its extra target is refused. Not my files.
- Authz: `rolls.actionRoll` / `rolls.manualRoll` (dualityFields) gain optional `weapon`; `combatActions.attack` gains
  optional `spiritWeapon`. No new public function. Regenerate `convex/_generated`.

## QUESTIONS

1. Several targets with different conditions (Spirit Weapon's extra adversary, Parallela): one attack roll (CB p.44 "with
   the same attack roll"; CB p.332). I count only the advantage / disadvantage every target gives (a Hidden and an open
   target: no disadvantage). Alternative: the roll takes the worst case. Which?
2. Lead by Example (CB p.342, "The next PC to make an attack against that adversary"): with `by: "others"`, a second PC
   who also holds Lead by Example is treated as the caster and gets nothing. Fine, or should only the PC who placed it
   be excluded (needs the caster on the tag)?
3. Bearer riders on a PC's own rolls (Poisoned, CB p.211: a d6 before each action roll; Ignite, Envelop, Shadow Shackles):
   run automatically in the roll's row, or keep as a reminder line the player resolves?
