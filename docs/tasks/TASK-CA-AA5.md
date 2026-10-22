# TASK AA5: Combat Map - GM adversary controls and hit visuals

Plan `.omc/plans/combat-actions.yaml`, tracer AA5 (wave 7.6, depends on AA2, CA5; built on rebuild dd704d6 with AA2b,
AA3 and AA4). Server API: `docs/tasks/TASK-CA-AA2.md`, additions in `TASK-CA-AA2b.md`. Status: Review.

## What landed

| File | What |
|------|------|
| `src/components/combat-map/actions/adversary/index.tsx` | `AdversaryPanel` (GM column, Play): the GM's own PCs' incoming-hit prompt, then the "Adversaries" card with the controls (loaded with `next/dynamic`, CL8: they carry the SRD stat blocks). Re-exports `HitFlashLayer`, `AdversaryResolutions`. |
| `adversary/controls.tsx` | `AdversaryControls`: the open reaction windows with "Resolve now", then the selected adversary token's "Acting for" head (HP / Stress, Done), the range and sight list, and the Encounter tab's own `ActionPanel` (targets, Normal / Advantage / Disadvantage, Experience, attack reactions, Attack, feature Use, the "Spend N Fear?" question, the result and offers) over `useAdversaryActions`. 3D dice like the tracker. |
| `adversary/model.ts` | Pure: `parseActionRow` (AA2's public action text), `newActionFlashes`, `adversaryResolutionsOf`, `rangeRows`, `attackBand`. |
| `adversary/sight.ts` | `sightOn(layout)` / `useLiveSight`: line of sight and cover on the live map's layout with CA1's `lineOfSight` (walls, painted blockers, sight-blocking objects; built-in sprite traits). |
| `adversary/flash.tsx` | `HitFlashLayer`: a flash on every PC token an adversary action names, for both roles. |
| `adversary/resolutions.tsx` | `AdversaryResolutions`: the GM's adversary rows with Undo (optimistic, as CA5's). |
| `adversary/part-boundary.tsx` | Error boundary per part (rule 11). |
| `adversary/adversary.css` | `cmx-*`; the tracker's `--adv-*` tokens pointed at the board's `--cm-*` ones; the flash keyframes (reduced motion: fade only). |
| `actions/index.tsx` | `Resolutions` mounts `AdversaryResolutions` between the GM's Hand and CA5's Resolutions (AA4's slot comment replaced); re-exports `GmOwnHits`. |
| `actions/reactions/index.tsx` | `GmOwnHits`: AA4's prompt (`PendingHits` + the death-move modal) for each character the GM owns; `IncomingHit` and it share `OwnHits`. |
| `actions/reactions/prompt.tsx` | `HitBoundary` logs the caught error. |
| `actions/reactions/reactions.css` | In the GM column the owed prompt stays in the column at phone width (no bottom sheet over the controls). |
| `tests/unit/adversary-panel.test.tsx` | 14 tests. |
| `tests/e2e/combat-adversary.spec.ts` | 2 specs (below). |
| `tests/e2e/visual/CA-AA5.spec.ts` | Shots at 1440 and 390 in `test-results/visual/CA-AA5/`. |

No server file, schema, validator or page file changed. Imports (read) from AA3's `src/components/adversaries/tracker/`:
`ActionPanel`, `useAdversaryActions`, `ReactionWindows`, `useTargetData`, `useLiveMap`, `targetOptions`, `spotlightNote`,
`rulesFor`, and its `tracker.css` / `catalogue.css`.

## User answers implemented (quoted from the plan)

- **2026-10-22** "a PC the GM owns gets the same incoming-hit prompt in the GM column on the map (AA4's prompt
  component)": `GmOwnHits`, first in `AdversaryPanel`. The players' characters are not listed there (their players
  answer; the GM has "Resolve now").
- **Q12** "GM can use the encounter tab to use abilities, they will show up on combat, he can also use combat map if he
  wants" and **Q16**: the map panel is the Encounter tab's panel and hook, so both pages send the same `attack` /
  `useFeature` intents and show the same result; the window opened from the map shows on the Encounter tab (e2e).
- **Q19 (a)** "Fear spent only on the GM's tap; Fear-cost features and a second spotlight ask first; optional ones are a
  one-tap prompt defaulting to No": the server's `confirmFear` is asked as "Spend N Fear?" (e2e: Fear stays 3 until the
  tap, then 2); offers are Yes / No.
- **Q17 (a)** "the GM can 'Resolve now' anytime; no timer": the windows list in the card.
- **Q18 (a)** "with no live map the GM targets PCs from the party list with no range or line-of-sight restrictions":
  `targetOptions` as on the Encounter tab; the range list shows only with the adversary on the live map.
- **Q2** (line of sight required, cover disadvantage; CB p.104 "You have line of sight if you can see the target"): each
  PC on the live map is listed with its Defined Range band from the adversary (CB p.103), "In sight" / "Cover:
  disadvantage" / "No line of sight", and "beyond Club (Melee)" when the attack's printed range doesn't reach (adversary
  attacks are not refused for range: TASK-CA-AA2 "No range check (the GM sanctions their own actions)"). A PC out of
  sight is not offered as a target; the server checks sight again.
- **Q14 / U1**: the panel is GM-only (`role !== "gm"` renders nothing). Players get only the flash ("Hit" / "Miss") and
  the feed's public row.
- **U4**: the adversary resolutions with Undo (the whole group: sheets, instances, Fear; open hits are called off).

## Player vs GM

- **GM** (GM column, Play): own PCs' prompts; the "Adversaries" card: "Select an adversary token on the map…", or with
  a token selected, "Acting for Bandit", ranges, the controls. Selecting a PC token afterwards keeps acting for the
  adversary (the token card and the Hand follow the PC); "Done" stops. Without a running encounter: "No encounter is
  running…". In Resolutions: "Adversary actions" with the GM rows (roll, Evasion, damage, marks) and Undo.
- **Player**: nothing new in the column. On the map, every adversary action that names their party's PC tokens flashes
  them (Hit red ring, Miss grey dashed ring, a feature without a roll violet "!"); the mini feed already lists the public
  row ("Bandit hit Mira"). No numbers.
- **Both pages**: the flash is driven by the public action row in `feed.list` (the same subscription as the mini feed /
  the GM's Resolutions), so an attack from the Encounter tab flashes on the map too (e2e). Rows already in the feed when
  the map opened don't replay; each flash plays once (1.8 s) and is removed on `animationend`.

## Visual check (1440 and 390)

The board has no adversary controls. Compared with `node scripts/board-shots.mjs combat:gm-play`
(`test-results/visual/board/combat-gm-play-*.png`): the card uses the GM column's `cm-card` (Cinzel `cm-h`, letter-spaced
`cm-lbl`, field-coloured rows like the Maps card, the board's 44 px buttons); the tracker's controls take the dark card
palette (pressed chips light on dark, the stat block's red attack strip, Fear violet). Shots checked: `panel-*`,
`result-*` (windows, result, features), `flash-*` and `flash-closeup-*`, `gm-prompt-*`, `resolutions-*`, `page-*`.
Fixed after the first shots: at 390 the GM's own PC prompt docked as a bottom sheet over the Attack button; it now stays
in the column for the GM. No horizontal scroll at 390.

## Checks

- `pnpm lint` (changed files), `pnpm typecheck`: clean.
- `vitest run --maxWorkers=4 --testTimeout=60000`: 283 files, 7571 passed, 1 expected fail.
- e2e (ports 3102 / 3316, `E2E_REUSE_SERVERS=1`): `combat-adversary.spec.ts` 2 passed (also 3x repeated);
  `visual/CA-AA5.spec.ts` passed (axe: no serious violations on the panel at 1440 and 390 and on the GM's prompt; 44 px
  touch targets at 390). Combined run with `incoming-hit`, `encounter-actions` and every `combat-*.spec.ts`: 33 passed
  plus the visual spec once its shot order was fixed (a shot with `animations: "disabled"` ends the flash).
  1. The GM selects the Bandit token, sees "Mira Melee In sight" and "Rook Close In sight beyond Club (Melee)", selects
     Mira's token (still acting for the Bandit), attacks Mira; the roll, "Mira Hit N damage waiting for answers", the
     window and a hit flash show; the Encounter tab shows the same window; Mira's player sees the flash, "Bandit hit
     Mira" in the mini feed and the prompt, marks an Armor Slot; the windows close; Undo on the GM's row restores
     Mira's Armor and HP.
  2. 390 px: an attack on Rook (the GM's PC) made by the server call the Encounter tab uses flashes on the map; the GM
     answers Rook's prompt in the GM column (Don't); Roar asks "Spend 1 Fear? 1 for the feature." and spends on the tap.
- `pnpm tracer:guard .omc/plans/combat-actions.yaml AA5`: OK.

## QUESTIONS

1. **Flash source**: the flash reads the public row's text ("Bandit hit Mira; missed Tabby") and matches PC token names,
   since public rows carry no target ids (AA2's `publicText`, Q14). A structured field (e.g. `targets` on the public
   adversary row, ids only, no numbers) would be sturdier against names with ", " in them. Wanted (AA2c / server)?
2. **Adversary targets** (allies of a feature, an adversary hit by another) don't flash: `combatTokens.party` holds PC
   tokens only, which is all a player may read. Flash adversary tokens for the GM too?
3. **Client line of sight**: an uploaded sprite counts as its Classic kind in the range list (the layout has no upload
   traits); the server decides on the attack. Fine as a hint?
4. **AA3b**: the map reuses AA3's `ActionPanel`; AA3b's choices dialog (featureAsk) will show here once it lands, as long
   as `ActionPanel`'s props stay the same (AA3b may need to pass `campaignId`).
5. **Intermittent "The incoming hit failed to load."** (AA4's `HitBoundary`) seen twice while the host was heavily
   loaded (load average ~20): once in the GM column, once in a player's column, right after an attack opened a window.
   Not reproduced in later runs (combined run of 34 specs, 3x repeats). `HitBoundary` now logs the error
   (`componentDidCatch`) so the next occurrence shows its cause; it stays failed until "Try again". Should the prompt
   retry on its own (a transient `pending` error would otherwise hide an owed prompt)?
