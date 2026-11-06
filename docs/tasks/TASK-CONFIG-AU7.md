# TASK-CONFIG-AU7: The owner's read-only view in the campaign pages

Plan `.omc/plans/config.yaml`, tracer AU7 (bead dcm-jh6d.57), Part B. Client only; the server is AD13
(`docs/tasks/TASK-CONFIG-AD13.md`) and the Overview's Open is AU1. Answers: Q27 (b) the owner gets a read-only view of
any campaign; **N1 (changed 2026-11-04)**: the view shows everything, players' private notes and private Lorekeeper
chats included; the owner changes nothing, and every visit is logged (AU1 calls `appAdmin.openCampaign` before it
navigates).

## What the shell does with `campaigns.get` → `ownerView: true`

`src/app/(gm)/campaigns/[campaignId]/campaign-shell.tsx`. The summary says `role: "gm"`, `isCreator: false`, so every
page reads as the GM; the shell takes away what would write or count the owner as present:

| Part | Owner view |
|---|---|
| Banner | `OwnerViewBanner` (`src/components/config/owner-view-banner.tsx`): "Read-only view · You are not in this campaign. Nothing can be changed here.", `role="status"`, the archived banner's fixed top-centre tab, so no layout moves. An archived campaign adds the archived line here instead of a second banner (Restore is the creator's). |
| Gear | hidden in the art header and in the Combat Map's app bar (`CombatAppBarFrame settings={false}`) |
| Players button | hidden (and no "Player" chip in its place) |
| `ConfigMounts` | not mounted: no Campaign settings panel, no `PresenceBeat` (the owner never beats presence or shows Online), no spotlight ping |
| `markOpened` | never called (the effect's id is null in the view) |
| Hero | no Start Session (a live session's link stays); the time arc / day card are read-only |
| Preferences (avatar) | kept: the owner's own account preferences, not the campaign's |

Writes that are still reachable on a page (GM controls inside pages are not hidden) are refused by the server as an
outsider (NOT_FOUND / FORBIDDEN). While the banner is mounted, `errorMessage` (`src/lib/convex-errors.ts`,
`setOwnerViewOpen`) reads NOT_FOUND, FORBIDDEN and OWNER_VIEW_READ_ONLY as OWNER_VIEW_READ_ONLY's text, "You're
viewing this campaign read-only."; the banner's effect syncs that module flag (an external store, no server write) and
clears it on unmount.

## Outside `owns` (minimal)

- `src/components/app-bar/index.tsx`: `CombatAppBarFrame` takes `settings?: boolean` (default true) to drop the gear.
- `src/lib/convex-errors.ts`: `setOwnerViewOpen` and the code mapping above.

## Open (reported, not built)

- Character sheets read by `characterId` (`charactersReads.get`, a `user*` read) stay NOT_FOUND for the owner (AD13), so
  `/campaigns/<id>/party/<characterId>` shows "Character not found". The acceptance names the dashboard, Journal and
  Combat Map only, so the sheet is left as is.
- GM write controls inside pages (Fear, countdowns, Journal editors, map tools) still render; they fail with the
  read-only message. Hiding each one is page work outside AU7's `owns`.

## Tests

- `tests/unit/config/owner-view.test.tsx`: banner text and role, no gear / Players / config mounts / Start Session, the
  clock read-only, no `markOpened`, the Combat Map bar without the gear, the archived line, the error mapping on and
  off; a GM's own campaign keeps all of it.
- `tests/e2e/owner-view.spec.ts`: the owner opens another GM's campaign from the Overview, reads the dashboard, Journal
  and Combat Map with the banner and no settings, axe passes, and a write is refused.
