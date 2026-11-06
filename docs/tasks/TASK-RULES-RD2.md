# TASK-RULES-RD2: the four frame switches start off for new campaigns

Status: Review. Plan: `.omc/plans/rule-switches.yaml`, tracer RD2 (epic dcm-jh6d part A, bead dcm-bxp.134).

## Rule

User 2026-10-30 (bead dcm-bxp.134), overriding `docs/decisions-d3-d11.md`: the four optional frame rules start off in
a new campaign; the GM turns them on in House rules. Q1 answer (a), 2026-11-05: running campaigns keep today's value,
pinned by RD1's `migrations/ruleDefaults:pinFrameOptions`.

| Option | Frame | Book | New campaign |
|---|---|---|---|
| `lessLethal` | `castle-high` | HF p.127 | off |
| `transformations` | `dark-heart-of-andaluria` | HF p.34 | off |
| `enduranceCountdowns` | `journey-to-horizon` | HF p.176 | off |
| `remnantCorruption` | `motherboard` | CB p.295 | off |

`hopeAndFear` (on for the four Hope & Fear frames) and `witherPersists` (off) are unchanged.

## What it does

`src/lib/frames/options.ts`: `defaultFor` of the four options returns `false`. `resolveOptions` is unchanged, so a
stored key (true or false) still wins over the default and an option outside its frame is still off.

## Deploy order

`pinFrameOptions` must have run on a deployment before the code that ships RD2 reaches it, or running campaigns lose
their rule. Dev: done. Prod: run it (`docs/tasks/TASK-RULES-RD1.md`, with `--prod`) before the deploy that ships RD2.

## Tests

- `tests/unit/rules/frame-option-defaults.test.ts`: the four defaults are off, a stored value wins, the options stay
  off outside their frame, `hopeAndFear` and `witherPersists` are unchanged.
- Tests that relied on the old default now turn the option on with `campaigns.setOption` (or a stored `options`
  key) in their setup.

## Outside RD2's owns (reported, not edited)

These rely on the old default and need the option turned on in their setup:

- `tests/convex/authz/characters.entries.ts`: the Motherboard fixture needs `remnantCorruption` on
  (`characterExtras:setCompanionRemnant`, `repairCompanion`, `replaceCompanion` fail for gm / coGm / player).
- `tests/convex/rules-frame-rests.test.ts`: W7 Andaluria (Book and Manual) needs `transformations` on.
- `tests/e2e/visual/S9.spec.ts` (Castle High less-lethal dialog) and `tests/e2e/motherboard-ikonis.spec.ts`
  (Corruption Track) very likely need the same; not run.
