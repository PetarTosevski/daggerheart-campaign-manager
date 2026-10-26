# TASK-106 — D3: Frame dashboards, tomes and frame trackers

- **Status:** Done (2026-10-17)
- **Phase:** D3 of `docs/design-port-roadmap.md`
- **bd:** `dcm-bxp.3`
- **Boards:** `Hub*`, `HubCustom`, `Tome*`, `TomeOpenBook`, `TomeCustom`; rules from the Core Book and Hope & Fear (`.reference-private/`)
- **Spec:** `.omc/autopilot/frame-trackers-spec.md`; decisions in `docs/decisions-d3-d11.md`

## Delivered

- **Lore books** (`src/components/tome/tome-book.tsx`, data `src/lib/frames/tomes.ts`): the open-book reader with three chapters (Overview with drop cap and pull quote, Inciting Incident with key figures and start location, Campaign Mechanics as numbered rules), GM notes, frame art; opened from the dashboard ("Open the Tome", Campaign Tome panel) and from each frame's intro page (Overview, Special Mechanics, Inciting Incident). Custom campaigns: the GM writes the three chapters with autosave (`campaigns.updateTome`); players read them.
- **Dashboard panels:** Key Figures per frame (custom campaigns point to their tome), Campaign Rules (GM switches for optional rules: Hope & Fear content, Castle High less lethal, Andaluria transformations, Horizon Endurance Countdowns, Motherboard remnant Corruption; defaults per `src/lib/frames/options.ts`).
- **Frame trackers** (`convex/trackers/*`, `src/lib/frames/trackers/*`, `…/[campaignId]/trackers/*`), all GM-only to change and filtered for players on the server:
  - **Five Banners Burning:** relationship matrix (−3…+3, "Neutral" at 0), nation sheets, objective countdowns (1 major of 10, up to 2 minor of 4–6 per nation), week counter with Advance week; GM-only with per-item reveal.
  - **Colossus of the Drylands:** hunt/interlude phase, colossi slain, Siphoning Track (10 slots), Kudamat's Power and thresholds, server-rolled siphon; Kudamat GM-only.
  - **The Age of Umbra:** Sacred Pyres and Blessed Branches (visible to players), Lurking Darkness roller with Keep Watch (GM-only), Fear via the shared `gainFear` (capped at 12).
  - **Reign of the Weredragon:** Night Sky reading (server 5d6, GM assigns), five Revelations (hidden → revealed → achieved), private player secrets, showdown readiness.
  - **Dark Heart of Andaluria:** hunts with beats and Liminal Clues; players see the beat and solid clues only.
  - **Journey to Horizon:** Doom Track (nested boxes transcribed from the book sheet, tier limit, tier rules, tier-4 automatic Fear) with "occurred" events visible to players; Soul Echoes 1–10.
- **Pure rollers for later phases** (`src/lib/domain/frames/*`): Make a Feast, Bloom, harvest counts (Beast Feast); scrap gathering and shack stock (Motherboard); hex encounter roll and travel days (Horizon).
- **Plumbing:** `frameTrackers` table, `campaigns.options`, frame-owned countdowns (`ownerKey`, `kind`, `revealed`), `convex/lib/{trackers,fear,dice}.ts` (CSPRNG dice).

## Deferred by the spec (later phases)

Character-level frame mechanics: Wither tokens with the Fear-Die scar check (D5), Beast Feast ingredients and cookbook (D4/D5), Motherboard wallet/Ikonis/augments (D4), curses, transformations, Lycanthropy, Endurance (D5), Horizon hex crawl on the map (D6), colossus segments and adversary tags (D8).

## Checks (2026-10-17)

| Command | Result |
|---|---|
| `pnpm lint`, `pnpm typecheck` | Pass |
| `pnpm test` | 37 files, 296 tests passed |
| `pnpm test:e2e` (includes build) | 30 passed (tome + six tracker specs new) |

## Reviews

- Architect (Opus): rejected for one bug, fixed — the custom tome lost the last ~600 ms of typing when switching chapter or closing; it now flushes pending text on unmount and blur, ignores stale save results, and syncs remote edits only when nothing is unsaved. Also fixed: Andaluria capped at 20 hunts (row stays under Convex's 1 MiB limit), Umbra pyres capped at 200, Five Banners no longer silently resets malformed data (`TRACKER_CORRUPT`), memoized campaign context.
- Security (Opus): pass with fixes, applied — generic countdown controls refuse frame-owned countdowns; per-player cap of 10 Weredragon secrets. Kept by design: players see the Night Sky dice they roll (the book has players roll them).
- Accepted for now: Weredragon/Andaluria tracker rows are cast on read (only the server writes them); tracker modules repeat a small GM/frame/idempotency wrapper and use frame-specific error codes (each carries a readable message).
