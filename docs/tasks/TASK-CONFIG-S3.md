# TASK-CONFIG-S3: archive a campaign

Plan `.omc/plans/config.yaml`, tracer S3 (bead dcm-jh6d.26). User answers Q9 (a) and Q7 (a): archived means read-only
for everyone, never while a session is live, listed under "Archived" in Load Campaign, no cap count, and only the
creator archives and restores.

## What changed

- **`convex/campaignSettings.ts`:** `archive` and `unarchive`, both `creatorMutation` with `archived: "allow"`, args
  `{ campaignId }`, returning `null`. `archive` sets `campaigns.archivedAt` (G1's field). While a session is live
  (`liveSession`, the `by_campaign_status_n` index) it throws `INVALID` with the message "End the session first."
  (`ARCHIVE_LIVE_MESSAGE`). Both are idempotent: archiving an archived campaign keeps the first `archivedAt`, and
  restoring a campaign that isn't archived writes nothing. G1's wrapper guard does the read-only part.
- **`convex/campaigns.ts`:** unchanged. `list` already returns every campaign with `archived` (S0/G1), read through the
  same bounded indexes (`take(LIST_MAX)` per source). There is no campaign cap, so "does not count toward the caps"
  needs no code.
- **`src/components/config/sections/sessions/archive.tsx`:** the creator's row. 'Archive…' opens an inline confirm
  (`role="group"`, "Archive <name>?", Archive / Cancel). A refusal (a live session) shows under the row. While the
  campaign is archived, the row reads "This campaign is archived" and offers Restore.
- **`src/components/config/archived-banner.tsx`:** `ArchivedBanner`, a small `role="status"` tab fixed at the top
  centre: "This campaign is archived · read-only", plus Restore for the creator. It is mounted once in `ConfigMounts`
  (see "Outside owns"), so every campaign page shows it, and it updates live from `campaigns.get`.
- **`src/app/(gm)/campaigns/chronicle.tsx`:** archived campaigns leave the bands and go to an "Archived" group
  (`<section aria-labelledby>`, between the bands and "Deleted campaigns"). Each row has Open, and the creator also
  gets Restore. The jump nav and the first expanded band count only campaigns that aren't archived.

## Outside owns

- `src/components/config/shell/index.tsx`: one import and `<ArchivedBanner campaign={campaign} />` in `ConfigMounts`,
  so the banner sits on every campaign page. `archived-banner.tsx` alone can't place itself.
- `tests/unit/config/sessions.test.tsx`: U5's "disabled stub" case now checks the working confirm.

## Decisions (defaults picked)

- The banner is a fixed tab hanging from the top edge, not a bar in the page flow, so no page's layout moves and the Combat Map's app bar stays
  as it is.
- Players see archived campaigns under "Archived" too, with Open only (Q9 a; option b, hiding them, was not chosen).
- An archived campaign row in Load Campaign has no Delete or Leave: restore it first. Both are still allowed on the
  server (`archived: "allow"`).

## Known gap (G1, not S3)

G1's guard runs only in the campaign wrappers. Character-scoped writes built on `userMutation` / `keyedUserMutation`
(for example `rolls.manualRoll`, which loads the character and checks access by itself) don't check `archivedAt`, so
a player can still write to their own character in an archived campaign. Closing that needs the guard in the shared
character-access helper. That is a follow-up outside S3's owns.

## Tests

- `tests/convex/campaign-archive.test.ts`: archive → player and GM writes are `CAMPAIGN_ARCHIVED`, reads go on,
  restore opens writes again; idempotent; refused (`INVALID`) while live; co-GM and player `FORBIDDEN`; `list` flags it
  for the creator and a player.
- `tests/convex/authz/config-archive.entries.ts` (+ `.test.ts`): both functions, class `creator`.
- `tests/e2e/campaign-archive.spec.ts`: two browsers. The creator archives from Settings › Sessions (Cancel, then
  Archive). The player sees the banner live and has no Restore. The player's `rolls.freeRoll` fails with
  `CAMPAIGN_ARCHIVED`. Both see it under "Archived" in Load Campaign. The creator restores from the banner on another
  page, and the roll then works.
