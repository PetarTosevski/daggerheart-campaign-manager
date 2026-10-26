# TASK-SF-F1: Session boundaries - Luckbringer and the moon die at Start, Slayer and Tide clear at End, reports and log

Status: Review. Plan: `.omc/plans/session-features.yaml`, tracer F1 (wave 2, depends on F0). Bead: `dcm-bxp.58`.
Rules: K1-K7, U1-U9, ANSWERED Q1 and E1-E6 in the plan header (all binding).

## Goal
Starting a session gives the party its Luckbringer Hope and rolls every Moon Witch's die. Ending one clears Slayer Dice
for Hope, Tide tokens and the moon die. All of it runs inside the existing undoable Start and End groups and shows in the
reports and the session log, where the reminders used to be.

## Book rules implemented (printed pages)
The quotes are the ones F0 re-checked on 2026-10-21 against `.reference-private/` (`docs/tasks/TASK-SF-F0.md`, "Book rules,
re-checked"). `pdfjs-dist` is not installed in this worktree, so F1 relies on that check.
- **K1 Luckbringer** (Halfling, CB p.64): "At the start of each session, everyone in your party gains a Hope."
- **K2 Slayer** (Call of the Slayer, CB p.48): "At the end of each session, clear any unspent Slayer Dice on this card and
  gain a Hope per die cleared."
- **K3 Know the Tide** (Seaborne, CB p.77): "At the end of each session, clear all unspent tokens."
- **K4 Lunar Phases** (Moon Witch mastery, HF p.17): "At the beginning of each session, roll a d6 and place it on this
  card. You gain the matching effect until the end of session."
- **K6** The Hope maximum: every Hope gained goes through `applyResourceDelta`, which caps it at `hopeMax`.

## What was built
### `convex/sessions.ts`
- `start`: for the ACTIVE PCs, runs `onSessionStart(sheet, rollDie)` first (Prayer Dice, Rally), then
  `sessionStartFeatures(hooked, rollDie, scopeOf(campaign))` (F0) on the results. That gives the Luckbringer Hope (U1:
  stacked, capped, only from active Halflings) and a moon die for each Lunar Phases holder in scope (U6: Hope & Fear
  only). Each changed PC is saved with ONE row in the Start group, so undoing the group takes back the Prayer Dice, the
  Hope and the moon die together (E1).
- `end` (`runEnd`, also run by a Start that ends the live session first, B6): for EVERY PC,
  `sessionEndFeatures(onSessionEnd(expire(sheet, "session")))`, then the Wither conversion as before. It clears Slayer
  Dice for +1 Hope each (capped), clears Tide tokens and removes the moon die (U8), in the End group and undone with it.
  This also runs with no live session (E1).
- `scopeOf(campaign)`: the campaign's `FeatureScope`, the same one-liner as `convex/rolls.ts` (that file belongs to F2).
- `sessionReminders` and its two helpers are removed. Both results keep `reminders` (optional) but always return `[]`.
  The existing test `start ... toMatchObject({ ..., reminders: [] })` still passes unchanged (E2).
- New optional result field `features: string[]` on `start` and on `end` (and therefore on `start.ended`), filled
  with F0's notes:
  - Start: "Luckbringer (Pip, Rosa): everyone gains 2 Hope" and "Mira's moon die: 4 (Full: +3 to damage thresholds)".
  - End: "Bryn cleared 2 Slayer Dice: +2 Hope", "Kai cleared 2 Tide tokens" and "Mira's moon die ends".
- Log stamps (B10 format, one auto line per Start or End): the notes join the line after the Prayer Dice or lost-dice
  notes. Examples: "Session started. Luckbringer (Ash, Bryn): everyone gains 2 Hope." and "Session ended. Ash cleared 3
  Tide tokens; Bryn cleared 2 Slayer Dice: +2 Hope."
- No new function, table, index or error code. The args are unchanged and the returns are widened only, so
  RETURNS_PENDING is untouched.

### `src/components/sessions/live/index.tsx`
- `startReportLines`: after "Session started. …" comes one line per `features` note, closed with a full stop. The
  reminder lines used to sit in this place.
- `endReportLines` (also used by the dashboard's Wither panel): one line per `features` note after the lost-dice line.
- `reminders` is still rendered if a caller ever fills it. It is always empty now.

## Acceptance evidence
- `tests/convex/sessions.test.ts`: 23 tests. It had 19: the Q8 reminder test was removed and 5 tests were added in its
  place.
  - "U1, K6": two active Halflings give 2 Hope. A PC at 5 stops at 6. A dead Halfling and an away Halfling give
    nothing and gain nothing. The log line is checked, and undoing the Start group restores the Hope.
  - "U6, K4": a Moon Witch at mastery gets no die with Hope & Fear off. With it on, a fixed rng (`getRandomValues`
    spy) gives die 4 and its note. End removes the die and logs both lines. Undoing the End restores the die.
  - "U8, K2, K3": End clears 2 Slayer Dice (+2 Hope) and 3 Tide tokens, and the log line is checked. Undo restores
    them. A second End with no live session clears them again, and the Hope stops at 6.
  - "B7": restarting a played session gives the Luckbringer Hope again.
  - "Q6": the Horizon `doomTier` assertion is kept as its own test.
  - Every other test is unchanged and passes.
- `tests/convex/session-features-boundary.test.ts` (4 tests):
  - Roles for `start` and `end`: anonymous gets UNAUTHENTICATED, an outsider NOT_FOUND, and a player FORBIDDEN, both
    the holder's owner (p1, the Halfling and Seaborne Ash) and a non-owner (p2 owns the Slayer). A refused call leaves
    the sheets unchanged. The GM call succeeds.
  - An idempotent replay gives no second Hope, and a second End is a no-op.
  - B6: a Start that ends the live session first reports that End's features in `ended.features`, then its own.
  - K7: a Moon Witch below mastery gets no die, and neither does one in a campaign with Hope & Fear off. At mastery
    she gets one die from 1 to 6 with its note.
- Full suite: `pnpm vitest run --maxWorkers=4 --testTimeout=60000` passes 149 files and 1741 tests. `pnpm lint` reports
  zero warnings and `pnpm typecheck` is clean.
- e2e (`E2E_PORT=3155 E2E_CONVEX_PORT=3422`): `tests/e2e/session-features-boundary.spec.ts` passes.
  - The party: Halflings Pip (Hope 5) and Rosa (2), Slayer Bryn (2 dice, Hope 2), Seaborne Kai (2 tokens, Hope 0).
  - The Start report reads "Luckbringer (Pip, Rosa): everyone gains 2 Hope.", and the Hope values become 6, 4, 4, 2.
  - The End report reads "Bryn cleared 2 Slayer Dice: +2 Hope." and "Kai cleared 2 Tide tokens.". Bryn's Hope becomes
    6, and neither sheet has `sessionFeatures` left.
  - The existing specs `sessions-live`, `wither`, `class-features` and `visual/D10-S3` pass unchanged.
- Seeding: before F2, no public mutation sets held Slayer Dice or Tide tokens. Both specs therefore create one PC
  through the API and append the rest to the local e2e backend's `characters` table with
  `node scripts/convex-e2e.mjs import --table characters --append -y <jsonl>`. This needs no production code.

### Visual (`tests/e2e/visual/SF-F1.spec.ts`, `E2E_VISUAL=1`, shots in `test-results/visual/SF-F1/`)
| Region | 1440 | 1024 | 390 | Verdict |
|---|---|---|---|---|
| Live card, Start report (`start-*.png`): "Session started.", Luckbringer line, Mira's moon die line | ok | ok | ok | Lines in the existing report style, one per note; no horizontal scroll at 390. |
| Live card, End report (`end-*.png`): "Session ended.", Slayer, Tide, moon die lines | ok | ok | ok | Same. |
Deliberate deviation: none. The lines sit where the Q8 reminders were, in the same `ss-live-report` style.

## QUESTIONS
1. `reminders` comes back as `[]`, not absent, so the existing assertion `reminders: []` in `sessions.test.ts` passes
   unchanged (E2 says "every other test passes unchanged"). Reversible: dropping the two `reminders: []` lines makes the
   field absent.
2. The live card's idle texts ("Seraphs roll their Prayer Dice and the Bard's Rally refreshes") and the End dialog text
   ("unspent Rally and Prayer Dice are cleared") do not mention the new features. They were left unchanged so the
   existing e2e and visual specs stay as they are. Should they name Luckbringer, the moon die, Slayer Dice and Tide
   tokens?
3. `scopeOf` now exists in both `convex/rolls.ts` and `convex/sessions.ts`. A shared `convex/lib` helper would be
   better, but that file is outside F1's `owns` (orchestrator follow-up).
