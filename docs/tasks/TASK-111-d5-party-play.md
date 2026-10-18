# TASK-111: D5 — Party: level-up, dice, Hope and class features, rests, death (dcm-bxp.5)

Built 2026-10-18 as 19 tracers (plan `.omc/plans/d5.yaml`), each in its own worktree and merged one commit per tracer. Per-tracer details, book quotes and pages: `docs/tasks/TASK-D5-*.md`.

## What players and GMs can do now
- **Dice and the roll feed (T1, T1b):** server-rolled action, reaction, damage and Tag Team rolls; advantage/disadvantage cancel to one d6, help keeps the highest; Experiences cost Hope; Hope/Fear and crits applied (Fear to the GM automatically); manual entry of physical dice marked "manual"; a feed every member sees, GM free rolls hidden until revealed; optional lazy 3D dice (per-device toggle, off with reduced motion).
- **Undo:** the roller (within 60 s for dice) or the GM undoes an action; undo is refused if anything newer touched the character.
- **Level-up (T2):** GM "Party levels up", owners step through achievements, two picks (incl. +1 to two unmarked traits, dcm-mf7), domain card and optional trade; marks clear at 5 and 8; repeatable undo of the latest level; GM level correction; Brawler Combo Die step.
- **Rests (T3, T3b):** GM-run party rests, two moves per PC, rest Fear (1d4 / 1d4 + PCs), three-short-rest limit, Work on a Project, frame rest rules for Horizon, Age of Umbra, Colossus, Beast Feast, Andaluria and Motherboard.
- **Death (T4):** Blaze of Glory, Avoid Death (scar roll), Risk It All; Castle High less-lethal "away"; only the GM returns or revives.
- **Wither and sessions (T5):** Witherwild Wither tokens; temporary GM Start/End session buttons (Wither → Fear capped at 12, session effects cleared) until D9.
- **Equipment (T6):** Tier 1-4 weapons and armor, always-on subclass bonuses, subclass ranks, multiclass view.
- **Class features (T8a-c):** Hope features for all 13 classes and every class feature (Rally, Prayer Dice, Strange Patterns, Brawler's Strike, Favor, Hex…), with generic inputs on the sheet.
- **Motherboard (T9):** Ikonis instead of weapons, augments in defense, Light in the Dark's seventh Hope slot.
- **Photo import (T7):** GM uploads sheet photos, one Claude vision call, GM reviews and edits the draft before saving; photos deleted after reading; hidden until `ANTHROPIC_API_KEY` is set on Convex.

## Review
A security and code review (`.omc/audit/d5-review.md`) found 2 High, 5 Medium and 8 Low issues; all High and Medium and most Low were fixed in R1-R3. Remaining follow-ups: dcm-bxp.31.

## Verification (final)
- `pnpm lint`, `pnpm typecheck`: clean.
- `pnpm test`: 1041 passed.
- `pnpm test:e2e`: 64 passed.

## Not done in D5
- Side-by-side screenshots against the Party board at 1440/390 px.
- Decisions taken while the user was away: `.omc/autopilot/decisions-pending.md` (for review).
