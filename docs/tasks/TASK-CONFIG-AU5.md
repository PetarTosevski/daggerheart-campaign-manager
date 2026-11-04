# TASK-CONFIG-AU5: Maintenance tab and the read-only banner

Plan `.omc/plans/config.yaml`, tracer AU5 (bead dcm-jh6d.49), Part B. UI over AD10 (read-only mode, keys, backups) and
AD11 (export). Answers: Q29 (a) dashboard link, no backup time; Q30 (a) in-app JSON export; Q31 (a) owner and
background jobs exempt.

## Maintenance tab (`src/components/admin/maintenance/`)

Design `reference/designs/config/Admin.dc.html` `.s-maint`. Three cards, each with its own loading line; the shell
wraps the tab in an error boundary.

- **Maintenance mode.** 'Read-only for everyone' switch (`role="switch"`) and the 'Banner message' field (max
  `READ_ONLY_MESSAGE_MAX` = 200, tested equal to the server's). Writes `adminMaintenance.setReadOnly({ on, message })`
  with an optimistic update of `appStatus.get` (the banner's own query, so the banner changes at once). The message is
  a local draft: the switch sends it; while on, Enter or leaving the field saves an edited message. While off, the
  server keeps no message, so the field is only a draft for the next time.
- **Backups.** `adminMaintenance.backups`: the note and 'Open the Convex dashboard' (new tab); off Convex cloud a line
  says there is no dashboard. No "last backup" time (Q29 a). 'Export everything' sits in this card as in the design:
  Export (`adminExport.start`, optimistic 'Preparing the file…') -> status from `adminExport.status` -> Download, plus
  'Export again'; a failed export says so.
- **Download.** `download.ts`: `GET <site>/admin/export?id=<id>` with `Authorization: Bearer <token>` from Convex
  Auth's `fetchAccessToken` at click time (never in the URL, `credentials: "omit"`, `no-store`), then the blob is saved
  through an object URL with the name from `Content-Disposition`. The site origin is derived from
  `NEXT_PUBLIC_CONVEX_URL` (`convexSiteUrl`). A refusal shows its code's text; 404 says 'That export is gone. Export
  again.'
- **Keys and connections.** `adminMaintenance.keys` booleans as Database (Connected), Anthropic API key, Email (Resend
  key and sender both set), Site URL, Google sign-in: Set / Missing only, with 'Keys are never shown or changed here.
  Change them in the deployment settings.'

Buttons are glass (`BrandButton` / `brandButton`); the switch reuses the design's `.sw` look as `.adm-sw` in
`maintenance.css`.

## Read-only banner (`src/components/read-only-banner.tsx`)

Reads `appStatus.get` (works signed out). While on, a `role="status"` bar: 'Read-only right now.' plus the owner's
message, or 'Everyone can read, but nothing can be changed.' Its own error boundary renders nothing on failure.
Mounted in `src/app/(gm)/layout.tsx` (every signed-in page, /admin included) and on `src/app/signin/page.tsx`.

## Refused writes (`src/lib/convex-errors.ts`)

`READ_ONLY_MODE` keeps its text from `src/lib/errors/admin.ts` and, while the banner knows a message, adds it:
"The app is read-only for maintenance right now. Try again later. <message>". The banner keeps the message in step
through `setReadOnlyBannerMessage` (an effect syncing a module value, not React state); every existing
`errorMessage(...)` call site therefore explains the refusal without changes.

## Tests

- `tests/unit/admin/maintenance.test.tsx`: switch and message intents and the optimistic update, refused change,
  message cap equals the server's, dashboard link / no link, export start (optimistic) / pending / failed / ready,
  download with the token in a header only and the saved file name, refused download, keys rows, the banner (off,
  message, default, boundary) and `errorMessage` carrying the message.
- `tests/e2e/read-only-mode.spec.ts`: the owner (named with `adminSetup:setOwner`) turns the mode on with a message;
  the player sees the banner and a Join is refused with the message; a signed-out visitor sees it on /signin; the owner
  exports and downloads; turning it off removes the banner and the player's write reaches the server again. The spec
  turns the mode off in `finally`.

## Decisions (recommended defaults taken)

- Export lives inside the Backups card (the design's place), not a separate card.
- The banner also shows signed out on /signin (the goal says "sign-in included"); `appStatus.get` already answers
  signed-out callers.
- The banner is in the page flow at the top (not fixed), so it never covers the Combat Map's app bar or dock.
- `READ_ONLY_MESSAGE_MAX` is duplicated on the client (a test pins it to the server's) instead of moving it to
  `src/lib/admin/config.ts`, which AU5 does not own.
