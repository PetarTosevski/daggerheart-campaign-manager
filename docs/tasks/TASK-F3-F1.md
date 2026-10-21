# TASK-F3-F1: Notes add row on the first write, notes-entries test 2, the 390 Pages disclosure in the older specs

Status: Review. Plan: `.omc/plans/followups-3.yaml`, tracer F1 (no dependencies). Beads: `dcm-bxp.102`,
`dcm-bxp.103`, `dcm-bxp.114` (left open for the orchestrator).

## What changed

| file | change |
|------|--------|
| `src/components/notes/entries/index.tsx` | `Entries` keeps the last answer of `notesEntries.entries` with the `pageId` it belongs to (React's "value from an earlier render" pattern: a `setState` during render, no effect, no copied props, no `key`). While the query loads and the previous answer was for a default page (`template-<i>`, or no page) and the new `pageId` is a written page, that answer stays on screen instead of 'Loading entries…'. So the first write on a default page, which creates the journal and turns `template-<i>` into the page id, no longer unmounts `AddRow`: focus stays in the input, the chosen bullet kind stays, text typed meanwhile is kept (dcm-bxp.102). Opening another written page still shows the loading line. |
| `tests/unit/notes-entries-ui.test.tsx` | Two tests: the first write on `template-0`, then the switch to `page9` with no answer yet: the same input element, focused, Hope still checked, the new row still shown, text typed while loading kept and sent to `page9`; and page1 -> page2 still shows 'Loading entries…' with no stale rows. The first test fails on the old `index.tsx`. |
| `tests/e2e/notes-entries.spec.ts` | Test 1 picks the Note chip, types the first entry with the keyboard, presses Enter and at once types `* pay the ferryman`: both rows land, the input stays focused, Note stays checked (the move-up step now moves 'pay the ferryman', same final order). Test 2: the GM opens the player's page through 'Players’ journals' (N8 `JournalView`, `Read-only page` article, first page 'Session 1' is `aria-current`) instead of `?page=` (dcm-bxp.103). A local `openIndex` (the N9 helper) makes it work at 390 too. |
| `tests/e2e/notes-a11y.spec.ts` | (added to F1's owns by the orchestrator) N9's workaround asserted the bug (focus dropped, tab back); now it expects focus kept in the input after the first write. |
| `tests/e2e/notes-bin.spec.ts`, `notes-journals.spec.ts`, `notes-sharing.spec.ts` | N9's `openIndex(page)` diff (TASK-D11-N9.md), applied unchanged (dcm-bxp.114). No timeouts raised. |

## Evidence

- vitest `tests/unit/notes-entries-ui.test.tsx`: 11 passed (the new dcm-bxp.102 test fails without the fix).
- Playwright (own servers on 3160 / 3432, `E2E_REUSE_SERVERS=1`, load average 16-36): full notes set
  (`tests/e2e/notes-*`, 27 tests, each multi-viewport spec at 1440 and 390): 26 passed, 1 failed on a Convex
  'Server Error' under load (notes-journals at 390); the rerun of notes-journals passed 2/2. Earlier runs under
  heavier load also hit sign-in redirects, a notes-shell title timeout (passes alone) and the bin tear-out test
  running out of its 30 s budget (it waits out a 10 s toast by design): that test now has `test.setTimeout(90_000)`,
  the only timeout raised.
- vitest full run: 2471 passed, 31 failed: 30 in `sprite-catalog.test.ts` / `sprite-builtin-pack.test.ts` (the catalog
  has 1169 entries, the tests expect 589; same on rebuild, outside F1) and `wizard-steps.test.tsx` hitting its own
  15 s timeout under load (passes on rerun).

## Notes

- The fallback covers one load only (template answer -> written page). `template-<i>` exists only while the caller has
  no journal, and the journal (with all default pages) is created by the first write, so the template -> page id
  switch is that first write; other journals (`JournalView`) always pass page ids.
