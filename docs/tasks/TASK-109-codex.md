# TASK-109 — D7: Characters & Locations (the Codex board)

- **Status:** Implemented (2026-10-17), e2e pending
- **Phase:** D7 of `docs/design-port-roadmap.md`
- **bd:** `dcm-bxp.7` (follow-up `dcm-bxp.16`)
- **Board:** `reference/designs/project/Codex.dc.html`
- **Decisions:** `docs/decisions-d3-d11.md` (multi-user: players see the revealed Codex only; never unrevealed NPCs, images or allegiances, or GM notes)

## Delivered

- **Data** (`src/lib/codex/*`): `codexEntryDataSchema` (name, role / kind of place, known, what the players know, GM notes, ≤ 8 images with a "shown" flag, main picture, true allegiance, allegiance players see, region, map token id), the frame's allegiances (Witherwild: Haven / Fanewick / Neutral; others: Allies / Enemies / Neutral) and regions (Witherwild: Haven / Colonies / Fanewick), the board's Witherwild region polygons, the player view (`toPlayerEntry`, also used for the GM's preview) and the board's seeded characters per frame.
- **Convex** (`convex/codex.ts`): `list` (GM: everything plus the map's pins; player: known entries reduced to name, what the players know, the shown allegiance, region, revealed images, and the pin only when its token is visible), and GM-only `create` (idempotent, ≤ 500 entries), `seed` (once per campaign), `update` (zod, bounded, allegiance/region checked against the frame), `setPin` (token must exist on the map, else stored as none), `importPins` ("From map"), `remove` (deletes the files), `imageUploadUrl`, `attachImage` (image/* ≤ 3 MB, unclaimed by any entry or portrait, recorded in `codexImages`; a rejected file is deleted), `setImageShown` (revealing also marks the entry known), `setCover`, `removeImage` (deletes only the entry's own file).
- **UI** (`/campaigns/<id>/codex`): kind tabs with counts, allegiance / region filter chips, search, entry list (cover thumb, group badge, Known/Secret and "n/m shown" for the GM), detail card (cover, name, role, allegiance pickers with "Reveal true allegiance", region or "from map pin", known toggle, map pin link / Show on map / Unlink, two-click delete), image gallery (click, drop or paste to add; resized to JPEG ≤ 1800 px in the browser; reveal, main picture, two-click delete), the two notes cards, lightbox (Esc and arrows), pin picker, and the GM's "Player view" preview. Layout stacks to one column below 1024 px.

## Notes and deviations

- Players don't receive the role / kind-of-place line (the task's list of player fields leaves it out; the board shows it). See the questions in the D7 report.
- The pin picker links an existing World map pin. Dropping or moving pins from the Codex, renaming the pin with the entry and focusing the pin from "Show on map" (`/world?token=<id>`) wait for D6 (`dcm-bxp.16`).
- Text fields save on blur (the board's `onChange` on inputs).
- Campaigns are only soft-deleted, so codex rows and files are kept with them.

## Checks (2026-10-17)

| Command | Result |
|---|---|
| `pnpm lint`, `pnpm typecheck` | Pass |
| `pnpm test` | 56 files, 467 tests passed (new: `tests/unit/codex-view.test.ts` 12, `tests/convex/codex.test.ts` 10) |
| `node scripts/convex-e2e.mjs dev --once --typecheck=enable` | Functions ready |
| `pnpm test:e2e` (`tests/e2e/codex.spec.ts`) | Not run (shared port); pending |
