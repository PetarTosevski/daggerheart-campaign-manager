# TASK SD8: Scene end, rest and session timing for feature limits, effects and tokens

Plan `.omc/plans/sheet-drawer.yaml`, tracer SD8 (bead `dcm-bxp.99.19`; closes `dcm-bxp.117`). Status: Review.

A scene now ends in three ways (user answer Q7 (a)): the GM ends the running encounter, the GM presses End scene, or
the session ends. When it ends, scene limits come back and scene effects end. Feature tokens follow their rest and
long-rest texts.

## Book passages

- CB p.107, End of the Scene: "Sometimes certain effects, bonuses, or conditions state that they last until the end of
  the scene. At the GM's discretion, a scene continues until the current narrative situation has played out. … A battle
  scene usually ends when one side has fled, surrendered, or been entirely defeated."
- CB p.36, Unstoppable: "When the die's value would exceed its maximum value or when the scene ends, remove the die and
  drop out of Unstoppable."
- HF p.12, Martial Stances: "Otherwise, you drop out of your active stance at the end of the scene." Focus: "Once per
  rest during a moment of calm, you can clear your mind and refocus … You can hold a maximum of 6 Focus."
- HF p.16, Walk Between Worlds: "Place a number of tokens equal to your Spellcast trait on this card … When the last
  token is removed or at the end of the scene, you return to the Mortal Realm".
- HF p.16, Enchanted Talisman: "Clear all tokens from this card when you take a rest."
- HF p.9, Toxic Concoctions: "When you take a long rest, clear all unspent tokens."
- HF (Vampire transformation), Feed: "When you take a long rest, remove a token."
- CB p.44, Devout: "When you roll your Prayer Dice, you can roll an additional die and discard the lowest result."

## What changed

| File | What |
|------|------|
| `src/lib/domain/characters/expiry.ts` | `expire(sheet, "scene")` ends `featureUses` with `until: scene` (as well as `effects`). It also drops the Unstoppable Die, the active stance (Focus and known stances stay) and the Walk Between Worlds tokens (`SCENE_TOKEN_KEYS`). `expire(sheet, "session")` does all of that too, because the session end also ends the scene. Rests and hits behave as before (Q3). |
| `convex/combatScenes.ts` | New. `endScene(ctx, campaign, actorId)` runs `expire(…, "scene")` for every active PC. It writes one undoable `actionLog` group (a row for each changed PC, plus a campaign row "Scene ended") and closes the campaign's live `combatAreas` with `expires: scene`. `combatScenes.end` is a keyed GM mutation wrapping it. It refuses (INVALID) when more than 49 sheets would change, because an undo group holds 50 rows. |
| `convex/encounters.ts` | `encounters.end` calls `endScene` after it closes the encounter's requests. |
| `convex/lib/cardHand.ts` | `runRestTiming` also runs the `auto` `timing` uses (`afterRest` / `afterLongRest`) of every feature the sheet holds (`owned()`), but only uses whose steps all move tokens: Toxic Concoctions, Enchanted Talisman and Feed. A timed use that does anything else (Hardy's Hit Point) belongs to SD-R's rest flow and is skipped. D5's `onRest` / `onSessionEnd` are untouched and still run once each. |
| `convex/lib/restHooks.ts` | `endAreasRestHook`: a rest closes the resting PCs' live areas with `expires: rest`, and a long rest also closes those with `expires: longRest`. An interrupted long rest runs as `short` (CB p.105). |
| `src/lib/domain/class-features/classes/seraph.ts` | Devout (Divine Wielder specialization or mastery): `rollPrayerDice` rolls one extra d4 and discards the lowest. `hasDevout`. |
| `src/components/combat-map/actions/scene/index.tsx` | New `EndSceneButton`: a confirmation modal, `useIntent(api.combatScenes.end)`, a status live region and 44 px targets. `sceneReport` builds the status text. |
| `src/components/adversaries/tracker/top-bar.tsx` | Adds End scene to the Encounter tab top bar, next to End GM turn. |
| `tests/unit/expiry-scene.test.ts` | Unit tests for scene, session, rest and hit expiry, the Unstoppable Die, the stance, the Walk Between Worlds tokens and Devout. |
| `tests/convex/feature-hooks.test.ts` | Convex tests: combatScenes.end (one group, undo, idempotent replay, areas), encounter end, session end, rests leave scene state alone, Toxic Concoctions and Enchanted Talisman tokens, and area ends at a rest. |
| `tests/convex/authz/scenes.entries.ts`, `scenes.test.ts` | Authz matrix: `combatScenes.end` is `gm` (anonymous UNAUTHENTICATED, outsider NOT_FOUND, player FORBIDDEN, GM ok). |

## Readings (literal, per the books)

- Devout says "you can roll an additional die". Rolling it never hurts, because the lowest die is discarded, so the app
  always rolls it.
- Toxic Concoctions and Feed act on a long rest only. An interrupted long rest gives short-rest benefits (CB p.105), so
  their tokens stay.

## QUESTIONS

1. **Walk Between Worlds tokens at scene end.** HF p.16: "When the last token is removed or at the end of the scene,
   you return to the Mortal Realm in the same spot you left it." The feature has no effect entry yet: it is out of
   combat, Q15 (b). The literal reading clears its `cardTokens` entry (`feat:subclass:hedge:walk-between-worlds`) when
   the scene ends. Confirm.
2. **Interrupted long rest and long-rest tokens.** CB p.105 says an interrupted long rest gives short-rest benefits. The
   app therefore keeps Toxic Concoctions' unspent tokens and Feed's tokens. Confirm.

## Follow-ups (outside SD8's `owns`, for the orchestrator)

- **End scene on the Combat Map GM column is not mounted.** The button lives in `actions/scene`, but the GM column is
  built in `src/components/combat-map/actions/index.tsx` (`Resolutions`), which HF1 owns, or in the page
  (`combat-map/page.tsx`, which SD0 owns). The mount takes one line in `Resolutions`, plus the import
  `import { EndSceneButton } from "./scene";`:
  `<EndSceneButton campaignId={props.campaignId} className="cm-btn" />`
- **Two End scene mutations.** The dashboard's RF1 `scenes.end` (`convex/scenes.ts`) still counts only scene *effects*.
  A PC whose only scene state is a feature limit, the Unstoppable Die or a stance is skipped there, and areas are not
  closed. `scenes.end` should delegate to `endScene` from `convex/combatScenes.ts`, or the dashboard should call
  `combatScenes.end`.
- **Areas at session end.** `sessions.end` (`convex/sessions.ts`) does not close `combatAreas` with `expires: scene` or
  `session`. It should call `endSceneAreas` and also end the `session` ones.
- **Devout's second half** ("you can use your 'Sparing Touch' feature twice instead of once per long rest") is not part of
  SD8. It belongs to the seraph feature-effect table.
