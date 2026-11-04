# TASK DA11: Purposeful Design records the chosen Experience and adds +1

Plan `.omc/plans/drawer-answers.yaml`, tracer DA11 (bead dcm-bxp.99.19.18, rule question A4). Book pages are printed
pages (CB = Core Book).

CB p.53, Clank, Purposeful Design: "Decide who made you and for what purpose. At character creation, choose one of your
Experiences that best aligns with this purpose and gain a permanent +1 bonus to it."

User answer 2026-10-29: the sheet records the chosen Experience and adds +1 automatically.

## What was built

| Piece | Where | What |
|---|---|---|
| Stored choice | `experienceSchema` (`src/lib/validation/characters.ts`), `experienceValidator` (`convex/lib/validators/characters.ts`) | `purposefulDesign?: true` on the chosen Experience. The field is optional and added by widening only, with no version bump, so stored sheets parse unchanged (rule 7). The stored `value` is never bumped. |
| The +1 | `experienceValue` / `experienceBonus` (`src/lib/domain/dice/index.ts`) | `experienceValue(e)` is `value + 1` on the recorded Experience. `experienceBonus`, used by every server roll (`convex/lib/rolls.ts` duality rolls and `convex/lib/cardRunner.ts` card rolls), sums `experienceValue`, so those callers needed no change. |
| Who holds it | `holdsPurposefulDesign(ancestry, scope)` (dice) | Answered through `owned()`: a Clank, a mixed ancestry whose first feature comes from the Clank (CB p.71: "You must choose the first feature from one ancestry and the second from another"), or a Shapeshifter whose chosen form feature is Purposeful Design. |
| Wizard | `wizard-logic.ts`, `steps-5-9.tsx` | `purposefulExperience: 0 \| 1 \| null` in the state (restored from the stored draft and cleared when the ancestry stops giving the feature). On step 7 a Clank sees a radio pair "Purposeful Design: <Experience>", and the step stays incomplete until one is picked. The chosen Experience shows +3. The draft sends `purposefulExperience` only for a holder. |
| Server create | `sheetFromDraft` (`convex/characters.ts`) | Sets `purposefulDesign` on the chosen Experience. A draft that names an Experience without holding the feature is refused with `INVALID`. |
| Pick once on the sheet | `characters.choosePurposefulDesign` (keyed user mutation, `ctx.once`, need edit through `editable`) | For Clanks created before DA11 or without the choice. Refusals: `FEATURE_NOT_OWNED` (the sheet doesn't hold the feature), `NOT_FOUND` (no such Experience), `INVALID` (an Experience is already chosen). |
| Whole-list writes | `updateSheet` | Accepts `purposefulDesign` in the list, so a list read from the sheet can be sent back, but ignores it: the flag stays on the Experience the sheet already recorded and can't be moved or added this way. |
| Sheet | `sections/identity.tsx` | Every Experience modifier shows `value + 1` for the chosen one. The editor's field shows and takes the total and saves the stored value without the +1. A line "Purposeful Design: +1 to X (included above)" is shown. A Clank with no choice gets a select and a "Choose" button (`PurposefulDesignPick`), and the level-up preview adds the +1 too. |
| Roll controls | `combat-map/actions/roll-controls` | The Experience chips show `experienceValue`. |
| Effect entry | `ancestry-core.ts` | The entry is no longer a reminder: a passive use with no mods and no steps. |

## Tests

- `tests/unit/purposeful-design.test.ts`: `experienceValue`, `experienceBonus`, the widened schema, holders (single, mixed, Shapeshifter) and the entry without a manual step.
- `tests/convex/purposeful-design.test.ts`: wizard choice → stored flag with value 2 → a manual roll totals +1; draft refusals; mixed ancestry; pick once on the sheet (`FORBIDDEN` / `NOT_FOUND` / `INVALID` / `FEATURE_NOT_OWNED`, replay); whole-list write; an old sheet reads back.
- `tests/unit/wizard-logic.test.ts`: gating, normalisation, draft and restore.
- `tests/convex/authz/characters.entries.ts`: `choosePurposefulDesign` row (`own`).
- `tests/e2e/character-wizard.spec.ts`: a Clank picks Bodyguard and the sheet shows +3 / +2.
- `tests/unit/feature-effects/ancestry-core.test.ts` (outside `owns`, see below): the old "manual note" assertion now checks the empty steps.

## Outside `owns`

- `tests/unit/feature-effects/ancestry-core.test.ts`: its Clank test asserted the manual reminder that the acceptance removes. One assertion changed. Tracer-guard flags this file.
- Not changed: `src/components/party/dice/dice-box.tsx` (the party dice box's Experience chips) still shows the stored value (`+{e.value}`), while the roll itself adds the +1 through `experienceBonus`. Its label needs `experienceValue` in a follow-up.

## QUESTIONS

1. **Can the choice be changed later?** CB p.53: "At character creation, choose one of your Experiences … and gain a
   *permanent* +1 bonus to it." Built: picked once (wizard or sheet); `choosePurposefulDesign` refuses a second pick
   for the owner and the GM alike. Should the GM be able to move it (a correction)?
2. **Removing the chosen Experience.** Built: removing it removes the +1 with it, and the sheet then offers the pick
   again, because no Experience is recorded. Should the +1 be lost for good instead, or should removing that
   Experience be refused?
3. **Level-up cap.** Built: the level-up cap of +10 on an Experience (`MAX.experience`) checks the stored value, so the
   chosen one can reach +11 with the bonus. Should the cap count the +1?
