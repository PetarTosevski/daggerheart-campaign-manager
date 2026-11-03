# TASK-PH-C4-sessions: Phone sessions screen

Status: Review

Tracer: `phone/C4-sessions` on `phone/A1-on-master`.

## Goal

Port the website Sessions hub (`src/app/(gm)/campaigns/[campaignId]/sessions/page.tsx` and `src/components/sessions/*`) to `apps/mobile`. Both roles get the session list and read-only played/live session detail (recap). The GM also gets live start/end, Prep, Play, and Wrap-up. Players must not subscribe to `sessionPrep.get`, `sessionPlay.*`, or `sessionWrap.get`.

## Acceptance

- `pnpm --filter @dualityheart/mobile run check` on Node 24: eslint and tsc pass; jest reports **218/218** tests passed. **Blocked:** `test/features/world/view.roles.test.tsx` fails at suite load (`Reanimated.createAnimatedComponent` in gesture-handler); file is outside this tracer’s `owns`.
- `apps/mobile/test/features/sessions/sessions.roles.test.tsx`: **5 passed** (list/detail role splits; players never subscribe to `sessionPrep`, `sessionPlay`, or `sessionWrap.get`).
- `pnpm test tests/convex/codex.test.ts`: **not run successfully** here (`rolldown-binding.darwin-arm64.node` MODULE_NOT_FOUND in vitest); left untouched per tracer scope.
- No new public Convex functions.

## Implementation notes

- List: `sessionRecords.list`, GM `sessionRecords.create`.
- GM detail: stage tabs mount only the active stage's GM queries (Prep / Play / Wrap), plus `sessions.current` on the live card.
- Player detail: `PlayerSessionView` reads recap from `sessionRecords.list` only.
