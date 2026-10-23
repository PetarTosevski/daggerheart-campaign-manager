# TASK I1: Map Hand roll-options strip; typed hand-sharing fields; shared roll controls

Plan `.omc/plans/followups-8.yaml`, tracer I1 (wave 1, no dependencies). Beads `dcm-bxp.99.28`, `dcm-bxp.99.27`.
Status: Review.

## User answers implemented (dcm-bxp.99.28, 2026-10-23)

- "roll options (Experiences, advantage, Help) move to a small strip in the Hand panel that applies to the next card; a
  rolling card with an enemy picked and nothing else to ask fires at once (undo H4's 'every rolling card opens the
  dialog')"
- "hidden hands are hidden on the map only (as built) - the sheet keeps showing loadout and vault." Nothing changed
  for this answer.

## Hand sharing in typed fields (dcm-bxp.99.27)

F7-H4 stored the GM's switch as `campaigns.options.playersSeeHands` and the hidden hands as a `frameTrackers` row
`handPrivacy` (`{ schemaVersion, hidden: string[] }`). Both bent rule CD6. They moved in three steps:

1. **Widen.** `campaigns.playersSeeHands?: boolean` (unset = on) and `characters.handHidden?: true` (unset = shared) (`convex/tables/*.ts`). No new index:
   one on `handHidden` would be a field-prefix duplicate of `by_campaign` (schema guard).
2. **Migrate.** `convex/migrations/handSharing.ts` holds two batched `@convex-dev/migrations` migrations. Run them
   through `migrations/run:run`:
   - `moveSwitch` moves the options key to the field and drops the key. An emptied `options` is unset. If the field is
     already set, the field wins.
   - `moveHidden` sets `handHidden: true` on each listed character of the row's campaign and then deletes the row. It
     drops ids of other campaigns and ids that don't parse. A blob that fails its schema is logged and left for a
     manual repair.

   Both migrations are idempotent. Until they run on a deployment, a switch the GM turned off reads as on, and a
   hidden hand reads as shared.
3. **Narrow.** `convex/lib/cardHand.ts` reads only the new fields. `handSharedWithPlayers(campaign, character)` is now
   synchronous (no tracker read). `hiddenHands` reads the campaign's characters through `by_campaign` with
   `.take(MAX_CHARACTERS_PER_CAMPAIGN)` and keeps the hidden ones. `writeHandHidden`
   patches only the character, so a player's switch never writes the campaign document (CD10). The old places had no
   validator of their own, so there is nothing more to tighten. The zod schema and the tracker helpers left
   `cardHand.ts`.

No public function was added. The arguments, return shapes and error codes stay the same. `hand`, `handSharing`,
`setHandHidden` and `campaigns.setPlayersSeeHands` keep their authz matrix entries. The only behaviour change is that
a bad `handPrivacy` blob no longer causes `TRACKER_CORRUPT`, because nothing reads it now. `characters.remove` still
calls `writeHandHidden(…, false)`, which now unsets the character's field.

## Shared roll controls (dcm-bxp.99.27)

`src/components/combat-map/actions/roll-controls/index.tsx` is now the single home of the roll controls. It holds:

- `Stepper`, `RollOptions` (Experience chips at 1 Hope each, an Advantage stepper from −6 to +6, Help dice 0–6), with an
  optional `className`, `testId` and `hint`;
- `ROLL_DICE_LIMIT`, `signed`, `Roller`, `RollValues`, `NO_ROLL_OPTIONS`;
- `rollProblem` ("Not enough Hope for those Experiences."), `edgeLabel` and `rollSummary`.

The collapsed summary shows what is set ("Roll options · Advantage ×1 · 1 Experience"). The Attack bar
(`actions/attack`) uses these for its options and for the Minion pick counter. `actions/hand/roll-options.tsx` is
deleted.

## The Hand's strip (dcm-bxp.99.28)

- `HandBody` shows `RollOptions` (`data-testid="combat-hand-roll-options"`, hint "Applies to the next card that
  rolls.") above the loadout whenever the hand can be played and has cards. The GM's locked view and another player's
  read-only hand show no strip. The values sit in panel memory (`rolls:<characterId>`), so they survive the 760 px
  layout switch.
- `needsDialog` no longer opens the dialog only because a card rolls. A one-enemy rolling card with an enemy picked
  fires at once: `rollOf(form, null, gm, rollOptions)` adds the strip's Experiences, advantage or disadvantage, and Help.
- A rolling card that still needs the dialog (no enemy picked, a grimoire, a choice) sends the strip's options too. The
  dialog shows "Roll options from the Hand: …" (`combat-card-roll-note`) and blocks Use while the Hope check fails.
- When too many Experiences are picked for the character's Hope, the error shows under the strip and the Use buttons
  of rolling cards are disabled.
- After a use that carried the strip's options settles (resolved or pending, not `needsChoice`), the strip clears. A
  card that does not roll leaves the strip alone.

## Tests

- `tests/convex/migrations-hand-sharing.test.ts` (new, 3 tests): moveSwitch (other options kept, emptied options
  unset, the field wins over a stale key, dry run changes nothing, a second run is a no-op); moveHidden (ids from other
  campaigns and invalid ids dropped, the row deleted, other trackers kept, idempotent); a bad blob left in place.
- `tests/convex/combat-cards.test.ts`: the switch and the hidden flag are stored in the typed fields, with no options
  key and no tracker row, and are unset again when shown. The old storage is no longer read; this test replaces the
  TRACKER_CORRUPT test.
- `tests/unit/combat-hand.test.tsx`: `needsDialog` lets Bolt Beacon fire at once with an enemy picked. Also tested:
  `rollOf` with the strip's values and the GM-only Difficulty, `usedRollOptions`, `rollSummary`; Use fires with no
  dialog; the strip sends its options and then clears, and the Hope check disables Use; a dialog names the strip's
  options and sends them; a card that does not roll leaves the strip alone; the GM's locked view has no strip.
- `tests/e2e/combat-cards.spec.ts`: advantage is set in the Hand's strip, Bolt Beacon on the picked Bandit fires with
  no dialog, and the strip reads "Normal" afterwards.

## Checks

- `pnpm lint`, `pnpm typecheck`: clean.
- `vitest run --maxWorkers=4 --testTimeout=60000`: 287 files, 7718 passed, 1 expected fail.
- `pnpm tracer:guard .omc/plans/followups-8.yaml I1`: OK.
- `tests/e2e/combat-cards.spec.ts` and `tests/e2e/combat-attack.spec.ts` (ports 3174 / 3460): 6 passed.
- `convex/_generated` is untouched: no new public module (`migrations/handSharing` is internal and reached through
  `migrations/run:run`). The orchestrator regenerates it after the merge.
