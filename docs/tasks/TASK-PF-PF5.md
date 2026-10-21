# TASK-PF-PF5: Lazy tome, trackers, rest picker and SRD barrel out of the dashboard

Status: Review. Plan: `.omc/plans/performance.yaml`, tracer PF5. Branched from `rebuild` at 0dda7dc.

## What changed

- **Tome** (CL8). `campaign-tome.tsx` is now a thin wrapper. It mounts nothing until the tome is first opened, then
  loads `campaign-tome-book.tsx` (the old component, renamed `CampaignTomeBook`) with `next/dynamic`. The book stays
  mounted after the first open, so the dialog's close and focus return work as before. While the chunk loads, the
  wrapper shows the book's leather card over the dialog backdrop, with "Opening the tome…" (`role="status"`).
  `tomes.ts` and `components/tome/tome-book.tsx` left every campaign route's initial JS.
- **Frame trackers** (CL8). `trackers/index.tsx` loads each of the six trackers with `next/dynamic`, so a campaign
  fetches only its own frame's tracker. While it loads, an empty tracker card (TrackerCard's panel style) reads
  "Loading the frame tracker…".
- **Rest picker** (CL8). `RestPicker` subscribes to `rests.current` (the same subscription the picker uses, so Convex
  shares it) and loads `picker.tsx`, with its `DOMAIN_CARDS` and `rest.css`, only while a rest is open. Its loading
  state is the picker's own "Loading the rest…". `RestLauncher` stays static. Both keep their `RestBoundary`.
- **SRD leaf imports** (CL9). `brawler.ts`, `sorcerer.ts` and `druid.ts` import `srd/equipment` +
  `srd/equipment-tiers`, `srd/domain-cards` and `srd/beastforms` instead of the `srd/index` barrel, with small local
  lookups. Behaviour is unchanged: Brawler's Strike still applies when the primary weapon id is not a known Tier 1-4
  weapon.
- `tests/unit/lazy-boundaries.test.ts` fails if any of these files gets a static import back, or if a class-feature
  module imports the barrel.

## Measurements

`node scripts/perf/bundle.mjs` (initial client JS per route, KB raw / gzip), before = `rebuild` 0dda7dc, same
worktree.

| Route | Before | After | Watched modules after |
|---|---:|---:|---|
| `/campaigns/[id]` (dashboard) | 1,629 / 572 | **1,447 / 510** | domain-cards, equipment-tiers, zod |
| `/campaigns/[id]/[section]` | 934 / 354 | 830 / 319 | |
| `/campaigns/[id]/adversaries` | 1,484 / 501 | 1,380 / 466 | adversaries, environments |
| `/campaigns/[id]/codex` | 1,360 / 469 | 1,256 / 434 | domain-cards, equipment-tiers, zod |
| `/campaigns/[id]/combat-map` | 1,431 / 509 | 1,327 / 474 | zod |
| `/campaigns/[id]/combat-map/packs` | 976 / 371 | 872 / 336 | |
| `/campaigns/[id]/lorekeeper` | 937 / 355 | 833 / 320 | |
| `/campaigns/[id]/notes` | 988 / 376 | 884 / 342 | |
| `/campaigns/[id]/party` | 1,439 / 503 | 1,330 / 466 | domain-cards, equipment-tiers, zod |
| `/campaigns/[id]/party/[characterId]` | 1,598 / 561 | 1,489 / 525 | domain-cards, equipment-tiers, zod |
| `/campaigns/[id]/party/new` | 1,363 / 467 | 1,258 / 432 | domain-cards, equipment-tiers, zod |
| `/campaigns/[id]/sessions` | 1,309 / 445 | 1,205 / 410 | adversaries |
| `/campaigns/[id]/world` | 1,090 / 406 | 986 / 371 | zod |

- tomes.ts is gone from every campaign route. It stays only on `/frames/[frameId]` (the frame intro shows the book
  directly; not this tracer's).
- `pkg:next` grew from 559 to 578 KB raw (the `next/dynamic` loader). That cost is shared by every route.

### What still holds the dashboard

The dashboard misses the 1,250 / 450 KB target by about 200 / 60 KB. Every remaining watched module comes in through
files outside PF5's `owns`:

1. `page.tsx → party/dice/index.tsx → dice-box.tsx`. The dashboard needs only `RollFeedPanel`, but the dice index
   imports `DiceBox` statically. `DiceBox` pulls in the class-feature registry, all its SRD lists,
   `session-features/holders.ts → srd/index`, `characters/spellcast.ts → srd/index` and `validation/characters` (zod).
   Measured with a lazy `DiceBox` (diff below, then reverted): dashboard 1,447 → **1,390 / 485 KB**.
2. `party-section → party-card → party-display.ts → @/lib/srd` barrel, the whole SRD. Leaf imports there (diff below)
   do not change the total on their own, because of item 3.
3. `party-card → level-up/index.tsx → history.tsx → tier-pickers.tsx → @/lib/srd`, plus
   `level-up/shared.ts → validation/characters` (zod). `LevelUpCardBadge` on each dashboard party card holds
   domain-cards, equipment-tiers, subclasses, heritage and zod. It needs a lazy split in `party-card.tsx` or in
   `level-up/index.tsx` (the badge without the history pickers).
4. `domain-cards.ts` also holds `DOMAINS`, which the party card's banner needs. A tiny `srd/domains.ts` would keep the
   93 KB card list off routes that only need domain colours.

Diff for items 1 and 2 (outside owns; typecheck clean, measured, not committed):

```diff
--- a/src/components/party/dice/index.tsx
+++ b/src/components/party/dice/index.tsx
@@ -1,10 +1,22 @@
+"use client";
+
+import dynamic from "next/dynamic";
+
 import type { CampaignSlot, CharacterSlot } from "../slots";
 import { DiceBoundary } from "./boundary";
-import { DiceBox } from "./dice-box";
 import { RollFeedPanel } from "./roll-feed";
 
 // D5 dice (T1). Contract: ../slots.ts.
 
+// CL8: the dice box carries the class-feature registry and SRD lists; the dashboard's roll feed does not need them.
+const DiceBox = dynamic(() => import("./dice-box").then((m) => m.DiceBox), {
+  loading: () => (
+    <p role="status" className="m-0 text-[14px] text-[#5a4a36]">
+      Loading the dice box…
+    </p>
+  ),
+});
+
--- a/src/components/party/party-display.ts
+++ b/src/components/party/party-display.ts
-import { getAncestry, getClass, getCommunity, getDomain, getSubclass, portraitFor, type DomainId } from "@/lib/srd";
+import { PORTRAITS } from "@/lib/srd/art";
+import { CLASSES } from "@/lib/srd/classes";
+import { DOMAINS } from "@/lib/srd/domain-cards";
+import { ANCESTRIES, COMMUNITIES } from "@/lib/srd/heritage";
+import { SUBCLASSES } from "@/lib/srd/subclasses";
+import type { DomainId, PortraitArt } from "@/lib/srd/types";
+
+// CL9: SRD leaf modules, not the @/lib/srd barrel (its helpers close over every list).
+const getAncestry = (id: string) => ANCESTRIES.find((a) => a.id === id);
+const getClass = (id: string) => CLASSES.find((c) => c.id === id);
+const getCommunity = (id: string) => COMMUNITIES.find((c) => c.id === id);
+const getDomain = (id: string) => DOMAINS.find((d) => d.id === id);
+const getSubclass = (id: string) => SUBCLASSES.find((s) => s.id === id);
+const portraitFor = (opts: { subclassId?: string | null; ancestryId?: string | null }): PortraitArt | undefined =>
+  (opts.subclassId ? PORTRAITS[`sub-${opts.subclassId}`] : undefined) ?? (opts.ancestryId ? PORTRAITS[`anc-${opts.ancestryId}`] : undefined);
```

Also outside owns: `src/lib/domain/characters/spellcast.ts` and `src/lib/domain/session-features/holders.ts` import
`../../srd/index`. Switch them to `srd/subclasses` and the leaf modules they need.

### Navigation (PF0 `measure.mjs --profile cpu4`, 3 runs)

Load average was 26-27 throughout, against 4.7 for PF0's baseline, so the timings cannot be compared.
Load → Dashboard taskMs was 2,125 ms after, against a baseline of 1,461 ms. The byte counts can be compared:
Load → Dashboard fetched 11 files / 196 KB on click (baseline 9 / 229 KB), and the dashboard hard load fetched
26 / 423 KB (baseline 23 / 432 KB). The 20% task-time acceptance item needs a re-measure on a quiet host,
preferably after the items above.

## Tests

- `pnpm lint`, `pnpm typecheck`: clean.
- `vitest --maxWorkers=4 --testTimeout=60000`: 224 files, 5,457 passed, 1 expected fail.
- Playwright: dashboard, live-dashboard, rest, rest-frame-hooks, tome, five-banners, colossus, age-of-umbra,
  andaluria, horizon, weredragon, class-features and class-features-hf: 30/30. One age-of-umbra test timed out once
  at load average 25 and passed on rerun.
