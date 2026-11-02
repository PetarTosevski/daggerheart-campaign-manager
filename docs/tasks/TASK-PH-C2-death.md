# TASK-PH-C2-death: Sheet death moves and incoming hits (phone)

Status: **Review**

## Goal

Replace the death and incoming-hit stubs in `apps/mobile` with the same behavior as the website character sheet: death-move flow (`deathMoves.*`), adversary reaction windows (`adversaryActions.pending` / `respond`), and manual damage (`characters.applyDamage`). GM-only controls for settling less-lethal away requests and returning a character to play must not render for players.

## Owns

- `apps/mobile/src/features/sheet/death/**`
- `apps/mobile/src/features/sheet/incoming/**`
- `apps/mobile/test/features/sheet-death/**`
- This task document

## Acceptance

- `pnpm --filter @dualityheart/mobile run check` on Node 24 passes.
- `apps/mobile/test/features/sheet-death/death.roles.test.tsx` — GM settle/return vs player; `characters:applyDamage` intent.
- `apps/mobile/test/features/sheet-death/incoming.test.tsx` — `adversaryActions:respond` on Mark; reader mounts nothing.
- Website parity references: `src/components/party/death/*`, `src/components/combat-map/actions/reactions/*`, `damage-calculator.tsx`.

## Notes

- `SheetData` in `apps/mobile/src/features/sheet/types.ts` does not yet surface `conditions` / `journeyEnds`; badges read optional flags when present on the sheet object.
- If `tests/convex/codex.test.ts` fails in the root suite, record it; do not edit that file in this tracer.
  - **Recorded (2026-11-02, local Node v20.16.0):** `pnpm test tests/convex/codex.test.ts` fails to load Vitest rolldown native binding (`Cannot find module './rolldown-binding.darwin-arm64.node'`). Not caused by this tracer.
