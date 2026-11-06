# TASK-CONFIG-U6f: Character wizard and custom frame drafts on the account

Plan `.omc/plans/config.yaml`, tracer U6f (bead dcm-jh6d.25). Q15 b: a half-made character (one per campaign) and a
half-made custom frame are kept in `userDrafts` (`convex/drafts.ts`, P2), so the user can pick them up on another
device. The look is unchanged. The half-done level-up stays in the open tab (N4 a). IMP (moving old browser drafts to
the account) is not built, so an old localStorage draft is left alone and the account starts empty.

## What changed

- `src/app/(gm)/campaigns/[campaignId]/party/new/draft.ts` (new):
  - `useAccountDraft(scope)` reads `drafts.get` and returns `{ stored, save, flush, clear }`.
    - `save(value, { typed })` writes `drafts.save` with `schemaVersion: 1`. A typed change is debounced by
      `DRAFT_DEBOUNCE_MS` (1 s after the last change). A click saves at once and also sends any waiting typed change.
    - `flush()` sends a waiting save now.
    - `clear()` drops any waiting save and calls `drafts.clear`.
    - A draft over `DRAFT_MAX_BYTES` is not sent. A failed save is dropped, and the next change saves again.
    - Every save runs from a change handler, never from an effect (rule 13).
  - `parseDraft(stored, schema)` checks two things with zod: the envelope has `schemaVersion` 1, and `data` is JSON
    of the right shape. It returns null otherwise, so a rejected draft is ignored and the form starts empty instead
    of crashing.
  - `wizardDraftSchema`, `wizardFromDraft`, and `isTypedWizardPatch` (the typed fields are name, pronouns,
    description, mixed name, experiences, background, connections and Ikonis).
- `wizard.tsx`:
  - `CharacterWizard` waits for `drafts.get`. While it loads, it shows an empty `wz-paper` with `aria-busy`. It then
    mounts the wizard with the parsed draft as its initial state. There is no `key=` and no effect that copies state.
  - `update` saves from the handler.
  - "Start over" and a successful "Create character" call `drafts.clear`.
  - Both Cancel links flush a waiting save.
  - The localStorage `loadDraft`/`saveDraft` and the save effect are gone.
- `src/app/(gm)/new/custom-frame-form.tsx`:
  - `useCustomDraft()` returns `[draft, update, clear]`. The form shows the stored draft (parsed with
    `customDraftSchema`; text is not trimmed) until the user changes something. After that, local state holds the
    draft. This is derived during render, with no hydrate effect.
  - Name, pitch, themes and touchstones are debounced. Tones, background, party size and tier save at once.
  - `clearCustomDraft` and the localStorage key `dh.customDraft` are gone.
- `tests/unit/account-drafts.test.tsx` (new) covers:
  - the parser: version, broken JSON, wrong shape, not an object
  - typed vs click patches
  - the 1 s debounce, immediate saves and flush
  - clear dropping a waiting save
  - the size limit
  - `useCustomDraft` showing the stored or empty draft, saving, and clearing on create, with localStorage untouched.

## Why clicks save at once

The rulebook asks for no save on every keystroke. Clicks are rare, and saving them at once means a reload right after
a choice still has the choice. The existing e2e "an unsent draft survives a reload" checks a class and reloads at
once. Typing waits 1 s.

## Out of owns (orchestrator OK'd)

- `src/app/(gm)/new/frame-select.tsx`: two lines. `const [draft, setDraft, clearDraft] = useCustomDraft()` and
  `onCreated: clearDraft`, replacing the removed module-level `clearCustomDraft`. Clearing now needs the
  `drafts.clear` mutation hook.

## Notes

- `wizard-logic.ts` (reads only) still says "(and in localStorage)" in the `WizardState` comment. A later tracer
  that owns it can fix the comment.
- No localStorage read or write is left in the owned files.
- The new-character page needs `drafts.get` to load before the wizard shows. A load error goes to the route's
  `error.tsx`.

## Checks

- `pnpm typecheck` passes, and `pnpm lint` reports nothing. `pnpm tracer:guard .omc/plans/config.yaml U6f` is OK.
- vitest: `tests/unit/account-drafts.test.tsx` passes 11 of 11. The full suite passes: 552 files, 11884 tests.
- e2e on ports 3985 / 4085: `character-wizard.spec.ts` passes 5 of 5. The campaigns, motherboard-ikonis,
  a11y-entry, a11y-party and party-roster specs pass 41 of 41.
