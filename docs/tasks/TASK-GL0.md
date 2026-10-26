# TASK-GL0: Level-up draft, ribbon, navigation and finish

Status: Review. Plan: `.omc/plans/guided-level-up.yaml`, tracer GL0 (foundation for GL1–GL3). No server or schema change: `levelUp.apply` still takes one `LevelUpChoice`.

C = `src/app/(gm)/campaigns/[campaignId]/party/[characterId]`.

## What changed

- **Draft (`C/level-up-draft.tsx`):** `LevelUpDraftProvider` wraps the sheet (in `SheetBody`, `C/sheet.tsx`) and holds one level-up draft per character. `useLevelUpDraft()` reads and changes it (API below).
- **▲ starts the mode:** `LevelUpButton` (`src/components/party/level-up/index.tsx`) now takes `onStart` and `leveling`. The ▲ shows on the same condition as before (`canLevelUp` in `level-up/shared.ts`: owner with the GM's flag, or the GM, below level 10). It hides while the mode is on. The − undo and the GM's "Set level" did not change.
- **Stepper removed:** the `PaperModal` stepper (`level-up/stepper.tsx`) is deleted and its modal styles are gone from `level-up.css`. The `lu-opt` / `lu-chips` / `lu-panel` chooser styles stay for GL1–GL3. To read the old choosers (traits, Experiences, card selects, multiclass class/domain/foundation): `git show cda2114:src/components/party/level-up/stepper.tsx`.
- **Ribbon (`C/level-up-ribbon.tsx` + `.css`):** a region "Level-up to N" directly under the sheet header. It is an `sh-box`-style parchment strip with a Cinzel title, and is sticky (top 8 px) above 640 px, so Back/Next stay in reach while a step scrolls the sheet. At 640 px and below it sits in the page flow. It holds:
  - the tier achievement text (the old stepper's wording);
  - an ordered list "Level-up steps": one 44 px button per step, `aria-current="step"` on the current `li`, `data-done` plus a ✓ and an sr-only "(done)" when the step has no problems;
  - Cancel, Back and Next. On the Finish step, Next becomes "Finish level-up", which is disabled while problems remain or the call runs.
  - The Finish step adds a summary ("Your choices") and, under "Still to do", every `validateLevelUp` problem as a button that `goTo`s the place that fixes it. The `useIntent` error shows in a `role=alert` line.
- **Navigation:** `SheetBody` now holds the page tab and the Domains sub-tab. `PageThree` takes `tab` / `onTab`, so it is controlled.

## Hook API (`useLevelUpDraft()` from `C/level-up-draft.tsx`)

| Field | Meaning |
|---|---|
| `active` | The mode is on. The draft belongs to the sheet's current level, and the viewer can level (it turns false on undo, a GM correction or finish). |
| `canStart` | The viewer may start (the ▲ condition). |
| `level` | The new level (sheet level + 1). |
| `sheet` | The full `CharacterSheet` the draft is validated against, or null. |
| `draft` | `{ picks: PickChoice[], experienceName: string, cardId: string, trade?: {out, in}, multiclass?: MulticlassChoice }` |
| `choice` | The built `LevelUpChoice`. `experienceName` (trimmed) appears only at levels 2/5/8, `trade` only when both cards are set, and `multiclass` only with the multiclass pick. |
| `problems` | `validateLevelUp(sheet, choice)`, a `string[]` that is empty when Finish may run. |
| `issues` | The same problems as `{ message, target }`, where `target` is `"experiences" \| "advancements" \| "deck"` (exported `issueTarget`). |
| `picksUsed` | Picks used of the level's 2. Proficiency and multiclass cost 2. |
| `steps` | `{ id, label, done }[]` in book order: `experiences` (levels 2/5/8 only), `advancements` ("Advancements (n/2)"), `deck`, `finish`. |
| `step` | The current step id. |
| `pending`, `error` | State of the `levelUp.apply` call. |
| `start()` | Starts a fresh draft and goes to the first step. It does nothing when `!canStart`. |
| `cancel()` | Ends the mode and drops the draft (and the stored copy). |
| `finish()` | Calls `levelUp.apply` once (through `useIntent`) when there are no problems. It resolves `true` on success, and then the mode ends. |
| `setExperienceName(name)` | Sets the name (cut at 200, the server's limit; the engine allows 80). |
| `togglePick(option, tier, on?)` | `on` true adds a pick, false removes the latest of that option/tier, and omitted toggles. It adds only within the rules from `availableOptions`: not blocked, a free slot, and cost within 2 picks. `traits` / `experiences` / `domainCard` picks start with `targets: []`. |
| `setPickTargets(option, tier, targets)` | Sets the targets of the first draft pick of that option/tier, deduplicated and capped (2 traits, 2 Experience ids, 1 card id). |
| `setCardId(id)` | Sets the level's card (`""` clears it). |
| `setTrade({out, in} \| null)` | Sets or clears the exchange (CB 110). |
| `setMulticlass(mc \| null)` | Sets or clears the multiclass choice. |
| `goTo(step)` | Switches the page tab (and, for `deck`, Domains › "Domain Cards"), then after render scrolls the target into view (smooth unless `prefers-reduced-motion`) and focuses its first heading (adding `tabindex=-1` if needed). With no target element it focuses the page tab. `goTo` accepts every target, even one that is not a step at this level, such as `experiences` at level 3 for the "+1 to two Experiences" pick. The current `step` changes only to a listed step. |

Outside the provider, or for a viewer who cannot level, the hook returns an inactive value: empty draft, no steps, no problems, and actions that do nothing. Sections can call it unconditionally and render unchanged outside the mode.

The provider keeps `sessionStorage["dcm:level-up-draft:<characterId>"] = { v: 1, level, step, draft }` in step with the draft while the mode is on, and removes it otherwise. On mount it restores a stored draft whose `level` equals the sheet's level and that passes a zod check. Any other stored draft is removed. Every access is guarded by try/catch, so without storage the draft lives for the page only.

### Target ids (GL1–GL3 add them)

| Step | Page / sub-tab | Element id |
|---|---|---|
| `experiences` | Character Sheet | `#lu-target-experiences` (the Experiences `SheetBox`, GL2) |
| `advancements` | Story & Advancement | `#lu-target-advancements` (the tier boxes wrapper, GL1) |
| `deck` | Domains › Domain Cards | `#lu-target-deck` (the Domain Deck `SheetBox`, GL3) |
| `finish` | (the ribbon) | `#lu-ribbon-summary` (the summary heading) |

Put a heading inside each target, because `goTo` focuses the first `h1`–`h4` it finds. Above 640 px the ribbon CSS gives these three ids `scroll-margin-top: 200px`, so they land below the sticky ribbon.

## Defaults taken (open questions)

- `start()` goes straight to the first step's page: the Experiences at levels 2/5/8, else the tier boxes.
- The ribbon is sticky only above 640 px. At 390 it would cover about a quarter of the screen.
- No card is chosen by default. The old stepper pre-selected the first reachable card, but now the player picks one in the deck.
- Problems are linked to steps by their message text (`issueTarget`), because the engine returns strings. An unknown message goes to the advancements step.

## Verification

e2e ran on ports 3153/3418.

- `pnpm lint`, `pnpm typecheck`: clean.
- vitest: 103 files, 1075 tests passed. `tests/unit/level-up-draft.test.ts` has 12 tests, and `sheet-render` gained a ribbon test (11 tests).
- e2e passed: character-sheet (3), domain-deck (1), and `E2E_VISUAL=1` GL0 (1) and S8 (1).
- **e2e expected failure:** `tests/e2e/level-up.spec.ts` fails, because it drives the removed dialog. GL4 rewrites it.
- **e2e failures already there before GL0, from DD1:** both `E2E_VISUAL=1` S13 tests fail on the Domain Deck.
  - GM test: the "More about X" buttons are 37×44 at 390.
  - Player test: the player sees the deck's filter, More and card-back buttons, but the test expects no buttons other than the tabs.
  - The S13 pass with the ribbon open adds no small controls and no horizontal scroll.

Screenshots: `test-results/visual/GL0/ribbon-{1440,390}.png`, `ribbon-finish-{1440,390}.png`, `test-results/visual/S8/ribbon-*`.
