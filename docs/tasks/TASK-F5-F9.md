# TASK-F5-F9: Character field 'Gender' by default with a per-character toggle to label it 'Pronouns'

Status: Review. Plan: `.omc/plans/followups-5.yaml`, tracer F9 (no dependencies). Bead: dcm-bxp.35.

## What changed

| File | Change |
|---|---|
| `src/lib/validation/characters.ts` | `PRONOUNS_LABELS = ["gender", "pronouns"]`, `PronounsLabel`, `pronounsFieldLabel(flag)` ("Gender" unless the flag is `"pronouns"`). `characterSheetSchema` gains optional `pronounsLabel` (widened, no version bump: stored sheets parse unchanged). `sheetPatchSchema` picks it; `characterDraftSchema` takes it, optional |
| `convex/lib/validators/characters.ts` | `pronounsLabelValidator`; optional `pronounsLabel` on `characterDraftValidator`, `sheetPatchValidator` and `sheetValidator` (the query `returns`) |
| `.../[characterId]/sections/identity.tsx` | `PronounsField`: the label comes from the sheet flag. Anyone who can edit the sheet gets a `role="switch"` button (`aria-checked`, name "Label as Pronouns"); it calls the existing `updateSheet` with `{ pronounsLabel }` only, and shows the new label while it saves (local pending state, cleared when the mutation settles). Read-only viewers (players looking at someone else's sheet) see the stored label and no switch |
| `.../party/new/steps-1-4.tsx` | step 4: the label follows `state.pronounsLabel`; the same switch sits next to it |
| `.../party/new/wizard-logic.ts` | `WizardState.pronounsLabel` (default `"gender"`, restored from the saved draft); `toCharacterDraft` sends `pronounsLabel: "pronouns"` only when chosen, so default drafts are unchanged |
| `src/components/party/import/review.tsx` | the field reads "Gender" (the default label). No switch: the import draft cannot carry the flag without changing files outside F9 (below) |
| `tests/unit/identity-label.test.tsx` (new) | the label helper and the widened schema; the sheet field (default Gender, switch sends only the label, shows the new label while saving, Pronouns sheets, read-only views); wizard step 4 and the draft; the import review |

## How the flag is set

Through the existing sheet intent `characters.updateSheet` with the one-field patch `{ pronounsLabel }` (rule 12:
no whole-sheet write; the handler merges the patch into the stored sheet). No new mutation is needed.

## Needed outside F9's owns

1. `tests/unit/wizard-steps.test.tsx` line 72 expects the old default label:
   ```diff
   -    expect(screen.getByLabelText("Pronouns")).toBeInTheDocument();
   +    expect(screen.getByLabelText("Gender")).toBeInTheDocument();
   ```
2. `tests/e2e/character-wizard.spec.ts` line 60:
   ```diff
   -  await page.getByLabel("Pronouns").fill("they/them");
   +  await page.getByLabel("Gender", { exact: true }).fill("they/them");
   ```
3. `convex/characters.ts` `createCharacter` (sheet built at about line 260) drops the wizard's choice until it copies it:
   ```diff
        pronouns: draft.pronouns,
   +    ...(draft.pronounsLabel ? { pronounsLabel: draft.pronounsLabel } : {}),
        description: draft.description,
   ```
4. Optional, for a switch on the photo-import review: add `pronounsLabel: true` to the `importDraftSchema` pick
   (`src/lib/import/draft.ts`), `pronounsLabel: v.optional(pronounsLabelValidator)` to `importDraftValidator`
   (`convex/photoImport.ts`) and copy it in `sheetFromImport` (`src/lib/import/sheet.ts`); then the review can show the
   same switch over `draft.pronounsLabel`. Until then the review shows "Gender" and the sheet's switch relabels it.

## Acceptance evidence

- `pnpm lint`, `pnpm typecheck` clean.
- vitest (`--maxWorkers=4 --testTimeout=60000`): 225 files, 5455 passed, 1 expected fail, 1 failed: the
  `wizard-steps.test.tsx` step 4 assertion in item 1 above (not F9's file).
