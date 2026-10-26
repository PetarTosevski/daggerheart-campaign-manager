# TASK-101 — Repo sweep

- **Status:** Review (all Phase 0 gates and checks pass; awaiting the user's review)
- **Phase:** 0 of `.omc/plans/campaign-manager-rebuild.md`
- **bd:** `dcm-2a6.1` (epic `dcm-2a6`, "Rebuild first slice")
- **Branch:** `rebuild`

## Goal

Remove the Witherwild-era app from the `rebuild` branch, keeping only the logic,
docs and references the new campaign manager reuses, and leave a building
placeholder app for Phase 1.

## Scope

1. Recovery point: push tag `witherwild-final` and branch `rebuild` to `origin`
   (approved by the user, OQ-13).
2. Copy the source of the Fear 0–12 range into `docs/game-interpretation.md`.
3. Rewrite `AGENTS.md` for the new scope, outside the bd marker blocks.
4. Create a new `docs/open-questions.md` (OQ-10).
5. Delete the old app code, tests, scripts, public assets, docs and task docs.
6. Move seven legacy migrations to `reference/legacy-sql/` with a README.
7. Remove the legacy backend and PDF dependencies; rewrite the affected config
   files.
8. Placeholder `src/app/page.tsx` and updated layout metadata.

Out of scope: Convex, auth, any mechanic, visual design.

## Kept

- `src/lib/domain/{fear,countdowns,campaign-time}`,
  `src/lib/validation/{fear,countdowns,campaign-time}.ts` and their six unit
  tests.
- `docs/rules-index.md`, `docs/game-interpretation.md`, `docs/glossary.md`,
  `docs/documentation-audit.md` (OQ-4, kept as a historical audit).
- `src/components/ui/*`, `src/lib/utils.ts`, `components.json` (OQ-5).
- Both PDFs in `reference/`.
- `.beads/`, `.codex/`, `.cursor/`, `.agents/`, `.claude/` (OQ-7: untouched),
  `CLAUDE.md`, `core.hooksPath`.

## Acceptance criteria

- [x] `witherwild-final` and `rebuild` exist on `origin`.
- [x] Fear range source recorded in `docs/game-interpretation.md`.
- [x] `AGENTS.md` describes frames, core vs. frame-exclusive mechanics, the
      ask-before-designing rule, the Convex stack, the reduced source-of-truth
      hierarchy, Convex transaction and idempotency rules, the RSC vs. client
      note and the actual commands.
- [x] bd blocks in `AGENTS.md` and `CLAUDE.md` unchanged.
- [x] Keep-list assertion exits 0.
- [x] Code/config grep gate prints nothing (exit 1).
- [x] Docs check prints nothing (exit 1).
- [x] Root files match the plan's list.
- [x] `pnpm test` runs exactly the six kept unit tests and they pass.
- [x] `pnpm lint`, `pnpm typecheck` and `pnpm build` pass.

## Commands run and results (2026-10-16)

| Command | Result |
|---|---|
| `git push origin witherwild-final rebuild` | Tag and branch created on origin |
| `git ls-remote --tags origin` / `--heads origin rebuild` | Both at `fb05359` |
| bd-block `diff` loop from the plan | `AGENTS.md bd blocks OK`, `CLAUDE.md bd blocks OK` |
| `pnpm install` | 29 packages removed, lockfile regenerated |
| `pnpm lint` | Pass |
| `pnpm typecheck` | Pass (after a clean `pnpm build`; the stale `.next/types` referenced deleted routes) |
| `pnpm test` | 6 files, 42 tests passed |
| `pnpm build` | Pass; routes `/` and `/_not-found` |
| Keep-list assertion | Exit 0 |
| Code/config grep gate | No output, exit 1 |
| Docs check | No output, exit 1 |

## Notes

- `docs/campaign-house-rules.md` also held a resting house rule ("each character
  has a unique rest mechanic, run through the 'Work on a Project' long-rest
  option") and inventory rules. They are deleted with the file (user decision)
  and recoverable from `witherwild-final`. The resting rule is relevant when
  rests and downtime are specified.
- Legacy backend mentions in `README.md` remain until Phase 7 (historical, per
  the plan).
