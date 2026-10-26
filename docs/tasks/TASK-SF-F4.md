# TASK-SF-F4: End-to-end pass, docs and follow-ups

Status: Review. Plan: `.omc/plans/session-features.yaml`, tracer F4 (wave 3, depends on F1, F2, F3). Bead: `dcm-bxp.58`
(the orchestrator closes it after the merge).
Rules: K1-K7, U1-U9, ANSWERED Q1 and E1-E6 in the plan header (all binding).

## Goal
One browser flow plays a whole session with all four features, from Start through rolls, damage and the bump to End.
Every rule, decision and kept behaviour is checked against the app, and every gap is filed.

## Book rules (printed pages)
F4 relies on F0's re-check (`docs/tasks/TASK-SF-F0.md`, "Book rules, re-checked", 2026-10-21, `.reference-private/`):
K1 Luckbringer (CB p.64), K2 Slayer (CB p.48), K3 Know the Tide (CB p.77), K4 Lunar Phases (HF p.17), K5 (CB p.18,
p.90, p.99), Tag Team (CB p.97) and multiclass (CB p.111). The quotes are in that task doc and in the plan header.

## The flow: `tests/e2e/session-features-flow.spec.ts`
The spec has one test, run at 1440x900 and at 1024x768 (`test.use({ viewport })`). The player's browser context uses the
same size. The campaign is a Witherwild campaign with Hope & Fear on.
- The GM plays three PCs: Pip (Halfling Warrior, Hope 5), Bryn (Call of the Slayer Warrior) and Mira (Moon Witch,
  seeded to mastery and level 7).
- A player joins by code and plays Kai (Halfling, Seaborne Warrior).

Steps, in order:
1. **Start.** The GM uses the live card: `+ New session`, then Start. The report reads "Session started.",
   "Luckbringer (Pip, Kai): everyone gains 2 Hope." and "Mira's moon die: n (Phase: effect).". Every PC's Hope becomes
   min(6, h + 2), so Pip stops at 6. The Play stage's session log has one entry with "Session started.", the
   Luckbringer note and the moon die note.
2. **Lunar Phases.** Mira's section and chip show the rolled die. If Start rolled anything other than 1, the die is
   seeded to 1. That is the only seed after setup, because the server's d6 cannot be fixed from the browser.
3. **New Moon.** Minor damage 1, then "Spend a Hope to negate this Minor damage". The calculator says "The New Moon
   negates the Minor damage", Hope drops by 1 and no Hit Point is marked (API read).
4. **Bump.** "Spend a Hope: +1 to the moon die" raises the die from 1 to 2. Waxing is highlighted and the die is 2 on
   the server. After a reload the button is disabled (once per rest) and the chip reads "Moon die 2: Waxing".
5. **Waxing +2.** Mira's damage roll in the dice box shows a flat part of 3 (Dagger d8+1, plus 2). The feed row reads
   "Mira: damage n (Dagger, Waxing Moon +2)".
6. **Tag Team (Q1, U9).** The GM starts it from Bryn's box (partner Kai, 3 Hope). The pick shows in both boxes. The
   player picks "Use Kai’s roll" in Kai's box, and the pick closes. Then, by the chosen roll:
   - with Fear, Kai's Tide tokens become min(1, t + 1);
   - with Hope, Bryn and Kai gain a Hope (capped), and Bryn gets the open Slayer choice (`rolls.pendingChoices`).
7. **Slayer (K2, U2, U3).** The GM makes a manual roll with Hope (8/3) for Bryn. Bryn's box has no Tide stepper. The
   box asks "Take the Hope or store a Slayer Die?", and "Store a Slayer Die" gives a pool of 1 with Hope unchanged and
   the chip "Slayer Dice 1/1". A damage roll with the stepper at 1 shows one "Slayer d6" tile and the pool goes to 0.
   A second roll with Hope stores another die, which is left for the End.
8. **Know the Tide (K3, U4, U5),** in the player's browser. A manual roll with Fear (3/8) gives a token. The box shows
   "1 held (+1 each)" and the chip "Tide tokens 1/1", and there is no Slayer stepper. Spending 1 token on a box roll
   shows "Know the Tide +1". A fixed roll with Fear (2/9) leaves exactly 1 token.
9. **Visibility (U5, U6).** Kai's sheet has no Lunar Phases section. On Bryn's and Pip's sheets the player sees no dice
   box, no stepper and no Lunar Phases section. On Pip's sheet the GM sees no Tide stepper and no Lunar Phases section.
10. **End.** The report reads "Session ended.", "Bryn cleared 1 Slayer Die: +n Hope." (n = min(6, h + 1) - h), "Kai
    cleared 1 Tide token." and "Mira's moon die ends.". The Hope values match. No PC keeps `slayerDice`, `tideTokens` or
    `moonDie`; Bryn keeps only `slayerClaim`, the id of the roll she last answered.
11. **Undo the End** from the dashboard feed (the "Session ended" row, Undo). The row shows "undone". Bryn's die comes
    back with her Hope, as do Kai's token and Mira's die 2. The chips "Moon die 2: Waxing" and "Slayer Dice 1/1" and
    the section's "Moon die 2" show again.

### Result
`E2E_PORT=3179 E2E_CONVEX_PORT=3470 pnpm test:e2e tests/e2e/session-features-flow.spec.ts`:
- One plain run: 2 passed (1440x900 and 1024x768).
- `--repeat-each=2`: 4 passed in 1.2 min, with different random Tag Team outcomes.

## Rule checklist
✓ = holds in the app; GAP = filed as a bead. Evidence is a file or a test; "flow" means
`tests/e2e/session-features-flow.spec.ts`.

| Rule | Verdict | Evidence |
|---|---|---|
| K1 Luckbringer at session start | ✓ | flow step 1; `tests/convex/sessions.test.ts` "U1, K6"; `tests/e2e/session-features-boundary.spec.ts` |
| K2 Slayer: store instead of Hope, cap = Proficiency, spend on attack or damage, clear for Hope at End | ✓ (except G3) | flow steps 7, 10; `tests/convex/rolls-session-features.test.ts` "Slayer Dice"; `tests/unit/session-features.test.ts` "Slayer Dice" |
| K2 edge: store after a roll at Hope max that paid an Experience | GAP G3 | `convex/rolls.ts` `storeSlayerDie` reads `rollGaveHope(before, …)` from the sheet before costs (F2 question 1) → dcm-bxp.65 |
| K3 Know the Tide: token on Fear, cap = level, +1 each before an action roll, clear at End | ✓ | flow steps 6, 8, 10; `rolls-session-features.test.ts` "Know the Tide"; `session-features.test.ts` (unit) "Know the Tide" |
| K4 Lunar Phases: d6 at start, phase effects until End, once-per-rest bump, 6 -> 1 | ✓ | flow steps 1-5, 10; `tests/convex/session-features.test.ts` bumpMoonDie; `tests/unit/derived-moon.test.ts`; unit "Lunar Phases" |
| K5 critical counts as Hope (keeps the cleared Stress); reaction rolls offer nothing | ✓ | `rolls-session-features.test.ts` "keeps a critical's cleared Stress", "refuses … a reaction roll"; unit `canStore` |
| K6 Hope maximum on every gain | ✓ | flow step 1 (Pip 5 -> 6), step 10 (capped gain); `sessions.test.ts` "U1, K6"; unit `clearSlayerAtEnd` |
| K7 holders (Halfling single, mixed-first or Shapeshifter form; Slayer by subclass or multiclass; Seaborne; Moon at mastery with Hope & Fear) | ✓ | unit "holders (K7)"; `session-features-boundary.test.ts` "K7, U6"; `lunar-phases-render.test.tsx` absent below mastery or with H&F off |
| U1 stacked Luckbringer, active PCs only, capped, undone with Start | ✓ | flow step 1 (two Halflings = 2 Hope); `sessions.test.ts` "U1, K6" (dead or away Halfling, undo of Start) |
| U2 'Take the Hope or store a Slayer Die?' when the pool is not full | ✓ | flow step 7; `tests/e2e/session-features-dice.spec.ts`; `rolls-session-features.test.ts` "refuses a full pool" |
| U3 '+ Slayer Dice' stepper on attack and damage rolls, rolled by the server | ✓ | flow step 7 ("Slayer d6" tile); `rolls-session-features.test.ts` "spends Slayer Dice on attack and damage rolls" |
| U4 Tide tokens placed automatically, capped at level | ✓ | flow steps 6, 8; `rolls-session-features.test.ts` "places a token … up to the level" |
| U5 '+ Tide tokens' stepper, only for Know the Tide holders | ✓ | flow steps 7, 9 (none for Bryn or Pip, nor for the player on others' sheets); `dice-box.tsx` `showTide = holdsTide(...)` |
| U6 auto d6; Waxing / Full / Waning automatic; New offers the negate; once-per-rest bump; Lunar Phases section only for a Moon Witch at mastery | ✓ (except G2) | flow steps 1-5, 9; `session-features.test.ts` "a Full moon's +3 counts in the server's thresholds", negateMinor; `derived-moon.test.ts` (Waning Evasion); `lunar-phases-render.test.tsx` |
| U6 Waxing +2 is visible in the dice box | GAP G2 | flow step 5: the server adds +2 (feed "Waxing Moon +2"), but the box's result line and Roll options never name it → dcm-bxp.66 |
| U7 chips: Slayer n/Proficiency, Tide n/level, Moon die n: Phase | ✓ | flow steps 2, 4, 7, 8, 11; `lunar-phases-render.test.tsx` "Class Features chips (U7)"; `session-features-sheet.spec.ts` |
| U8 End clears Slayer (+Hope), Tide and the moon die; in the reports and the session log; undoable | ✓ | flow steps 1, 10, 11; `sessions.test.ts` "U8, K2, K3" and "U6, K4" (log lines, undo of End) |
| U9 either participant (or the GM) picks the Tag Team roll; offered in both boxes | ✓ (except G1) | flow step 6 (the player picks the GM-started Tag Team); `tests/convex/rolls.test.ts` access test; `rolls-session-features.test.ts` "Tag Team (Q1, U9)" |
| U9 the picking partner sees the result | GAP G1 | flow step 6: the partner's box drops the "counts for both" line once the pick closes (`tag-team.tsx`) → dcm-bxp.67 |
| Q1 (a) action rolls only, never reaction; Tag Team: only the chosen roll counts, for both; a roll changed afterwards places nothing | ✓ | flow step 6; `rolls-session-features.test.ts` "reaction roll … places nothing", "the chosen roll places tokens … for both"; tokens are placed only in `convex/rolls.ts` (the roll, l.299, and `tagTeamApply`, l.693) |
| E1 Start/End idempotent, one undoable group each, End for every PC, also with no live session, restart runs Start again | ✓ | `session-features-boundary.test.ts` "idempotent replay", B6; `sessions.test.ts` "B7", "U8 … a second End with no live session"; flow step 11 |
| E2 `reminders` optional and empty, new lines in `features`; the Q8 test replaced, Horizon doomTier kept | ✓ | `sessions.test.ts` (`reminders: []` assertion, "Q6" doomTier test); `convex/sessions.ts` |
| E3 rolls keep their arguments; the new ones are optional | ✓ | `rolls.test.ts` passes (only the U9 access assertion changed, approved); `tests/e2e/dice.spec.ts` |
| E4 applyDamage unchanged without `negateMinor`, plain damage writes no row | ✓ | `session-features.test.ts` "plain damage is unchanged and unlogged (E4)" |
| E5 Rally and Prayer chips and the class counters render as before | ✓ | `lunar-phases-render.test.tsx` chips tests; `tests/e2e/class-features.spec.ts` (F3 ran it unchanged) |
| E6 derived Evasion and thresholds unchanged without a moon die | ✓ | `derived-moon.test.ts` "a sheet without a die is unchanged (E6)" |
| Plan rule: no second copy of a rule | GAP G4 | `scopeOf` in `convex/rolls.ts` and `convex/sessions.ts`, plus `featureScope` in `convex/sessionFeatures.ts` (F1 question 3) → dcm-bxp.68 |
| Plan rule: authz-matrix entries (D12) | follow-up | dcm-bxp.64 (the per-tracer role tests exist; `tests/convex/authz-matrix.test.ts` does not yet) |

Summary: 23 rows hold, 4 gaps (G1-G4) are filed, and the D12 matrix is a follow-up. No bug blocks the flow, so there is
no `test.fixme`.

## Beads filed (parent dcm-bxp)
- **dcm-bxp.62** (P3): Weapon Specialist rerolls 1s on Slayer Dice (CB p.48). Out of scope; the user specifies it
  first.
- **dcm-bxp.63** (P3): Martial Preparation gives allies a Slayer Die (CB p.48). Out of scope; the user specifies it
  first.
- **dcm-bxp.64** (P2): D12 authz-matrix entries for every session-features function:
  - new: `rolls.storeSlayerDie`, `rolls.pendingChoices`, `sessionFeatures.bumpMoonDie`;
  - changed: `rolls.actionRoll`, `rolls.damageRoll`, `rolls.manualRoll`, `rolls.tagTeamApply`,
    `characters.applyDamage`, `sessions.start` and `sessions.end`.
- **dcm-bxp.65** (P3, bug): G3. A Slayer store after a roll at Hope max that paid an Experience keeps the Hope.
- **dcm-bxp.66** (P3): G2. The dice box never names the automatic Waxing Moon +2.
- **dcm-bxp.67** (P4): G1. The Tag Team partner gets no confirmation after picking.
- **dcm-bxp.68** (P4): G4. Three copies of the campaign's FeatureScope helper.
- **dcm-bxp.69** (P4): F1 question 2, for the user: should the live card's idle and End-dialog texts name the new
  features?

## Notes
- **Seeding.** `sessionFeatures:seedForE2e` sets Mira's mastery and level. When Start rolled anything other than 1, it
  also sets her moon die to 1. Everything else goes through public APIs: manual rolls for fixed dice, and the dice box,
  damage calculator, Lunar Phases button, live card and feed Undo.
- **`slayerClaim`.** It stays on the sheet after End. This is harmless: it names a roll that can no longer be the latest
  live roll of a new session, so no store can reuse it.
- **No app code changed.** F4 owns only the spec and this doc.
