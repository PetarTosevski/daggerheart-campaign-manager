# TASK-F7-H4: Map Hand follow-ups

Status: Review. Plan: `.omc/plans/followups-7.yaml`, tracer H4. Bead: dcm-bxp.99.24 (from the CA6 questions,
`docs/tasks/TASK-CA-CA6.md`).

## User answers implemented (quoted from the bead)

- "when a player selects another player's token, the Hand panel shows THAT player's hand read-only (no Use/Recall)"
- "hiding hands = BOTH - a GM campaign switch 'Players can see each other's cards' (on by default) and, when allowed,
  each player can hide their own hand. The GM always sees every hand."
- "creatures picked in a card's dialog also get target rings on the map (use CA5's toggleExtraTarget)"
- "the card Use dialog gets the Attack bar's roll options (Experiences, advantage, Help) for any card that rolls"
- "Server: combatCards.hand must allow other players to read a PC's hand when hands are not hidden (today FORBIDDEN) -
  matrix + role tests"

## Server

| Function | Wrapper | Who | What |
|----------|---------|-----|------|
| `combatCards.hand` (changed) | `campaignQuery` view | The character's player and the GM always. Another player of the campaign only while hands are shared (below); otherwise FORBIDDEN. Outsider NOT_FOUND. | Same return shape as before. |
| `combatCards.handSharing` (new) | `campaignQuery` view | Every member | `{ playersSeeHands, hidden: Id<"characters">[] }` |
| `combatCards.setHandHidden` (new) | `campaignMutation` view, then `loadCharacter(…, "edit")` | The character's player (and the GM) | Hides or shows that hand. It writes only when the value changes. |
| `campaigns.setPlayersSeeHands` (new) | `gmMutation` | The GM | Sets the switch. |

A hand is shared with the other players when the GM's switch is on and the character is not in `hidden`
(`handSharedWithPlayers` in `convex/lib/cardHand.ts`). The `edit` permission (the owner, the GM, or an edit grant)
always reads the hand, so the GM sees every hand. `characters.remove` drops the character from `hidden`.

### Where the two settings are stored (my call; widen-only, no schema change)

The plan let me choose the storage, but only among the files this tracer owns. The tables
(`convex/tables/campaigns.ts`, `convex/tables/characters.ts`) and the sheet schema (`src/lib/validation/characters.ts`)
are not in that list, so I could not add a field. Choices:

- **The GM's switch: key `playersSeeHands` in `campaigns.options`.** That field is already
  `v.optional(v.record(v.string(), v.boolean()))`, described as "GM switches", so adding a key needs no validator
  change. An unset key means on (the default the user asked for). `resolveOptions` maps only `CAMPAIGN_OPTIONS`, so
  the key never shows up in `campaigns.get().options`. A test checks this. GMs rarely flip the switch, so writing the
  campaign document is fine. `hand` already holds that document (`ctx.campaign`), so reading the switch costs nothing.
- **Hidden hands: one `frameTrackers` row per campaign, key `handPrivacy`.** It stores the versioned blob
  `{ schemaVersion: 1, hidden: string[] }`, capped at `MAX_CHARACTERS_PER_CAMPAIGN` (50). It is read only through
  `readTracker` (the zod schema; `TRACKER_CORRUPT` otherwise, CD2/CD3), and ids go through `ctx.db.normalizeId` (CD7).
  Why: a player's switch must not write the campaign document, which every campaign query reads (CD10). The check costs
  one indexed `unique()` read, and only when another player asks. The campaign purge already deletes `frameTrackers`
  rows (`convex/cleanup.ts`).
- **The cost:** both settings break CD6 a little. Ids sit inside a JSON blob, and the switch sits in a record meant for
  rules. The clean home would be a `handHidden` field on the character (sheet or table) and a typed campaign field, but
  both need files outside this tracer's owns. See QUESTION 1.

## Client

- **Player column (`actions/hand/index.tsx`).** `Hand` checks the selected token. If it is another PC's token
  (`view.pcs`, not `mine`), `OtherHand` renders "Hand · <name>":
  - while the hand is shared: `HandBody` with `canPlay={false}` (greyed, no Use or Recall) and the note
    "Read only: <name>'s player plays these cards.";
  - otherwise: no cards, and why ("<name>'s player keeps their hand hidden." or "The GM keeps every player's cards
    private.").

  "Your hand" clears the selection. `OtherHand` asks for `hand` only when `handSharing` says it may, so a hidden hand
  never trips the error boundary. Both queries update in the same client transaction.
- **Own hand.** `HideHandSwitch` (`actions/hand/sharing.tsx`) is a `role="switch"` labelled "Hide my hand from the
  other players". It shows only while the GM's switch is on and uses an optimistic update on `handSharing`.
- **GM column.** `HandSharingSwitch` (`settings/hand-sharing.tsx`) is labelled "Players can see each other's cards". It
  sits at the top of the GM's Resolutions slot (Play), above "Cards: your call" and the selected PC's Hand, and uses an
  optimistic update.
- **Target rings (`actions/hand/dialog.tsx`, `actions/targets/index.tsx`).** Each pick or unpick in the dialog's
  creature lists (targets and the card's other creatures) calls `toggleExtraTarget` for the token that changed.
  Creatures that were already ringed stay as they are. `TargetsLayer` now draws:
  - players: a ring on every picked token their character sees; an enemy keeps its band and hint colour, any other
    creature gets a green "ally" ring with no band;
  - the GM: rings on the creatures they pick in a card dialog (`GmRings`, from `combatTokens.list`). The GM's map
    clicks still select tokens and never pick targets.
- **Roll options (`actions/hand/roll-options.tsx`, `model.ts`).** These are the Attack bar's controls and limits:
  collapsed "Roll options", Experience chips at 1 Hope each, an Advantage stepper from −6 to +6, and Help dice 0–6.
  - `formFor` sets `rolls` when the use has a `roll`.
  - `rollOf` turns the answers into `useCard`'s `roll` (`experienceIds`, `advantage` / `disadvantage`, `help`, along
    with the existing `trait` and the GM's `difficulty`).
  - More Experiences than Hope blocks Use with "Not enough Hope for those Experiences."
  - `HandBody` reads the acting character's Experiences and Hope from `characters.get`, the same subscription as the
    Attack bar, and skips it while the hand can't be played.
- **Design choice (QUESTION 2).** Any card whose use rolls now opens the dialog, because that is the only place the
  roll options live ("for any card that rolls"). The targets come prefilled from the map, so Use takes one more click.
  A one-enemy card that does not roll (for example Deadly Focus) still fires at once.
- **Fix found on the way.** When the server answers `needsChoice`, the Use dialog now closes before the after-roll
  dialog opens. Before, two modal dialogs stacked.
- The Stepper is copied from `actions/attack/index.tsx`, which is not in this tracer's owns and does not export it
  (CH7). QUESTION 3.

## Tests

- `tests/convex/combat-cards-authz.test.ts`: role rows (anon, outsider, otherPlayer, player, GM) for:
  - `hand` while shared (otherPlayer ok);
  - `hand` with the switch off, and with the hand hidden (otherPlayer FORBIDDEN, player and GM ok);
  - `handSharing`, `setHandHidden` (otherPlayer FORBIDDEN) and `campaigns.setPlayersSeeHands` (GM only).
- Matrix: `tests/convex/authz/combat.entries.ts` (`hand` otherPlayer ok; `handSharing`; `setHandHidden`) and
  `tests/convex/authz/core.entries.ts` (`setPlayersSeeHands`).
- `tests/convex/combat-cards.test.ts`, describe "F7-H4":
  - the full sharing flow, including that `campaigns.get().options` does not list the key and the stored blob's shape;
  - another player can't hide someone else's hand;
  - `characters.remove` drops the character from `hidden`;
  - a corrupt blob gives `TRACKER_CORRUPT` for another player but not for the owner;
  - roll options on Bolt Beacon: the Experience's value lands in the modifier, the advantage and help dice appear, and
    the Experience costs a Hope.
- `tests/unit/combat-hand.test.tsx` (27 tests):
  - model: `rolls`, `needsDialog`, `rollOf`;
  - the dialog's roll options are sent with the use, and the Hope check works;
  - a card without a roll gets no roll options;
  - dialog picks ring and unring through `ActionsProvider`;
  - another player's hand: read only, hidden, the GM's switch off;
  - "Hide my hand" calls `setHandHidden`;
  - the GM's switch calls `setPlayersSeeHands`.
- `tests/e2e/combat-cards.spec.ts`:
  - The player test now goes through the dialog with advantage +1.
  - Selecting Mira's token shows her Hand read only. With the GM's switch off it shows nothing and says why; on again,
    the cards come back. "Your hand" returns to the player's own Hand. The player hides their hand and the GM still
    reads it.
  - In the GM test, picking the Bandit in the dialog rings it on the map.
  - Axe runs on the dialog and on the other player's Hand.

## QUESTIONS

1. **Storage.** Keep the switch in `campaigns.options` and the hidden list in a `frameTrackers` row? Or move them into
   typed fields in a later tracer that owns the schema (a `playersSeeHands` field on `campaigns`, a `handHidden` field
   on the character) and migrate?
2. **Rolling cards and the dialog.** (a) keep it: every rolling card opens the dialog with its roll options (now);
   (b) a rolling card with an enemy already picked fires at once, so its roll options are reachable only when the dialog
   opens for another reason; (c) put a "Roll options" disclosure in the Hand panel itself (as in the Attack bar) and
   apply it to quick uses too.
3. **Shared roll-options component.** Move the Stepper and Experience chips into one component that the Attack bar and
   the Hand both import, in a tracer that owns `actions/attack/**`? (a) yes; (b) leave the copy.
4. **The party sheet.** Everyone in the campaign reads every sheet (user decision 2026-10-17). So a hidden hand, or the
   GM's switch off, hides cards on the map only: the Party page's Domains section (`characters.get`) still shows the
   loadout and vault to other players. Should hiding also cover the sheet? (a) map only (now); (b) hide the loadout and
   vault on the sheet for other players (UI only); (c) also redact `domainCards` in `characters.get` for other players
   (server).
