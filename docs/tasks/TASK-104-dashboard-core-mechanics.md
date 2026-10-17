# TASK-104 — D2: Dashboard core mechanics

- **Status:** Done (2026-10-17)
- **Phase:** D2 of `docs/design-port-roadmap.md`
- **bd:** `dcm-bxp.2` (epic `dcm-bxp`)
- **Board:** `CampaignHub` (time arc, GM Fear, Countdowns, Last Session)
- **Run:** ralph (PRD stories US-001…US-006)

## Decisions applied (user, 2026-10-17)

- Countdowns: legacy rules in the board's look, no audit history.
- Campaign time: the board's model with months; Witherwild only.
- Wither tokens: moved to D5.

## Delivered

- **Domain** (`src/lib/domain`): board phase names (Dawn … Nautical Twilight; Nightfall … Nautical Dawn), `WEEKS_PER_MONTH = 4` (the board's `weeksPerMonth` default), `monthOf`, `weekInMonth`, `withCycleDay`; `applyCountdownAction` (port of the legacy `operate_campaign_countdown` SQL); `assertFearValue`.
- **Convex:** `fear.{adjust,set}`, `countdowns.{listByCampaign,create,operate}`, `campaignTime.{get,advance,setDay}`; `convex/lib/mechanics.ts` (`loadOwnedCampaign`, `assertMechanicEnabled`, `ruleError`). All mutations are idempotent through `withIdempotency`; campaign time is gated on the server (`MECHANIC_DISABLED`).
- **UI:** the header time arc (7 sky icons, The Long Day/Night, stage, Month · Week · Day, "Bring the Night/Dawn · begin a new week" at day 7), the GM Fear token spiral with smoke and fire, countdown cards with hourglass and sand grains, the New countdown dialog, and the Last Session empty state.

## How the board maps onto the legacy countdown rules

| Board control | Implemented as |
|---|---|
| Tick −1 | `advance` |
| Borrowed Time (+1, could raise the start) | `reverse`, capped at the starting value |
| Reset | replaced by Pause / Resume |
| ✕ delete | Cancel countdown (with confirmation; cancelled is final and hidden) |
| Click a grain | `correction` to that value (clicking the top lit grain lowers by one) |
| Edit name / note inline | not editable (no rename in the legacy rules); "What happens at zero?" is the consequence |
| Value picker 20 … 1 | starting value 1–20 |

The arc's day icons set the day within the current week (`setDay`); the board has no one-day "next" button, so `advance` is used only at day 7.

## Checks (2026-10-17)

| Command | Result |
|---|---|
| `pnpm lint`, `pnpm typecheck` | Pass |
| `pnpm test` | 16 files, 114 tests passed |
| `pnpm test:e2e` (includes `pnpm build`) | 14 passed (4 new in `tests/e2e/dashboard.spec.ts`) |
| Screenshots 1440 px and 390 px | Compared with the board |

## Review

Architect review (ralph step 7): approved. Fixed from its findings: Witherwild campaigns created before D2 (no time row) now read as week 1 / DAY / 1 and get their row on the first change; the New countdown form ignores a second submit while pending and resets on close; countdown and arc controls are disabled while a change is in flight.

## Notes

- `omc ralph verify` reported vitest's changing summary lines as "new failures" although every command exited 0; the gate was judged by the real exit codes.
- `pnpm test:e2e` reuses any server on port 3000; stop `pnpm dev` first.
