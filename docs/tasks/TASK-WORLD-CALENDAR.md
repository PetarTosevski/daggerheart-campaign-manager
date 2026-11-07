# TASK WORLD-CALENDAR: the campaign calendar above the World map

Plan `world-journey`, tracer MC1 (bead dcm-zod8.1). User request 2026-11-07: "The calendar is not present on the map,
we need it added here (especially important for witherwilds)." User pick: the full arc above the map.

## What landed

| Piece | File | What |
|---|---|---|
| `MapCalendar`, `mapCalendarFor` | `src/app/(gm)/campaigns/[campaignId]/world/map-calendar.tsx` | The dashboard's calendar, centred above the map: `TimeArc` (7 sky pictures, phase, Month/Week/Day, End day + undo) for frames with the `campaignTime` mechanic (the Witherwild), `DayCard` for every other campaign, core included. Read-only unless `role === "gm"` and not `ownerView` (the dashboard's rule), so players and the app owner's view have no End day. Wrapped in `SlotBoundary` (rule 11). Imports `dashboard.css` for the arc's `.tm-ic` buttons, as the HUD disc does. |
| World page | `src/app/(gm)/campaigns/[campaignId]/world/page.tsx` | Renders `MapCalendar` above `WorldBoard` once the map has loaded. |
| Tests | `tests/unit/world-map-calendar.test.tsx`, `tests/e2e/world-calendar.spec.ts` | Arc vs day card and the read-only rule; e2e: Witherwild GM's End day on /world moves Dawn → Sunrise live for the player, the calendar sits above the map; Beast Feast shows the day card, End the day advances it, the player has no End day, no sideways scroll at 768 px. |

No backend change: `campaignTime.calendar` / `endDay` and their access already serve every campaign.
