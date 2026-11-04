# TASK DA6: Hand and drawer - one shared "Play for this character" switch, out-of-range card targets greyed, dialog picks reset

Plan `.omc/plans/drawer-answers.yaml`, tracer DA6 (bead dcm-bxp.99.19.46 (2) and (4)). The user changed the plan on
2026-10-30 (rebuild 22c1aa1): the switch is stored on the server, so DA6 adds one table and two GM functions.

## User answers implemented (2026-10-30)

- **One switch per PC** (SD6 QUESTIONS 1): the GM's "Play for this character" is one switch per PC, shared by the map
  Hand and the sheet drawer. It stays on until the GM turns it off: closing the drawer, closing the Hand or picking
  other tokens keep it. The drawer's own copy, which started off on every open, is gone. The switch is stored **on the
  server** (user, later the same day), so it follows the GM to every device.
- **Out-of-range card targets** (CA8 follow-up 2): the card dialog still lists every creature on the card's side; one
  outside the card's range is greyed (dashed border, muted text) with a second line "Out of range - GM approves". It
  stays pickable, and the use then waits for the GM's sanction as before (Q1).
- **Dialog picks reset** (CA8 bug 3): a new card dialog starts with none of the last dialog's picks, and their rings on
  the map go.

## What changed

| File | What |
|------|------|
| `convex/tables/playFor.ts`, `convex/schema.ts` | New table `playFor` (`campaignId`, `userId`, `characterId`): one row per GM and PC while the switch is on. Index `by_campaign_user_character`, whose `campaignId` prefix the purge reads. |
| `convex/playFor.ts` | `list` (gmQuery): the calling GM's switched-on characters in the campaign (`.take(200)`). `set` (gmMutation, `{ characterId, on }`): an intent that inserts or deletes the row. It is idempotent, and a character of another campaign is NOT_FOUND (`loadCharacter` with `owner`). Access goes through the gm wrappers (`permissionFor`), the same as the Hand's switch. |
| `src/components/combat-map/play-for.ts` | `usePlayFor(campaignId, characterId, gm)` returns `{ on, set, error }`. It reads `playFor.list` (skipped for a player) and sends `playFor.set` with an optimistic update on the list (CL3, CL4). A refusal is shown as an alert under the switch. The Hand and the drawer share one subscription, so nothing is copied into state (CL7). |
| `src/components/combat-map/drawer/index.tsx` | `DrawerBody` reads `usePlayFor` (skipped for players) in place of its own `useState`, and shows a refusal as an alert. |
| `src/components/combat-map/actions/hand/index.tsx` | `GmHandFor` no longer holds `playingFor`, and no longer resets it when another PC is selected. A new `GmHandBody` renders the held PC's Hand with the shared switch. `HandBody` drops the last dialog's picks from the enemies it treats as picked (so a single-enemy card no longer fires at a creature only a dialog ringed). It opens every dialog through `openDialog`, which calls `clearDialogPicks` first; this covers both Use and "Pick from a list". Creatures carry their token's square and size (`at`) for the range check. |
| `src/components/combat-map/actions/hand/dialog.tsx` | `CreaturePicks` greys a creature that is out of range (`data-away`, the visible line, and `aria-describedby` with the same text; the accessible name stays the creature's name). Switching the spell in a grimoire's dialog calls `onSpell`, which clears the last spell's picks and rings. |
| `src/components/combat-map/actions/hand/model.ts` | `Creature.at`, `TargetAsk.area` / `areaRange`. `outOfRange(ask, creatures, picked, c)` mirrors the server's `rangeOrigin` (convex/lib/cardRunner.ts) with `rangeCheck` from `src/lib/domain/combat-actions/distance.ts`: it measures from the actor, uses `areaRange ?? range` for an area around yourself, and measures an area around a point or target as the first target from the actor and the rest from the first target. |
| `src/components/combat-map/actions/hand/hand.css` | `.cmh-pick[data-away]` and `.cmh-pick-away` (the chip stays 44 px tall). |
| `src/components/combat-map/actions/targets/state.tsx` | The provider records which targets a card dialog added (`toggleExtraTarget`), as `dialogTokenIds`. `clearDialogPicks()` drops those targets and their rings. A pick on the map (`toggleTarget`) is the player's own, and `clearTargets` resets both. The Attack bar's single-select pick works as before. |
| `tests/unit/play-for.test.tsx` | New, 5 tests, with a reactive fake Convex client: off while loading or when nothing is listed; the Hand's and drawer's switches follow one intent (`{ campaignId, characterId, on }`) through the optimistic update, and another PC's switch does not change; a switch turned on elsewhere shows on; a refusal shows an alert and rolls back; a player's view skips the query. |
| `tests/convex/play-for.test.ts` | New: on and off, setting twice keeps one row, rows belong to the GM and campaign, other PCs keep theirs; player FORBIDDEN, outsider NOT_FOUND, anonymous UNAUTHENTICATED, nothing written. |
| `tests/convex/authz/play-for.entries.ts`, `tests/convex/authz/play-for.test.ts` | Matrix rows: `playFor.list` and `playFor.set` as `gm` (anonymous, outsider, player, GM). The runner file is required by the matrix's "every area file has its runner" check (see Ownership). |
| `convex/cleanup.ts`, `tests/convex/cleanup.test.ts`, `tests/convex/schema-guard.test.ts` | The campaign purge deletes `playFor` rows. The cleanup test seeds one, and the schema guard lists the table as campaign-scoped (see Ownership). |
| `tests/unit/combat-hand.test.tsx` | +7 tests: `outOfRange` (actor, unknown position, weapon / unlimited, around yourself, around a target); the Wild Flame dialog greys the Archer 8 squares away and still sends the use with it; the next dialog starts with nothing pressed and no rings, while an enemy picked on the map is still the first pick; switching a grimoire's spell drops the picks and rings; the GM's Hand sends `playFor.set` and follows the server's list across Mira's hand, closing it and coming back; a refused switch shows an alert in the bar. |
| `tests/unit/sheet-drawer.test.tsx` | The GM's switch sends `playFor.set` (and its optimistic update writes the list). The drawer opens with the server's value, on until it is turned off, and another PC's switch is its own. A refusal shows as an alert. |
| `tests/e2e/sheet-drawer.spec.ts` | After Play in the drawer, Mira's map Hand shows the switch on. On reopening, the drawer's switch is still on and Mark Stress is enabled. Unchecking it greys the drawer, and the Hand follows. |
| `tests/e2e/combat-actions-flow.spec.ts` | The Recant step no longer sets the picks explicitly (`pickExactly`). It checks that the Raider (a Wild Flame dialog pick) is not pressed, that the Bandit (picked on the map in step 1) is, and that Bryn is greyed with "Out of range - GM approves". It then picks the Raider. |

`card-dialog.test.tsx` (SC1's large card view) needed no change.

## Checks

- `pnpm lint`, `pnpm typecheck`: clean (after `npx convex codegen` locally; `convex/_generated` is not committed).
- `pnpm test`: 339 files, 8594 passed and 1 expected fail. In an earlier run under load, `schema-guard.test.ts` timed
  out once ("every public function has an args validator", 15 s) and passed on the full run.
- e2e (ports 3166 / 3444): `combat-actions-flow.spec.ts` and `sheet-drawer.spec.ts` pass (3 tests). In
  `combat-cards.spec.ts` (the Hand spec), 3 of 4 tests passed. The once-per-rest test failed once waiting for Deft
  Maneuvers after the rest, and passed when run alone; it is a player-only path that DA6 does not touch.
- `tracer-guard`: names the four files under Ownership.

## QUESTIONS

1. **An enemy picked on the map still pre-fills the dialog.** "A new dialog starts with no picks" is read as no picks
   from the *last dialog*. An enemy the player tapped on the map (or targeted in the Attack bar) is still the card's
   first pick, as CA6 / F8-I1 do. Should a dialog ignore the map pick as well?
2. **Rings after a dialog closes.** A dialog's picks keep their rings after Use or Cancel. They go when the next dialog
   opens, a spell is switched, or the player taps an enemy on the map. Should Cancel (or Use) clear them at once?
3. **What is greyed.** Only the use's own targets are greyed. The other creature lists ("Who it affects", "Allies it
   affects", "Other targets") are measured by the server from their own specs, which the dialog does not carry yet, so
   they are never greyed. "Weapon range" targets are not greyed either, because the dialog does not know the weapon's
   range. Should those be greyed too?
4. **Rows of removed characters.** A switch row stays when its character is deleted. It is harmless (the Hand and
   drawer only ask about present PCs) and goes with the campaign's purge. Should a character's removal delete it?
5. **Label text.** The label is the user's wording, with a plain hyphen: "Out of range - GM approves".

## Ownership

The server switch needed four files outside DA6's `owns`, each a one-line or one-block registration that the
repository's guards require for any new table or public function:

- `tests/convex/authz/play-for.test.ts`: the matrix's runner for `play-for.entries.ts`. `authz-matrix.test.ts` fails
  an area file that has no runner.
- `convex/cleanup.ts`: the purge deletes `playFor` rows.
- `tests/convex/cleanup.test.ts`: "covers every campaign-scoped table" fails until the table is seeded.
- `tests/convex/schema-guard.test.ts`: "a new table fails the guard until it is listed".

So `tracer-guard` names these four files. The orchestrator should add them to DA6's `owns` or accept them at the merge.

## Follow-ups

- None filed. The QUESTIONS above become beads if the user wants a change.
