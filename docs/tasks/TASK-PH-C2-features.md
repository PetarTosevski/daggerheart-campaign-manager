# TASK-PH-C2: sheet features slot

Tracer C2-features. Branch `phone/C2-features` in
`/Users/nikolablagoevski/Desktop/Nikola_Random/daggerheart-phone-c2-features`,
from `phone/A1-on-master` at `b8cabf4`. Not committed.

## What changed

The features stub is replaced with a React Native port of the website’s Class
Features panel, class extras (Druid Beastform, Beastbound Companion), Lunar
Phases, and frame extras (Motherboard, Beast Feast, Castle High). Everything
lives under `apps/mobile/src/features/sheet/features/`.

`FeaturesSlot` composes, in website order:

1. **Class features** — class Hope feature use (when editable), class action
   rows, active effects (End / Got hit), conditions, held dice, session chips
   (Slayer, Tide, moon die), and class state counters. Uses the same domain
   helpers and Convex mutations as `src/components/party/features/panel.tsx`
   (`classFeatures.use`, `endEffect`, `gotHit`, `lastRoll` only while a damage
   reroll picker is open; `characters.listByCampaign` only while an ally picker
   is open).
2. **Class extras** — launcher rows open bottom sheets with the beastform and
   companion panels (`characterExtras.setBeastform`, `saveCompanion`, plus
   corruption helpers inside the companion sheet).
3. **Lunar Phases** — Moon Witch mastery with Hope & Fear on; `sessionFeatures.bumpMoonDie` with idempotency keys.
4. **Frame extras** — inline Motherboard, Beast Feast, and Castle High panels
   when `characterExtras.get` returns them.

`characterExtras.get` subscribes only for Druid and Beastbound characters so
the warrior slot smoke test stays subscription-free. Frame extras for other
classes (for example a Warrior on Motherboard) still need a follow-up: either
pass `frameId` on the slot contract or dedupe with the sheet shell’s existing
Motherboard subscription in `apps/mobile/src/features/sheet/index.tsx`.

`readCharacter` in `types.ts` still drops `sessionFeatures`, `effects`, and
other feature fields from the stored sheet. The UI reads them when present on
the object (tests attach them after `readCharacter`). A small orchestrator
change to `readCharacter` is required for live session chips and lunar state
on production sheets.

Player renders never call or subscribe to GM-only Convex functions; the harness
test in `apps/mobile/test/features/sheet-features/features.test.tsx` fails if
they do.

## Commands

Node v24, from the worktree (`pnpm install` if `node_modules` is missing).

| Command | Result |
| --- | --- |
| `pnpm --filter @dualityheart/mobile run check` | Exit 0. ESLint, `tsc --noEmit`, and Jest passed. 45 suites, 162 tests. |
| `pnpm exec vitest run tests/convex/codex.test.ts` | Exit 0. 24 passed. This tracer did not edit that file. |

## Not done

No commit, no push, no merge. Frame extras for non–class-extra characters
depend on a shared `characterExtras.get` subscription with the sheet shell.
Extended sheet fields on the client still need `readCharacter` widened outside
this tracer’s `owns`.
