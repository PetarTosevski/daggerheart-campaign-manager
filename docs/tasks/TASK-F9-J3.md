# TASK-F9-J3: Small decided fixes (followups-9, tracer J3)

Plan: `.omc/plans/followups-9.yaml`, tracer J3. Beads: dcm-bxp.96 (b), .98, .99.31, .137. dcm-bxp.128.2 is NOT done (below).

## Done

### dcm-bxp.96 (b): addObject refuses kind and sprite together
`convex/combatMapEdit.ts`: `addObject` with both `kind` and `sprite` throws `INVALID` ("Pick an object or a sprite, not
both.") before anything is read or written. The old "`kind` is ignored" assertion in
`tests/convex/combat-map-edit-sprites.test.ts` is flipped into "refuses kind and sprite together with INVALID (G14b)",
which also checks that no object is placed.

### dcm-bxp.98: portrait is `null`, never absent
`convex/lib/combatVision.ts` (`otherIdentity`): every non-PC token without art (custom token, adversary without art,
unknown adversary, unknown ref) sends `portrait: null`. The validator already accepted `null`. Tests updated: the R4 key
test in `tests/convex/combat-vision.test.ts` now expects the `portrait` key, and
`tests/convex/combat-vision-sprites.test.ts` (lines 277-278) asserts `portrait` is `null` instead of absent.
That second file is not in J3's `owns`; the change is the direct consequence of the answer and was needed to keep
`pnpm test` green (see the report).

### dcm-bxp.99.31: CA-CA6 matches the docked fan
`tests/e2e/visual/CA-CA6.spec.ts`: the card result is read inside the docked hand region (above the fan) at 1440 and at
390, instead of in the phone sheet's Hand tab. Use is pressed by focus + Enter on the raised card (the WCAG 2.5.7 way
the fan's own spec uses), the vault is opened with "Open vault, 1 card" before Recall, and the sheet-tab click in the
exhausted-card test is gone. The phone shot is now `hand-dock-390.png`.

### dcm-bxp.137: D11-N7 and D11-N8 find their regions
Root cause: not a label change. `shoot` screenshots at 1440 and then 390, and at 390 the journal index hides behind its
"Pages" toggle (N9), so 'Torn-out pages', 'Players’ journals' and 'Past journals' are not visible. Both specs now use
a `shootInIndex` helper that opens the toggle when it is collapsed, then shoots each viewport. No check was weakened.

## Not done: dcm-bxp.128.2 (per-email e2e sign-up code)
Convex Auth calls `provider.generateVerificationToken()` with no arguments (`signIn.js`: the code is generated before
the verification row is created), so `convex/lib/authEmail.ts` cannot derive a code from the email. The verify lookup is
by code hash alone (`withIndex("code")` + `unique()`), so two pending accounts need distinct codes. A fix needs the
email at generation time, which means a change in `convex/auth.ts` (for example, `withAuthErrors` records the email of
the current sign-up before `inner(params, ctx)` and the generator reads it), or deleting the other pending code on the
replace-unverified path. `convex/auth.ts` is not in J3's `owns`.

## Checks
`pnpm lint`, `pnpm typecheck`, `pnpm vitest run` (all pass after the fixes above), the three visual specs with
`E2E_VISUAL=1` (CA-CA6 x2, D11-N7, D11-N8: 4 passed).
