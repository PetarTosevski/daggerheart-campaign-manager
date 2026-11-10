# TASK-RULES-WS: rule switches wave 3, sessions, scars & level-up (X3, W3, L3)

Status: Review. Rule switches wave 3, tracer WS (epic dcm-jh6d part A, bead dcm-bxp.134). Inputs:
`.omc/plans/rule-switches-wave3-questions.md`, its section "User answers (2026-11-09)" (binding: Q11 a, Q13 a, Q14 a),
the user's note of 2026-11-10 (the Doom Track's tier rules apply in Book **and** Every N sessions) and
`docs/tasks/TASK-RULES-W3S0.md` (the modes and the "Readers" list). Same meanings as waves 1-2: Book = the app does what
the book says; Manual = the app stops doing it and posts a GM-only note (`postRuleNote`).

`scars`, `doomTrack` and `domainCardLevels` are added to `WIRED_RULES`
(`src/components/config/sections/rules/model.ts`, their own block). W3's "Sessions per box" number
(`doomTrackSessions`) is shown by its row.

## What each mode does

| Rule | Book | Variant | Manual |
|---|---|---|---|
| X3 `scars` (CB p.106) | Avoid Death's Hope Die at or under the level adds a scar; the last slot sets `journeyEnds`; the session End lists those PCs (unchanged). | — | Avoid Death adds no scar. When the die says scar, the move's row says "Hope Die 1 against level 2: a scar, for the GM to mark." and the GM gets "Mira gains a scar: cross out a Hope slot?" in the move's group (undo takes both back). The End's `journeyEnds` list is always empty. The GM adds the scar on the sheet. |
| W3 `doomTrack` (HF p.177), Journey to Horizon | The End reminds "mark a Doom Track box in tier N or below" every session (`doomTier`). Tier 1 (long-rest Fear rolled twice, WD), Tier 2 (a region's habitat d20 of 1 counts as two 1s) and Tier 4 (a mark gains Fear) are automated. | `everyNSessions` (*not in the books*), N = `doomTrackSessions` 1–4: the reminder only on sessions N, 2N, … (by the session's number; none when the End has no session row and N > 1). Every tier rule applies as in Book (user 2026-11-10); Tier 4's Fear follows each mark, so it also comes every N sessions. | No reminder. A Tier 4 mark gains no Fear: "Doom Track Tier 4: gain 2 Fear?". Tier 1 is not applied (WD). Tier 2 is not applied: the habitat is rolled as without it, and a first d20 of 1 gives "Doom Track Tier 2: Region 3's habitat d20 rolled a 1, which counts as two 1s (overtaken). Change it by hand?". The tier and nesting rules for marking stay (they are the track itself). |
| L3 `domainCardLevels` (CB p.111) | Level-up and the Domain Deck refuse a card above reach (class domains at the level, multiclass domain at half, the "additional domain card" pick's tier cap) (unchanged). | — | Any level of the character's domains may be taken (other domains still refused). The pickers show those cards face-up with "Above level". The GM gets "Mira took Blade Dance (level 4) at level 2" per such card (level-up: at the new level; Domain Deck: at the current level). Character creation keeps level-1 cards in both modes. The trade's "equal or lower level" rule is unchanged. |

Tier 3 (Dark-Hearted on adversary rolls) is WF's; it should gate on `doomTierRulesApply(ruleMode(campaign, "doomTrack"))`.

## Code

- `src/lib/domain/death/index.ts`: `ScarsMode`, `scarNote`, `avoidDeath(sheet, hopeDie, mode)` (Manual keeps `scarred`, no
  scar, `journeyEnds` unchanged).
- `convex/deathMoves.ts`: `makeMove`'s rolled Avoid Death reads X3; Manual gives the row a group (the request's, else
  `death-manual:<id>:<now>`) and posts the note there, without `characterId` (as X2 Manual does).
- `convex/sessions.ts`: `runEnd` reads `ruleModesOf` once: `journeyEnds` empty in X3 Manual; `doomTier` via
  `doomReminderDue(mode, doomTrackSessions, live?.n)`.
- `src/lib/frames/trackers/horizon.ts`: `DoomTrackMode`, `doomTierRulesApply`, `doomReminderDue`, `tierFourFearNote`,
  `tierTwoRegionNote`.
- `convex/trackers/horizon.ts`: `markBox` (Tier 4 Manual note, no Fear), `generateRegion` (Tier 2 by
  `doomTierRulesApply`, Manual note). Both notes have no group: neither mutation writes an undoable log row.
- `convex/rests.ts`: `doomTierOneActive` uses `doomTierRulesApply` (Book and Every N sessions).
- `src/lib/domain/level-up/index.ts`: `DomainCardLevelsMode`; `cardLimit(…, mode)` (Manual: any level of a domain in
  reach); `cardsWithin`, `cardTakeProblem`, `cardProblem` take the mode; `LevelUpContext.domainCardLevels`;
  `isAboveLevel`, `cardsAboveLevel(sheet, choice)`, `aboveLevelNote`.
- `convex/levelUp.ts` `apply` and `convex/characters.ts` `takeCard`: read L3, pass it, post one note per card above
  the Book reach (no group, no `characterId`: level-up rows are not undoable through the log and `takeCard` logs nothing).
- UI: `sections/domains.tsx` (the Domain Deck reads `ruleSettings.get`; "Above level" tag) and `level-up-draft.tsx`
  (`validateLevelUp` gets the mode, so Finish is not blocked client-side). Until `ruleSettings.get` loads: Book.

No new public function, so no authz-matrix entries.

## Interpretations (questions for the user)

1. W3 Manual also stops Tier 2's region rule (with a GM note), for consistency with "tier rules apply in Book and Every
   N sessions". Keep, or should Manual still automate Tier 2?
2. Every N sessions counts by the session's number (`n`): the reminder on sessions N, 2N, …. An End with no session row
   gives no reminder when N > 1.
3. X3 Manual covers Avoid Death only. Witherwild's Wither scars (CB p.261) and Age of Umbra's succumb rule are frame
   content and still scar automatically. Should Wither scars follow X3 Manual too?
4. X3 Manual hides the End's retirement list even for a PC whose `journeyEnds` was set before the switch (the sheet badge
   still shows it).
5. L3 Manual also lifts the "additional domain card" pick's tier cap (4 in tier 2, 7 in tier 3) as part of "Above level".

## Tests

- `tests/convex/rules-ws.test.ts`: X3 Book / Manual (note, group, undo, no note on a high die), the End's list in both
  modes; W3 reminders (Book every End, Every 3 sessions on 3 and 6, Manual none), Tier 4 Fear in Book and Every N vs.
  Manual's note, Tier 2 Book vs. Manual (reroll + note), Tier 1 in Every N sessions; L3 Book refusals, Manual Domain Deck
  (note, other domain refused), Manual level-up (note; none within reach), creation still level 1.
- `tests/unit/rules-ws.test.ts`: the pure helpers.
- Updated: `tests/unit/config/rule-switches.test.tsx` (X3 / L3 wired), and the sheet tests' `convex/react` mocks return
  `undefined` for `ruleSettings:get` (`domain-deck-level-up`, `experiences-level-up`, `purposeful-design`,
  `sheet-render`).
