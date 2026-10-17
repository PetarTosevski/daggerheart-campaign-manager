# TASK-103 — D1: Design foundation and entry flow

- **Status:** Done (2026-10-17)
- **Phase:** D1 of `docs/design-port-roadmap.md`
- **bd:** `dcm-bxp.1` (epic `dcm-bxp`)
- **Boards:** `TitleMenu`, `FrameSelect`, the 10 frame intros, `Chronicle`, the `CampaignHub` header and nav

## Delivered

- Design tokens (colours, Cinzel / IBM Plex Sans / EB Garamond) in `src/app/globals.css` and `src/app/layout.tsx`; the shadcn tokens map onto the palette. The app is dark only.
- 340 design images from the Claude Design artifact in `public/design-assets/` (17 MB), with the manifest `src/lib/design-assets.generated.json` (`scripts/design-assets-manifest.mjs`).
- Frame registry `src/lib/frames/index.ts`: 10 frames with picker copy, intro copy, art and colours, the Custom backgrounds and tones; only Witherwild has an exclusive mechanic (`campaignTime`).
- Convex: `campaigns`, `campaignState`, `settings`, `operations` (see `docs/data-model.md`); `campaigns.{list,get,create,markOpened,remove,restore}`, `settings.{get,update}`.
- Screens: sign-in, title menu (Continue / Create / Load / Settings with table name, GM name, accent colour, account and sign-out), frame picker with search and the custom form (draft kept in browser storage), frame intro pages with "View full art", name dialog, Load Campaign with delete + undo, campaign shell with art header and section nav, and a dashboard skeleton. Tabs not yet ported show which phase ports them.

## Deviations from the boards (for the user to confirm)

- **Naming a frame campaign:** the boards never ask for a name outside Custom; a "Name your campaign" dialog opens from "Start campaign" / "Choose this Frame".
- **Steps 2 · Party and 3 · Session Zero** are shown but have no boards; creating a campaign goes straight to the dashboard.
- **Chronicle:** shows Fear only. Hope, players, sessions, last-played date and the recap come with D4/D9. The Import and Settings header buttons and "Party roster" are left out until their features exist.
- **Settings → Saved data** (backup / restore / erase) is replaced by an Account section (signed-in email, sign out); backup/restore of Convex data is in D11.
- **Frame intro:** the Overview, Special Mechanics and Inciting Incident links open the tome, which is D3; until then the labels show as text.
- **Dashboard:** read-only Fear and empty states; the time arc, Fear tokens, countdowns, "Open the Tome" and "Start Session" come in D2/D3/D9.

## Open question

- `AGENTS.md` forbids reproducing substantial rulebook text or protected art. The user chose "All frames, lore + visuals"; D1 ships the frames' pitches, designers and the boards' art. The tomes (D3) hold much longer frame text — confirm before porting them.

## Checks (2026-10-17)

| Command | Result |
|---|---|
| `pnpm lint` | Pass (`reference/**` now ignored) |
| `pnpm typecheck` | Pass |
| `pnpm test` | 12 files, 81 tests passed (13 new Convex tests in `tests/convex/campaigns.test.ts`) |
| `pnpm test:e2e` (includes `pnpm build`) | 11 passed (6 new in `tests/e2e/campaigns.spec.ts`) |
| Screenshots at 1440 px and 390 px | Compared against the boards |
