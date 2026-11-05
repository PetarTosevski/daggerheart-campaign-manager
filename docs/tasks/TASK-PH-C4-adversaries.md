# TASK-PH-C4: Adversaries (GM)

Tracer C4-adversaries. Worktree
`/Users/nikolablagoevski/Desktop/Nikola_Random/daggerheart-phone-c4-adversaries`.
Not committed.

## What changed

The GM Adversaries section (`apps/mobile/src/features/adversaries/`) ports the
website page `src/app/(gm)/campaigns/[campaignId]/adversaries/page.tsx` to the
phone with the same three tabs:

- **Catalogue**: the SRD catalogue the campaign can use (`adversariesFor`), with
  search, tier, type and book chips, A–Z or book order, tier groups paged 40
  then +60 (`src/lib/adversaries/catalogue.ts`). Tapping an entry opens its
  stat block with "+ Add to encounter" (a sheet: encounter or a new one, count
  or Minion group size, Summoned; `encounters.create` / `encounters.addAdversary`)
  and "Duplicate & edit" (`fromSrd` → `customAdversaries.create`, then the
  editor opens). Below it, **Custom adversaries** (`customAdversaries.list`):
  "+ New custom adversary" (`blank(1, "Standard")`), the selected stat block
  with Add to encounter, Edit and a two-tap Delete. The editor checks the draft
  with `validateCustom` and sends only the changed fields (`changedFields` →
  `customAdversaries.update`).
- **Encounters**: "+ New encounter" (party size from active characters in
  `characters.listByCampaign`), running and draft encounters, then ended ones
  20 at a time. The selected encounter (`encounters.get`) shows rename, Start /
  End / Delete, the Battle Points panel (`battlePoints`, party size stepper and
  the six CB p.197 adjustments with the suggested ones dashed, via
  `encounters.setBudget`), its adversaries with reorder and remove, notes, and
  "+ Add adversary" (catalogue and custom search). A running encounter shows
  the tracker inline: GM turn and End GM turn, GM Fear (`campaigns.fear`) with
  Spend Fear, and one card per adversary with HP and Stress steppers, damage
  through thresholds (resistant halves), Minion defeats, conditions, the
  spotlight counter, and the stat block (`encounterTracking.customBlocks` for
  custom blocks). HP, Stress, conditions, spotlight, End GM turn and Spend Fear
  carry optimistic updates when the client supports them.
- **Environment**: the SRD environments the campaign sees, search and tier/type
  chips, the selected stat block with "Spend N Fear" and "Start countdown"
  (`environmentActions.spendFear` / `startCountdown`), and its Potential
  Adversaries opened above the list with the catalogue's actions.

One `encounters.list` subscription at the screen level feeds the builder and
every "Add to encounter"; one `encounters.get` feeds both the builder detail and
the inline tracker.

`apps/mobile/app/campaign/[campaignId]/(gm)/adversaries/[encounterId].tsx`
(`EncounterRoute`) keeps its GM gate and mounts `EncounterScreen`, the focused
tracker for that encounter (Start for a draft or ended one). Players still land
on the dashboard from both routes and never subscribe to a GM function.

Harness tests in `apps/mobile/test/features/adversaries/adversaries.roles.test.tsx`
cover the player gate on both routes, the GM tabs and their subscriptions,
catalogue search and Add to encounter, creating an encounter, a tracker HP
intent, a draft encounter, the Environment tab and the focused encounter route.
`test/shell/adversaries.test.tsx` and the encounter tests in
`test/shell/gm-stubs.test.tsx` now expect the built screens.

Not ported from the website: the combat-actions panel (AA3: targets, attacks,
reaction windows, live map pane), tags and per-instance notes editing, "+ Fear"
and Undo of an environment Fear spend (those use functions outside this
tracer's list), and the Sessions hub deep link (`?tab=encounters&encounter=`).

## Commands

Node v24.22.2 and pnpm 10.8.0, from the phone worktree.

| Command | Result |
| --- | --- |
| `pnpm --filter @dualityheart/mobile run check` | Exit 1 on Node v24.22.2. ESLint and `tsc --noEmit` passed. Jest: 56 of 58 suites passed when the world suite fails to load; with a local Reanimated mock fix (not in this tracer's files), 57 of 58 suites pass and `test/features/world/view.roles.test.tsx` fails four tests with `Duplicate subscription campaigns:get` (world harness / provider nesting; outside this tracer's files). All adversaries-related suites pass. |
| `pnpm exec jest --ci test/features/adversaries test/shell/adversaries.test.tsx test/shell/gm-stubs.test.tsx` | Exit 0. 3 suites, 16 tests passed. |
| `pnpm exec vitest run tests/convex/codex.test.ts` | Exit 1. 23 passed, 1 failed: `map pins: only existing tokens, region from the pin, hidden tokens never reach players` (`gmView.entries[0]` had `tokenId: null`, `region: ""`, `regionAuto: false` vs expected pin link). This tracer did not edit that file. |

## Not done

No commit, no push, no merge.
