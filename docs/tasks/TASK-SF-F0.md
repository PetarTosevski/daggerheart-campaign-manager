# TASK-SF-F0: Session features foundation

Status: Review. Plan: `.omc/plans/session-features.yaml`, tracer F0 (wave 1, foundation, no dependencies). Bead: `dcm-bxp.58`.
Rules: K1-K7, U1-U9, ANSWERED Q1 and E1-E6 in the plan header (all binding).

## Goal
Sheets carry the optional `sessionFeatures` object, and a pure, tested module answers who holds each feature, every pool
change, the moon phase and its effects, and the session start and end transforms, with the moon die already reflected in
derived Evasion, thresholds and the damage-roll options.

## Book rules, re-checked (printed pages)
Checked 2026-10-21 against the extracted text of `.reference-private/` (Core Book cards PDF and the Hope & Fear book); in
the extraction each "PAGE N" block ends with the printed page N-1 in its footer.

- **K1 Luckbringer** (Halfling ancestry feature, CB p.64, block 65, footer "64 Chapter 1: Ancestry"): "Luckbringer: At
  the start of each session, everyone in your party gains a Hope."
- **K2 Slayer** (Call of the Slayer foundation feature, CB p.48, block 49, footer "48 Chapter 1: Class"): "Slayer: You
  gain a pool of dice called Slayer Dice. On a roll with Hope, you can place a d6 on this card instead of gaining a Hope,
  adding the die to the pool. You can store a number of Slayer Dice equal to your Proficiency. When you make an attack
  roll or damage roll, you can spend any number of these Slayer Dice, rolling them and adding their result to the roll.
  At the end of each session, clear any unspent Slayer Dice on this card and gain a Hope per die cleared."
- **K3 Know the Tide** (Seaborne community feature, CB p.77, block 78, footer "77 Chapter 1: Community"): "When you roll
  with Fear, place a token on your community card. You can hold a number of tokens equal to your level. Before you make
  an action roll, you can spend any number of these tokens to gain a +1 bonus to the roll for each token spent. At the
  end of each session, clear all unspent tokens."
- **K4 Lunar Phases** (Moon mastery feature, HF p.17, block 18, footer "17 Chapter 1: Classes"): "At the beginning of
  each session, roll a d6 and place it on this card. You gain the matching effect until the end of session. Roll Phase
  Effect 1 New Spend a Hope to negate Minor damage. 2 – 3 Waxing + 2 to damage rolls 4 Full + 3 to damage thresholds
  5 – 6 Waning + 1 to Evasion Once per rest, you can spend a Hope to increase the value of this die by one. If you
  increase the value of a 6, it becomes a 1." Moon is a Witch subclass (HF p.16, block 17: "WITCH SUBCLASSES Choose
  either the Hedge or Moon subclass.").
- **K5** CB p.18 (block 19): "Any time you roll with Hope on your Duality Dice—meaning your Hope Die rolled higher than
  your Fear Die—you gain a Hope (to a maximum of 6)." CB p.90 (block 91): "A critical success counts as a roll with Hope
  … When you critically succeed on a roll, along with gaining a Hope, you also clear a Stress". CB p.99 (block 100):
  reaction rolls work "similarly to action rolls, except they don't generate Hope, Fear, or additional GM moves."
- **Q1 / Tag Team** CB p.97 (block 98): "choose one of the rolls to apply for both of your results. On a roll with Hope,
  all PCs involved gain a Hope. On a roll with Fear, the GM gains a Fear for each PC involved."
- **K7 multiclass** CB p.111 (block 112): "When you multiclass, you get to choose an additional class, select one domain
  from that class, and gain access to their class feature. … then choose a foundation card from a subclass of your
  choice." So a multiclass gives Slayer (a foundation feature) but never Lunar Phases (a mastery feature).
- **K7 Shapeshifter**: the creation wizard stores the kept form feature by its NAME (`wizard-logic.ts`:
  `{ kind: "shapeshifter", form, feature: s.shapeFeature }`, where `shapeFeature` is `f.name` of the form ancestry's
  features, `steps-1-4.tsx`). Luckbringer for a Shapeshifter = `form === "halfling" && feature === "Luckbringer"`.

## What was built
### Data (widen only; no SHEET_VERSION bump, no migration)
- `src/lib/validation/characters.ts`: `sessionFeaturesSchema` and `characterSheetSchema.sessionFeatures` (`.optional()`),
  type `SessionFeatures`, constant `SESSION_POOL_MAX = 10` (Proficiency and level both stop at 10):

  | field         | zod                           | meaning                                                         |
  |---------------|-------------------------------|-----------------------------------------------------------------|
  | `slayerDice`  | int 0..10, optional           | Slayer pool (unrolled d6s), capped at Proficiency when stored   |
  | `slayerClaim` | string 1..40, optional        | actionLog id of the roll whose Slayer choice was answered       |
  | `tideTokens`  | int 0..10, optional           | Know the Tide tokens, capped at level when placed               |
  | `moonDie`     | int 1..6, optional            | Lunar Phases die; absent = no phase                             |

- `convex/lib/validators/characters.ts`: `sheetValidator` gains `sessionFeatures: v.optional(v.object({ slayerDice?,
  slayerClaim?, tideTokens?, moonDie? }))` (numbers and string; zod keeps the ranges). No other validator changed shape.
- Old sheets without the field read as "no pool, no tokens, no die". A lowered Proficiency or level trims nothing; caps
  are checked when a die or token is added. The bump's once-per-rest mark is the existing `featureUses` entry
  `{ key: "lunarPhasesBump", until: "rest" }`, removed by any rest (`expire`).

### Pure module `src/lib/domain/session-features/` (import from `index.ts`)
All functions are pure; `T extends CharacterSheet` functions return the same type. Refusals throw `RuleError` with existing
codes (the Convex wrappers turn them into `ConvexError`): CLASS_FEATURE_RULE, DICE_RULE, NOT_ENOUGH_HOPE. `scope` is the
campaign's `FeatureScope` (as in class-features); omitted = everything allowed (`EVERYTHING`).

- `state.ts`: `featuresOf(sheet): SessionFeatures` (`{}` when absent); `withFeatures(sheet, patch)` merges, removes
  `undefined` members and zero pools, and drops an empty object.
- `holders.ts` (K7): `holdsLuckbringer(sheet)`, `holdsSlayer(sheet)`, `holdsTide(sheet)`,
  `holdsLunarPhases(sheet, scope?)`; constants `HALFLING`, `LUCKBRINGER`, `CALL_OF_THE_SLAYER`, `SEABORNE`, `MOON`,
  `EVERYTHING`.
- `luckbringer.ts` (K1, U1): `partyHope(activeSheets): number`; `applyLuckbringer(sheets) -> { sheets, hope, notes }`
  (every sheet +hope through `applyResourceDelta`, capped at `hopeMax`; note "Luckbringer (Pip, Rosa): everyone gains 2
  Hope").
- `slayer.ts` (K2, K5, U2, U3, U8): `SLAYER_DIE_SIDES = 6`, `WITH_HOPE`; `slayerCapacity(sheet)` (= Proficiency),
  `slayerDice(sheet)`; `canStore(sheet, outcome, kind)` (holder, action roll with Hope incl. critical, pool below
  capacity); `rollGaveHope(sheetBeforeGain, outcome, kind)`; `storeSlayerDie(sheet, { hopeGained, entryId })`;
  `spendSlayerDice(sheet, n)`; `clearSlayerAtEnd(sheet) -> { sheet, cleared, hopeGained }`.
- `tide.ts` (K3, U4, U5, U8, Q1): `WITH_FEAR`; `tideCapacity(sheet)` (= level), `tideTokens(sheet)`;
  `placeTideToken(sheet, outcome, kind) -> { sheet, placed }` (holder, ACTION roll with Fear, never a critical or a
  reaction, below the level cap); `spendTideTokens(sheet, n) -> { sheet, modifier }` (CLASS_FEATURE_RULE for a
  non-holder with n > 0, DICE_RULE above the held tokens); `clearTideAtEnd(sheet) -> { sheet, cleared }`.
- `lunar.ts` (K4, U6): `MOON_PHASES`, `LUNAR_BUMP_KEY`, types `MoonPhase`, `MoonPhaseKey`, `LunarBonuses`;
  `phaseOf(die)`, `moonDieLabel(die)` ("4 (Full: +3 to damage thresholds)"), `moonDie(sheet)`,
  `currentPhase(sheet, scope?)`, `lunarBonuses(sheet, scope?) -> { damage: 2|0, thresholds: 3|0, evasion: 1|0 }`,
  `rollMoonDie(sheet, rng)`, `endMoon(sheet)`, `bumpMoonDie(sheet, scope?) -> { sheet, from, to }`, `bumpUsed(sheet)`,
  `canNegateMinor(sheet, severity, scope?)`, `negateMinor(sheet, severity, scope?)` (spends the Hope or refuses).
- `session.ts` (U1, U6, U8): `sessionStartFeatures(activeSheets, rng, scope?) -> { sheets, notes }` (Luckbringer, then a
  moon die per holder; "Mira's moon die: 4 (Full: +3 to damage thresholds)"); `sessionEndFeatures(sheet) -> { sheet,
  notes }` ("Bryn cleared 2 Slayer Dice: +2 Hope", "Kai cleared 3 Tide tokens", "Mira's moon die ends").
- `dice-hooks.ts`: `WAXING_MOON_OPTION`, `waxingMoonOption(sheet, kind, scope?)`, `SLAYER_STORE_PROMPT`,
  `slayerStorePrompt(sheet, result)`; wired into `class-features/hooks.ts`.

### Shared code changed
- `src/lib/domain/characters/derived.ts`: `derivedDefense(sheet, installedAugments = [], scope?)` adds Waning's +1
  Evasion; `derivedThresholds(sheet, scope?)` adds Full's +3 to both thresholds. The sheet types accept the optional
  `sessionFeatures`; results for sheets without a moon die are unchanged (E6; every existing derived test passes).
- `src/lib/domain/class-features/hooks.ts`: `rollOptions` adds the auto damage option `{ key: "waxingMoon", label:
  "Waxing Moon +2", effect: modifier 2, auto: true }` for a Waxing die (Lunar Phases only in a `hopeAndFear` scope),
  between the class modules' options and the Rally Dice; `afterDualityRoll` appends the prompt `{ key: "slayerStore",
  featureKey: "slayerStore", text: "Take the Hope or store a Slayer Die?", choices: hope "Take the Hope", store "Store a
  Slayer Die" }` when `canStore(sheet, roll.outcome, roll.kind)`. Class modules and the Rally option are untouched.

## Acceptance evidence
- `tests/unit/session-features.test.ts`: every function above (holders per branch, two Halflings with a PC at Hope max,
  a critical stored as a Slayer Die keeping its cleared Stress, a store at full Hope, the 6 -> 1 bump, a second bump in
  the same rest, Tide tokens at the level cap, deterministic start with a fixed rng, end notes, both dice hooks).
- `tests/unit/derived-moon.test.ts`: each phase and a sheet without a die (E6), non-holders and no `hopeAndFear`.
- `tests/convex/session-features-sheet.test.ts`: a stored sheet without the field reads (readSheet and `characters.get`'s
  returns validator), one with it round-trips through `saveSheet`/`readSheet`/the view, out-of-range values are refused.
- `pnpm lint`, `pnpm typecheck`, `pnpm test` pass (counts in the tracer report).

## Notes for F1-F3
- F1: run `sessionStartFeatures` on the ACTIVE PCs' sheets after `onSessionStart`, in the campaign scope; compare each
  returned sheet with its input (same reference = unchanged). Run `sessionEndFeatures` per PC after
  `onSessionEnd(expire(sheet, "session"))`. The notes are ready for the report `features` lines and the log stamp.
- F2: `afterDualityRoll` already returns the `slayerStore` prompt (it reads the sheet AFTER the roll's gains; rolls.ts
  already passes `next`). For `storeSlayerDie`, derive `hopeGained` with `rollGaveHope(sheetAfterCostsBeforeGains, ...)`;
  the row's `before` is the sheet before the roll's costs, so an Experience paid with Hope matters (before 6, paid 5,
  gained back to 6 = a Hope was gained). Spend dice/tokens with `spendSlayerDice` / `spendTideTokens` BEFORE rolling;
  place tokens with `placeTideToken(next, roll.outcome, roll.kind)` after; for a Tag Team pass the CHOSEN roll's outcome
  with kind "action" for both participants. Slayer dice are d6 (`SLAYER_DIE_SIDES`).
- F3: chips read `slayerDice` / `slayerCapacity`, `tideTokens` / `tideCapacity`, `moonDie` + `phaseOf`. The Lunar
  section shows for `holdsLunarPhases(sheet, scope)`; `MOON_PHASES` has the names, ranges and effect text; the button
  disables with `bumpUsed`, no die, or 0 Hope. `applyDamage` uses `negateMinor(sheet, severityAfterArmor, scope)`.
  Pass the campaign scope to `derivedThresholds` / `derivedDefense` where it is known (default: allowed).
- The bump and negate use `featureUses` and plain Hope; they write nothing else.

## Questions
- `derivedDefense` / `derivedThresholds` take an optional `scope` (default: allowed) because existing callers (roster,
  sheet, `applyDamage`) have no campaign scope at hand. A moon die is only placed for holders in scope, so the default
  only matters when the GM turns `hopeAndFear` off mid-session; the die then still counts until the session ends unless
  the caller passes the scope. Reversible: callers can pass the scope.
