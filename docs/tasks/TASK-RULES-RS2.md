# TASK-RULES-RS2: Players wait while the GM holds the spotlight (S2)

Plan `.omc/plans/rule-switches.yaml`, tracer RS2 (beads dcm-bxp.99.32.5, dcm-bxp.99.32.38). Builds on RS0 (`ruleMode`,
`postRuleNote`) and RA / RA2 (S1 moves the spotlight to the GM on every PC action roll with Fear or a failure).

## Rule and modes

| Rule | Book passage | Book mode | Manual mode |
|---|---|---|---|
| S2 `playersWait` | CB p.100: "When play passes to the GM, the GM can make a move to spotlight an adversary … Once the GM has finished, play passes back to the PCs." | While the GM holds the spotlight in a running encounter, a player's non-reaction act is refused with SPOTLIGHT_WITH_GM before anything is written. | User answer Q4 a: the act goes through. The HUD warns the player ("The GM has the spotlight", not a lock) and the GM gets "Mira acted while you held the spotlight" (a token move: "Mira moved …"). |

User answer 2026-11-06: S2 applies only while an encounter is running. Outside one, nothing waits and no note is posted
in either mode, even while the GM holds the spotlight (S1 moves it there outside fights too).

## Code

`convex/lib/spotlight.ts`:

- `assertMayAct(ctx, campaign, character, kind, name?)` returns `"ok" | "warned"`. It passes:
  - a `reaction`;
  - any caller with owner permission on the campaign (the GM, a co-GM, also while playing for a PC);
  - anything while the GM doesn't hold the spotlight;
  - anything while no encounter is running.

  Otherwise Book throws SPOTLIGHT_WITH_GM, and Manual posts the note and returns `warned`.
- `playersWaitNow(ctx, campaign)` returns null outside a running encounter (one indexed read), else the mode.
- Manual notes: one per PC and kind for each GM hold. It reads the GM's rows since `since`, at most 50. The note has no
  group and is never undoable, so undoing the act leaves it.
- `useActKind(use)`: a card or feature use is a reaction when its activation is `reaction` or its roll is a reaction
  roll.
- `playersWaitNote(name, kind)` writes the note's text.

Call sites (each is before the first write, inside the keyed `once` where there is one):

| Path | Kind |
|---|---|
| `rolls.actionRoll` | `action` (kind `reaction`: passes) |
| `rolls.manualRoll` | `action` for a typed-in action roll; reaction and damage pass |
| `rolls.tagTeam` | `action` (the initiator's) |
| `combatCards.useCard` | `useActKind(pick.use)` |
| `combatFeatures.useFeature` | `useActKind(req.pick.use)` |
| `combatActions.attack` | `action`; an attack the GM forced (Beguiled, `forcedRequestId`) passes |
| `combatTokens.move` | `move`, for a player's move that changes square; the GM's drags pass |
| `characters.moveCard` (`cardHand.moveCardFor`) | `action` for a recall from the vault into the loadout (dcm-bxp.99.32.38, CB p.27); vaulting passes |

The following always pass because they finish an act already started: `rolls.damageRoll`, `tagTeamApply`,
`storeSlayerDie`, `combatActions.afterRoll` / `riderPick` / `pickMinions`, and the GM's sanctions. `combatTokens.turn`
(facing only) is not checked.

HUD:

- `combatSpotlight.state` decides it for every surface:
  - `reactionsOnly` is true only for a player in Book while the GM holds the spotlight in a running encounter.
  - In Manual there it is false, and `spotlightWarning: true` is added.
- So the hand, the sheet panel, the pickers and token drags lock only in Book, and unlock in Manual and outside
  encounters, with no change of their own.
- `hud/spotlight` `GmTurnNotice`: the players' "The GM has the spotlight" card shows whenever the GM holds it. Its
  "Reactions only" line shows only with `reactionsOnly`. In Manual the card is the warning.
- `hud/blocked/reason.tsx`: `SpotlightWarning` and `SPOTLIGHT_WARNING`. The action ring draws the warning under the
  token when `spotlightWarning` is set.

## Tests

`tests/convex/rules-spotlight-wait.test.ts` covers:

- Book, for each entry point: refused with nothing written.
- Token moves refused; the GM's drag passes.
- Reaction and damage rolls pass.
- The GM and a co-GM pass.
- After a hand-back, players act again; with nobody holding the spotlight, nothing is refused.
- Manual, for each entry point: the act goes through with one GM-only note. The note is posted once per hold and kind,
  posted again after a new hold, and never shown to players.
- Outside a running encounter, both modes: nothing waits and no note is posted.
- Vault Recall in Book and Manual.
- `combatSpotlight.state` per mode.
- `useActKind` and `playersWaitNote`.

Fixtures elsewhere that act right after a roll with Fear in a running encounter now hand the spotlight back first
(`combatSpotlight.handToParty`):

- `combat-cards` (its `use` helper);
- `lane-e1-triggers-rolls` (its `attack` and `manual` helpers);
- `combat-attack` (the Slayer loop);
- `rules-roll-aftermath` (the R3 tests; the S1-Manual test sets `playersWait: "manual"`).

`hud-spotlight` runs its reactions-only tests inside a running encounter.

`tests/convex/helpers.ts` `handingBack(client, gm, campaignId)` wraps a client so that the GM hands the spotlight back
before each player act S2 can refuse. These arenas use it:

- `combat-riders`
- `lane3-e1a-use-paths`
- `lane3-e1b-attack`
- `lane3-s2-features`
- `lane4-s1-card-switches`
- `lane4-s2-features`
- `rules-defined-ranges`
- `out-of-range-refuse`
