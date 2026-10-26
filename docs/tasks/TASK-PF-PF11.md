# TASK-PF-PF11: Dashboard bundle — lazy dice box, level-up badge split, SRD leaf imports, small domains module

Status: Review. Plan: `.omc/plans/performance.yaml`, tracer PF11. Branched from `rebuild` at a8a01e2 (PF5 and F8
merged). Picks up items 1-5 of `docs/tasks/TASK-PF-PF5.md`, "What still holds the dashboard".

## What changed

- **Dice box** (CL8). `party/dice/index.tsx` loads `DiceBox` with `next/dynamic` (inline options object). The
  dashboard's `RollFeed` only needs `RollFeedPanel`, which stays static. While the chunk loads, the sheet shows
  "Loading the dice box…" (`Small`, `role="status"`, like the rest picker's loading state). Both `DiceBoundary`s
  stay. F8's `dice-box.tsx` and `roll-feed.tsx` are untouched.
- **Level-up badge split** (CL8). `LevelUpCardBadge`, `LevelUpRosterBadge` and their `PendingBadge` moved to
  `party/level-up/badge.tsx`, which has no runtime imports. `level-up/index.tsx` re-exports them, so the roster and
  other callers are unchanged. `party-card.tsx` imports `./level-up/badge`, so the dashboard no longer pulls
  `history.tsx → tier-pickers.tsx → @/lib/srd` or `level-up/shared.ts → validation/characters` (zod).
- **SRD leaf imports** (CL9). `party-display.ts` imports `srd/art`, `srd/classes`, `srd/domains`, `srd/heritage`
  and `srd/subclasses` with small local lookups instead of the `@/lib/srd` barrel. `characters/spellcast.ts` and
  `session-features/holders.ts` import `srd/subclasses` instead of `srd/index`.
- **`srd/domains.ts`**. The ten domains (`DOMAINS`, verbatim) without the 93 KB card list. It is a copy for now:
  `srd/domain-cards.ts` is outside this tracer's owns (see below). `tests/unit/lazy-boundaries-2.test.ts` asserts
  the two lists are equal until `domain-cards.ts` re-exports it.
- `tests/unit/lazy-boundaries-2.test.ts` fails if `dice-box`, the full level-up index or the SRD barrel come back as
  static imports in these files.

## Measurements

`node scripts/perf/bundle.mjs` (initial client JS per route, KB raw / gzip), before = `rebuild` a8a01e2, same
worktree. "With diff" = this tracer plus the outside-owns diff below (measured, then reverted).

| Route | Before | After | With diff | Watched modules after (with diff) |
|---|---:|---:|---:|---|
| `/campaigns/[id]` (dashboard) | 1,452 / 512 | **1,153 / 430** | **1,059 / 404** | domain-cards (none) |
| `/campaigns/[id]/codex` | 1,260 / 436 | 1,138 / 418 | 1,044 / 391 | domain-cards, zod (zod) |
| `/campaigns/[id]/party` | 1,334 / 468 | 1,336 / 468 | 1,335 / 468 | domain-cards, equipment-tiers, zod |
| `/campaigns/[id]/party/[characterId]` | 1,495 / 528 | 1,479 / 522 | 1,478 / 521 | domain-cards, equipment-tiers, zod |
| `/campaigns/[id]/party/new` | 1,270 / 436 | 1,271 / 436 | 1,271 / 436 | domain-cards, equipment-tiers, zod |
| every other route | | unchanged | unchanged | |

- The dashboard meets the PF5 target (≤ 1,250 / 450 KB); equipment-tiers and zod are off it. domain-cards stays
  only through `party-display.ts → srd/art.ts → srd/domain-cards.ts` (`DOMAIN_CARD_ART` is computed from
  `DOMAIN_CARDS`), which the diff below removes.
- The party roster and wizard grow by 1-2 KB raw (0 gzip): they still load the barrel elsewhere, so the local
  lookups and the second `DOMAINS` copy are extra there. The diff removes the copy.

### Outside owns

Move `DOMAIN_CARD_ART` from `srd/art.ts` to `srd/domain-cards.ts`, and make `domain-cards.ts` re-export `DOMAINS`
from `domains.ts` (typecheck clean, measured above):

```diff
--- a/src/lib/srd/art.ts
+++ b/src/lib/srd/art.ts
-import { DOMAIN_CARDS } from "./domain-cards";
 ...
-/** Domain card id -> asset id. */
-export const DOMAIN_CARD_ART: Readonly<Record<string, string>> = Object.fromEntries(
-  DOMAIN_CARDS.flatMap((card) => (card.art ? [[card.id, card.art]] : [])),
-);
-
--- a/src/lib/srd/domain-cards.ts
+++ b/src/lib/srd/domain-cards.ts
-import type { DomainCard, DomainDef } from "./types";
+import type { DomainCard } from "./types";
-export const DOMAINS: readonly DomainDef[] = [ ...the ten domains... ];
+export { DOMAINS } from "./domains";
 ...
+/** Domain card id -> asset id. */
+export const DOMAIN_CARD_ART: Readonly<Record<string, string>> = Object.fromEntries(
+  DOMAIN_CARDS.flatMap((card) => (card.art ? [[card.id, card.art]] : [])),
+);
--- a/src/lib/srd/index.ts
+++ b/src/lib/srd/index.ts
-export { DOMAIN_CARDS, DOMAINS } from "./domain-cards";
+export { DOMAIN_CARD_ART, DOMAIN_CARDS, DOMAINS } from "./domain-cards";
-export { DOMAIN_CARD_ART, PORTRAITS, TRANSFORMATION_ART } from "./art";
+export { PORTRAITS, TRANSFORMATION_ART } from "./art";
```

After it lands, the `DOMAINS` equality test in `lazy-boundaries-2.test.ts` is trivially true and can stay.

## Tests

- `pnpm lint`, `pnpm typecheck`: clean.
- `vitest --maxWorkers=4 --testTimeout=60000`: 236 files, 5,630 passed, 1 expected fail.
- Playwright (servers started by hand, `E2E_REUSE_SERVERS=1`): dashboard, live-dashboard, dice, dice-followups,
  dice-3d, level-up, party-roster, a11y-party, live-party, session-features-dice and countdown-rolls: 38/38.
  A first run at load average 39-41 failed 16 of 33 with timeouts and the dashboard error boundary ("Check your
  connection"); a debug run at the same build showed no console or page errors, and every spec passed on rerun at
  load average 19-23.
