# TASK-CONFIG-R1: Players see the GM's Fear (off shows "?")

Plan `.omc/plans/config.yaml`, wave 3, tracer R1; briefs `.omc/plans/config-briefs.md` (R1 block, "User answers
2026-11-04" Q3 changed, "Questions 2026-11-05": defaults taken); bead dcm-jh6d.11. Mode: add. Server and client.

## The rule (Q3 changed, user 2026-11-04)

When `tableSettings.playersSeeFear` is off, every place that shows the GM's Fear pool to a player shows "?" and keeps
the Fear art. The server never sends a player the number: each read strips it. The GM (the creator) and every co-GM
(permission `owner` or better) always see it. When the setting is on (the book's default, CB p.154) nothing changes.
"Rolled with Fear" on a roll stays visible, because it is the die, not the pool.

One predicate decides this: `seesFear(campaign, permission)` in `convex/campaigns.ts` returns
`atLeast(permission, "owner") || resolveTableSettings(campaign.tableSettings).playersSeeFear`. The setting is read
from the campaign document the wrapper already loaded, so it costs no extra read. A change through
`campaignSettings.set` re-runs every one of these queries, so players see the "?" without reloading.

## Every Fear read checked (grep of `campaignFearState`, `campaignState`, `fearDelta`, `Fear` in summaries, `convex/`)

| Read | Who | Handling |
|---|---|---|
| `campaigns.fear` | every member | returns `number \| null` (`fearValueValidator`); null for a player while off. `enough: "owner"` so `ctx.permission` tells a GM from a player |
| `campaigns.list` (Load Campaign card) | the caller's campaigns | `fear: number \| null`. The creator always gets the number. Joined or invited cards with the setting off read the caller's permission (`campaignAccess`, only then), so a co-GM keeps the number and a player gets null |
| `combatHud.scene.fear` (HUD Fear banner, phone strip, spotlight disc) | every member | null for a player while off |
| `feed.list` | every member | for a player while off: no `fearDelta`, and the summary goes through `hideFearNumbers` |
| `journalLog.list` | every member | for a player while off: Fear history lines read "Fear changed" with no sub; feed and automatic (session stamp) lines go through `hideFearNumbers`. The GM's typed lines and re-wordings are the GM's own words and stay |
| `journalTally.tally`, `sessionPlay.tally` | GM only (`gmQuery`) | nothing to do |
| `history.list` | GM only | nothing to do |
| `adversaryActions` asks (`gmFear`), `combatEffects.fearEnds` cost | GM only | nothing to do |
| `combatFeatures` / `featurePrompts` / `combatAreas` / `combatCards` `gmFear` | mutations, internal to the run | never returned as a value |
| Lorekeeper context (`convex/lib/lorekeeper/context.ts`), Tome | never reads `campaignState` (guarded by `lorekeeper-context.test.ts`) | nothing to do |
| `restsReads` `last.fearRoll` / `fearGained` | every member | **outside owns**: the rest's Fear gain (a change, not the pool). Follow-up bead dcm-jh6d.62 |
| `rolls.actionRoll` result `fearGained` (0 = "already full") | the rolling player (mutation result) | **outside owns**. The dice box (owned) no longer says "already full" while the pool is hidden; it says "Rolled with Fear.". The mutation still returns the number. Follow-up bead dcm-jh6d.62 |
| HUD hand result "The GM gains N Fear" (`combat-map/actions/hand/result.tsx`, from the card mutation's `fearDelta`) | the acting player (mutation result) | **outside owns**. Follow-up bead dcm-jh6d.62 |

`hideFearNumbers(text)` (`convex/feed.ts`): "Fear a → b" becomes "Fear changed". "Fear (1d4 …)" loses its roll.
"N Fear", "+N Fear" and "(N Fear lost)" lose their numbers. "with Fear", the Fear Die ("Fear Die 4") and a Hope / Fear
dice pair ("Hope 5, Fear 3") stay.

## Client

- `src/components/combat-map/hud/fear/hidden.ts`: `FEAR_HIDDEN_MARK` "?", `FEAR_HIDDEN_LABEL` "Fear hidden by the GM",
  `fearShown(fear)`. These are shared by every surface.
- HUD Fear banner (`fear/banner.tsx`): with null it shows "?", empty pips labelled "Fear hidden by the GM", and keeps
  the flame and banner. The − / + steps never render with null. The optimistic step skips null.
- Phone strip (`hud/phone/strip.tsx`, outside owns): "?" with the label.
- Dashboard Fear panel (`fear-panel.tsx`): with null the spiral and tokens stay dark and read-only, and the core reads
  "?" with the label.
- Dice box (`party/dice/dice-box.tsx`): "GM Fear ?" and the neutral "Rolled with Fear." line.
- Load Campaign card (`campaigns/chronicle.tsx`, outside owns): "?" for null.
- `campaign-shell.tsx`: `useCampaignFear()` returns `number | null | undefined`. `WithFear` renders nothing for null,
  since every reader of it is a GM screen and the GM always gets a number.
- GM-only optimistic Fear updates skip a null: tracker, adversary actions, environment features, statblock acts,
  plus (outside owns) the statblock panel and the spotlight disc.
- Journal log model (`journal/log/model.ts`): no change needed. The "Fear changed" line keeps the Fear icon.

## Out-of-owns edits (orchestrator OK'd)

These come from the `number | null` type change, each one or two lines:
- `src/components/combat-map/hud/spotlight/disc.tsx`
- `src/components/combat-map/hud/statblock/panel.tsx`
- `src/components/combat-map/hud/phone/strip.tsx`
- `src/app/(gm)/campaigns/chronicle.tsx`
- `tests/convex/age-of-umbra.test.ts`, `tests/convex/lane4-e7-round4.test.ts`, `tests/e2e/adversary-actions-flow.spec.ts`,
  `tests/e2e/hud-answers.spec.ts`: a non-null assertion on the GM's Fear read

## Tests

- `tests/convex/fear-visibility.test.ts`:
  - GM, co-GM and player with the switch on, then off, then on again, for `campaigns.fear`, `combatHud.scene`,
    `campaigns.list`, `feed.list` and `journalLog.list`.
  - The leak check: nothing the player receives while off has a number next to "Fear" or a numeric `fear` /
    `fearDelta`, and "Agility 14 with Fear" stays.
  - `hideFearNumbers` cases.
- `tests/unit/fear-hidden.test.tsx`: the banner and the dashboard panel show "?" with the label and keep the art;
  the GM's optimistic step leaves null alone.
- `tests/e2e/fear-hidden.spec.ts`: the GM turns the switch off in Campaign settings. Without a reload, the player's
  banner shows "?" (with the flame) while the GM's still shows the number. The player's dashboard core then shows "?".
  Turning the switch back on brings the number back. Shots go to `test-results/config-r1/`.

## Decisions

- Fear changes (deltas) are hidden from players too, not only the pool, as the acceptance asks ("Fear changed"
  without numbers). A run of deltas would let a player rebuild the pool.
- The GM's own words in the session log (typed lines, re-wordings) are not rewritten.
- A co-GM's Load Campaign card keeps the number. The permission is read only for joined cards while the setting is
  off, so the common case costs nothing.
