# TASK LN-C2: Conditions record their source; Vanishing Act endings; Cloaked follow-ups

Plan `.omc/plans/lanes.yaml`, tracer C2 (lane `w0-c-cloaked`), wave 5. Beads: dcm-bxp.99.19.52 (with the R5 note) and
dcm-bxp.99.19.65.

Book pages are printed pages (CB = Core Book).

## What landed

| File | What |
|------|------|
| `convex/lib/cardRunner.ts` | **Condition sources.** `writeSheetChanges`: a standard condition whose card or feature step ends on events of its own (an `endsOn` other than `stanceDrops`, an `endsOnRoll`; today only Vanishing Act's Cloaked) also gets a **source marker**: an ordinary sheet effect of that entry (`feat:<hash>:<n>` / `card:<id>:<n>`) labelled with the condition's name, `until` = the step's duration (`rest`). A second use replaces the marker, never stacks it; a `clearCondition` step drops the condition's markers too. New helpers: `sourceEnds`, `conditionMarkerOf`, `conditionSources`, `withoutCondition`, `lapsedConditions`, `endRollOf`, `endConditionsOnRoll`, `endedConditionLine`. `sheetAfterPlan` (behind `actorSheetAfter`): a card's or feature's own roll ends the actor's sourced conditions first (Charge or a Spellcast card rolled with Fear ends Vanishing Act's Cloaked), before the use's own steps are written. |
| `convex/lib/combatMovement.ts` | **Stop-gap removed:** `cloakedByVanishingAct` (the last 20 feed rows read by summary text) is gone; `sourcedCloak(sheet)` reads the marker. `uncloaked` drops the marker with the condition (unconscious / dead, a failed Finesse roll). The Cloaked Finesse roll (`rollCloak`) ends sourced conditions on a roll with Fear. **dcm-.65 (1):** `enemySight` in a dim phase looks again under night light (`NIGHT_LOOK`): what the night's light shows clearly (a torch's / campfire's clear reach, the enemy's own Melee sight) is clear, so Cloaked ends outright; the rest stays dim (Finesse roll). New `uncloakAfterAttack` (one public undoable `feature` row in the caller's group; a sourced Cloaked stays). |
| `convex/lib/combatActions.ts` | **R5:** `uncloaked` became `uncloakedByAttack`: an attack ends only an ordinary Cloaked; Vanishing Act's stays. The attack's roll first runs `endConditionsOnRoll` (with Fear: Vanishing Act's Cloaked ends), with a public undoable row "<name>: Cloaked ends (Vanishing Act)" in the attack's group. |
| `convex/lib/restHooks.ts` | `sourcedConditionsRestHook` (frame-independent, last): the rest's expiry takes the marker (`until: rest`), so the hook drops its condition (`lapsedConditions` against the stored pre-rest sheet, one `get` per resting PC) and adds "<name>: Cloaked ends (Vanishing Act)" to the rest's feed row. Saved, logged and undone with the rest. |
| `convex/featurePrompts.ts` | **dcm-.65 (4):** a successful Charge whose Stress dealt the 1d12 (`damageRoll` in the plan) is an attack: `uncloakAfterAttack` ends an ordinary Cloaked in the Charge's group (one undo reverts both); then the move check runs as before (and finds nothing left to end). |
| `tests/convex/lane-c2-cloaked.test.ts` | 15 tests: the marker (written, replaced not stacked, none for a plain condition), roll endings (Fear ends; Hope, critical, damage don't), rest expiry, `withoutCondition`; map attack with Hope keeps Vanishing Act's Cloaked (Sneak Attack still applies), with Fear ends it (public row, undo restores marker and condition), ordinary Cloaked still ends on an attack; short rest drops Vanishing Act's Cloaked (feed line) but keeps a bare one; Nautical Twilight: inside an enemy's torch's clear reach ends Cloaked outright, its dim reach still rolls, Vanishing Act's stays; unconscious drag drops Cloaked and the marker, a conscious GM drag keeps it; Charge with the Stress ends ordinary Cloaked in the Charge's group (undo reverts), keeps Vanishing Act's on a roll with Hope, and a Charge rolled with Fear ends Vanishing Act's. |

No stored shape changed: the marker is an ordinary `effects` entry (zod `effectSchema`, `effectValidator`), so rule 7
needs no widening and no migration. `convex/lib/validators/characters.ts` is unchanged. No public function was added or
changed (no authz-matrix entries needed).

## Book quotes and answers used

- CB p.42 (Rogue, Cloaked): "Any time you would be Hidden, you are instead Cloaked. In addition to the benefits of the
  Hidden condition, while Cloaked you remain unseen if you are stationary when an adversary moves to where they would
  normally see you. After you make an attack or end a move within line of sight of an adversary, you are no longer
  Cloaked."
- CB p.42 (Nightwalker mastery, Vanishing Act): "Mark a Stress to become Cloaked at any time. When Cloaked from this
  feature, you automatically clear the Restrained condition if you have it. You remain Cloaked in this way until you roll
  with Fear or until your next rest."
- CB p.59 (Firbolg, Charge): "When you succeed on an Agility Roll to move from Far or Very Far range into Melee range with
  one or more targets, you can mark a Stress to deal 1d12 physical damage to all targets within Melee range."
- User R5 (dcm-bxp.99.19.42, closed; note on .52): attacks no longer strip Vanishing Act's Cloaked; it ends only on a
  roll with Fear or the next rest.
- User 2026-10-30 (dcm-bxp.99.19.65): (1) in a dim phase, a rogue inside a torch/campfire lit radius is seen CLEARLY
  (Cloaked ends, as at night); (2) GM drag of a conscious rogue never ends Cloaked (as built, kept, tested); (3)
  unconscious/dead drops every Cloaked incl. Vanishing Act's (as built, kept, tested: the marker goes too); (4) Charge's
  1d12 Stress damage is an attack: it ends (ordinary) Cloaked.

## Decisions

- **Where the source lives.** The sheet's zod schema (`src/lib/validation/characters.ts`) is not C2's file and strips
  unknown fields, so a new `conditionSources` field was not possible here. The marker effect reuses the shape the E6
  ends engine and the enemy condition markers (`cardRows.conditionMarker`) already use: the effect id names the entry,
  the label names the step. It shows in the sheet's effects list ("cloaked", source "Vanishing Act").
- **Which conditions get a marker:** only a card's or feature's standard condition step with events of its own
  (`sourceEnds`). Plain conditions stay bare, so nothing else changes behaviour. Adversary features writing conditions
  on PCs get none (their entries are not card / feature entries).
- **"As at night" (dcm-.65 (1))**: the dim-phase level is the better of dim and what the night's light alone would show.
  That includes the enemy's own Melee sight at night (clear in Melee, R9): a dim phase is never darker than night.
- **Order in a use with a roll:** the roll ends sourced conditions before the use's own steps are written, so a use
  never ends a condition it gives itself.
- **"A roll"** is an action or reaction Duality roll (`endRollOf`); damage and free rolls end nothing.
- **Existing data:** a rogue Cloaked by Vanishing Act before this deploy has no marker, so the Cloaked reads as ordinary
  until it ends. It is transient (it would end at the next rest anyway), so no migration.

## Follow-ups (filed, `lane:w0-c-cloaked`)

- dcm-bxp.99.19.66: the plain Duality roll (`convex/lib/rolls.ts` `duality`) and other reaction-roll paths must call
  `endConditionsOnRoll` (a roll with Fear from the roll dialog does not end Vanishing Act's Cloaked yet). The card /
  feature path ends it silently (undo covered by the sheet row); a feed line needs featureRunner / combatCards.
- dcm-bxp.99.19.67: a card or feature attack (Spellcast attacks in `convex/combatCards.ts`, featureRunner) does not end
  an ordinary Cloaked (CB p.42). Pre-existing gap.
- dcm-bxp.99.19.68: clearing a condition by hand (`characters.toggleCondition`) leaves the marker; use
  `withoutCondition`.

## For the orchestrator at merge

- Lane M (light setting): `enemySight` keeps its `lightOf(scene.phase)` read; the dim-phase look again calls
  `createView` with `phase: NIGHT_LOOK` ("Deep Night", a night phase in R8). If M changes how `createView` / `lightOf`
  take the light (a campaign-wide Day / Dim / Night value), wire the night look to M's night value there.
