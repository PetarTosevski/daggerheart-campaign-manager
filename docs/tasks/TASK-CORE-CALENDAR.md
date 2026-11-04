# TASK CORE-CALENDAR: core campaigns get the campaign calendar on the Combat HUD

User decision 2026-11-02: core campaigns (no campaign frame) get the calendar the frames have: "Week n · Day n", the time
of day, and **End day**. Answers TASK-HUD-HD1 open question 1 with (b). Branch `core-calendar`.

## Why core campaigns had no calendar

- The calendar is not a frame registry flag. Since lanes-2 CT (TASK-LN3-CT) every campaign counts days in its
  `campaignTime` row (created lazily by the first End day; no row = Week 1, Day 1), and `campaignTime.calendar` /
  `campaignTime.endDay` / the CT2 undo already ran for every `frameId`, `custom` (core) included. The registry flag
  `EXCLUSIVE_MECHANICS.witherwild: ["campaignTime"]` only adds the Witherwild's Day / Night arc and phases.
- The classic dashboard header already showed `CampaignDay` ("Week N · Day D" + End day) for every campaign without the
  arc, core included.
- The gap was the HUD: HD1's `combatHud.scene` returned `day: null` and `canOpenTimeArc: false` unless the frame had
  the `campaignTime` mechanic (HD1 acceptance), so the H1.2 disc showed only the light and the GM had no End day. That
  hit core and every non-Witherwild frame alike.

## What landed

| Piece | File | What |
|---|---|---|
| `combatHud.scene.day` | `convex/combatHud.ts` | Always the campaign day (`{ week, day, cycle }`, cycle "DAY" outside the Witherwild); the returns validator drops `null`. |
| `combatHud.scene.canEndDay` (new field) | same | The GM (owner) in every campaign, as `campaignTime.endDay`. `canOpenTimeArc` stays Witherwild GM only. |
| Disc lines / name | `src/components/combat-map/hud/scene/disc.tsx` | Without a phase (every campaign but the Witherwild): "Week 2 · Day 4" + the light ("Dim"); name "Week 2, Day 4, Dim light". Witherwild unchanged ("Day 3" + phase). |
| GM disc → End day | same, `fear.css` (`.hud-pop-day`) | With `canEndDay` and no arc, the GM's disc is a button ("…: open End day") opening a non-modal "Campaign day" pop-over with the dashboard's `CampaignDay` (label, End day, its notice and "Undo the day's end"). Players read it only. |
| Dashboard day card (hero redesign, user 2026-11-02 via orchestrator) | `time-of-day.tsx` (`DayCard`, `nextTimeOfDay`, `nextCalendarDay`), `campaign-shell.tsx`, `time-arc.tsx` (exports `UndoEndDay`, `endDayNotice`, `EndDayResult`) | Replaces the centred Time of day segmented control + Campaign day block for every campaign without the Witherwild arc (core included). One dark card (border `#2a3a40`, bg `#141e22`, parchment label, gold `#e3b45a` accent) top-right above the title on desktop (`sm:justify-end`), under the title block on narrow screens (`order-last`). One label "Week X · Day X"; under it the light (icon, name, its rule) - for the GM a button "Advance the time of day: now Day" that sets Day → Dim → Night → Day (`useSetTimeOfDay`, optimistic; wrapping never changes the date), read only for players; GM "End day" (aria "End the day"), no confirm, optimistic (next day, light back to Day, as the server does), with its "Undo the day's end" and the feed's Undo (CT2). Touch targets ≥ 44 px. `TimeOfDay` is gone; `CampaignDay` stays for the HUD pop-over. The Witherwild `TimeArc` branch is unchanged. |
| Docs | `docs/data-model.md` | The `campaignTime` row described as every campaign's (it said Witherwild only). |

No schema change, no migration: a campaign with no `campaignTime` row reads as Week 1, Day 1, and its light is
`campaigns.timeOfDay` (unset = Day). End day creates the row (rule 7 not triggered: no stored shape changed).

## Tests

- `tests/convex/core-calendar.test.ts` (5, new): a `custom` campaign starts on Week 1 / Day 1 / Day light with no row
  (`calendar`, `combatHud.scene` for GM and player); End day advances, resets the light, ends daily uses, day 7 starts
  week 2; undo rolls day, light and uses back; players cannot End day; `campaignTime.get` stays MECHANIC_DISABLED.
- `tests/convex/hud-party.test.ts`: the non-Witherwild scene now has `day` Week 1 / Day 1 and `canEndDay`.
- `tests/unit/hud/fear-scene.test.tsx`: disc lines / name for core; GM disc opens the Campaign day pop-over (Escape,
  focus back); player disc read only. `tests/unit/hud/fear-confirm.test.tsx`: fixture gets the new scene shape.
- `tests/e2e/core-calendar.spec.ts` (new, live two-browser): core dashboard "Week 1 · Day 1"; HUD disc for both; GM
  End day → both discs "Week 1 · Day 2"; Undo → back to Day 1 (server checked); axe on the pop-over.
- `tests/e2e/live.ts`: `gmAndPlayer({ frame })` accepts `"custom"` (sends a minimal core pitch).
- `tests/unit/dashboard/day-card.test.tsx` (6, new): cycle wrap Day → Dim → Night → Day, next calendar day (day 7 → next
  week), label / light / rule, GM click at Night sets Day (no End day), End day intent + optimistic calendar and light,
  player read only.
- Day card specs: `lane-m-time-of-day.spec.ts` (cycle button instead of the segmented control), `lane3-campaign-time` and
  `lane4-end-day-undo` (button name "End the day"), `core-calendar.spec.ts` (cycle wraps on the core dashboard).

## Files outside a pure HUD-disc change (kept minimal)

`convex/combatHud.ts` (scene only), `src/components/combat-map/hud/fear/fear.css` (one rule),
`tests/unit/hud/fear-confirm.test.tsx` (fixture), `tests/e2e/live.ts` (frame type + custom pitch). Dashboard hero:
`campaign-shell.tsx` (`DashboardHero`'s non-arc branch only), `time-of-day.tsx` (rewritten), `time-arc.tsx` (three
`export` keywords).

## QUESTIONS

1. **Core's time of day.** Core uses the same steps the other frames use: Day / Dim / Night (`campaigns.timeOfDay`),
   starting at Day, and End day resets it to Day (CT answer Q2). There is no "Morning" phase outside the Witherwild's
   arc; a core campaign starts on Week 1, Day 1, Day light. OK, or should core get named phases?
2. **Disc text.** Core / other frames show "Week n · Day n" and the light; the Witherwild keeps "Day n" + phase. Should
   the Witherwild disc also show the week?
3. **Pop-over.** The GM's core disc opens End day only; Day / Dim / Night stays in the GM toolbar. Should the pop-over
   also hold the light buttons (or the new dashboard day card)?
4. **Day card Undo.** The card keeps the inline "Undo the day's end" after an End day (besides the feed's Undo). Keep
   it, or rely on the feed only to keep the card compact?
5. **Edit grantees.** As before, the cycle follows the server's `canSet` (edit access, so an edit-grant player can
   advance the light), while End day stays GM only. OK?

## Merge-time actions

- No new module or public function; `combatHud.scene`'s returns change (new `canEndDay`, `day` never null).
  Regenerate `convex/_generated` as usual (no codegen diff expected).
- No schema change, no migration, no package change.
- Any other branch that builds `combatHud:scene` fixtures with `day: null` needs `day` and `canEndDay`.
