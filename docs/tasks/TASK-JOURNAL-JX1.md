# TASK-JOURNAL-JX1: Cut-over 1 (nav, redirects, links, notes specs)

Status: Review. Plan: `.omc/plans/journal.yaml`, tracer JX1 (wave 4, batch A). Bead: `dcm-z9rz.20`.
Briefs and user answers: `.omc/plans/journal-briefs.md` (Removal list, User answers 2026-11-03).

## Goal
The campaign nav reads Dashboard, Party, Codex, World Map, Combat Map, Adversaries (GM only), Journal, Lorekeeper. The
old `/sessions` and `/notes` URLs redirect to the matching Journal sub-tab and view, every in-app link points at the
Journal, and every notes spec drives the Journal.

## What landed
- **Nav** `src/lib/campaign-sections.ts`: `{ slug: "journal", label: "Journal" }` where Sessions was; Sessions and
  Notes are gone. The art header and the Combat Map's app bar (`src/components/app-bar/nav.tsx`) both read it.
- **Redirects** (HTTP 307, before any page renders):
  - `/sessions` -> `/journal?tab=sessions`. `s` is kept. `stage=prep` -> `sv=plan`; `stage=play` and `stage=wrap`
    -> `sv=log`. Any other stage and every other param is dropped.
  - `/notes` -> `/journal?tab=notes`. `view`, `page` and `journal` are kept; every other param is dropped.
  - They are **route handlers** (`sessions/route.ts`, `notes/route.ts`), not pages. A page under the campaign layout
    streams (the layout's Suspense and `loading.tsx`), so `redirect()` there answered 200 with a client-side refresh,
    not an HTTP redirect (first e2e run). A route handler skips the layout and answers a real 307. The proxy still
    sends signed-out requests to sign-in first, and the handlers read no data.
  - So the old `page.tsx`, `error.tsx` and `sessions.css` are deleted. A segment without a page needs no `error.tsx`
    (`tests/unit/route-error.test.tsx` checks only folders that hold a `page.tsx`). The notes and sessions entries are
    dropped from `tests/unit/error-boundaries-redirect.test.tsx`, with the reason in its header.
- **Links**
  - `sessionPlayHref` (`src/components/sessions/session-chip.tsx`) -> `journalHref(c, { s, sv: "log" })`, the Journal's
    Log & recap of that session. `TrackerSessionChip` (Adversaries tracker) and `LiveSessionChip` (Combat Map) use it.
    Their label now reads 'Session N[, live]: open it in the Journal'.
  - Dashboard `HeroSessionAction` (`campaign-shell.tsx`): 'Session N in progress' and Start Session land on the
    Journal's Log & recap. With no session id, it lands on `/journal`.
  - Last Session card (`last-session.tsx`): 'All sessions' -> 'Open the Journal' (`/journal`). The card and the hero line
    stay (CampaignHub board).

## Spec moves
- **New** `tests/e2e/journal-redirects.spec.ts`:
  - the nav order;
  - 'Open the Journal' on the Last Session card;
  - every old URL shape answering a 307 with the right target (no s; s; prep / play / wrap; a bogus stage; notes
    with view / page / journal; extra params dropped);
  - in the browser, the Play URL opening Log & recap, the Prep URL opening Plan, and the notes URLs opening the Notes
    sub-tab, the page and the threads view.
- **Notes specs** (`notes-a11y`, `-bin`, `-entries`, `-flow`, `-journals`, `-mentions`, `-pages`, `-sharing`, `-shell`,
  `-threads`, `live-notes`, `visual/D11-N2..N9`) go to `/journal?tab=notes…`.
  - The old H1 '<who>’s Journal' check became the pressed 'Writing as' chip of that person (JN2).
  - The hero's page count ('… · N pages · M entries') became the Journal's 'Notes N pages' sub-tab. The entry count is
    not on the Journal.
  - '🧵 Open threads · N' became the Journal header's 'Open threads: N' (JH). It is not a toggle, so specs leave the
    threads view with the 'Game Master' chip.
  - `notes-shell` opens the Journal from the nav, then the Notes sub-tab (title 'Journal · <campaign>'). It asserts that
    Sessions and Notes are not in the nav. Its old 'no Writing as' check (line 63, JN2) is **flipped**: the chips are
    there.
  - `notes-threads` 390 px: 'Download my journal' is in the index column behind the 'Pages' disclosure, which the spec
    opens.
  - `visual/D11-N2` shoots the Journal header (`.jr-head`) as its 'hero'.
- `dashboard`: 'Open the Journal'; Start Session lands on `/journal?s=…&sv=log`, Log & recap selected, live chip
  'Session 1 · live'.
- `horizon`: Start Session lands on `/journal?s=…&sv=log`.
- `unauthenticated`: `${c}/journal` added (J1 leftover); `/sessions` and `/notes` stay listed (still proxied to
  sign-in).
- `a11y-play`:
  - The sessions test scans the Journal: no session; Plan; Log & recap live; the player while live; the End dialog
    from the live chip; the recap after End; the player's played session.
  - The milestone confirm and the Play-stage encounter card are gone from the UI, so they are not scanned.
  - The tablet rows use the Journal list ('All sessions'), '+ Plan session N' and the Plan / Log & recap tabs.
  - Notes goes to `/journal?tab=notes`.
- `visual/D10-S7`: creates its campaign inline instead of `openSessions` (`visual/helpers.ts`, JX2's), which waits for
  the old 'Sessions' H1.

## Out-of-owns edits
- `src/app/(gm)/campaigns/[campaignId]/sessions/route.ts` and `notes/route.ts` (new): the redirects, which replace the
  owned `page.tsx` files (see above for why).
- `tests/e2e/journal-notes.spec.ts` (JN's): the threads view opens with a click on the header's 'Open threads: N'
  instead of a `goto` (the orchestrator asked for this).
- `tests/e2e/app-bar.spec.ts`: `NAV_GM` reads 'Journal' instead of 'Sessions', 'Notes'. Without this one-line change
  it fails on the new nav.

## Leftovers for JX2 / the orchestrator
- **Sessions specs break until JX2 lands.** These JX2-owned specs drive the old `/sessions` page, which now redirects:
  `session-encounter`, `session-play`, `session-prep`, `session-records`, `session-wrap`, `sessions-flow`,
  `sessions-hub`, `sessions-live`, `sessions-shell`, `live-sessions`, `session-features-flow`, `class-features`,
  `wither`, `players` and `visual/D10-S2..S6` (with `visual/helpers.ts` `openSessions`). Merge JX2 right after JX1,
  or expect them red in between. `sessions-hub` also asserts the chip's old 'open its Play stage' label.
- `notes/notes.css` (the `@import` shim) is now imported by nothing. JX2 deletes it together with the old route folder.
- `src/components/sessions/**` (except `session-chip.tsx`) has no page that uses it any more. JX2 deletes it.
- `src/components/sessions/play/encounter-card.tsx` still links to `/sessions?…&stage=prep`. The redirect covers it,
  and JX2 deletes the file.
- JT's and JTh's specs still scope axe to their own cards: `tests/e2e/journal-tally.spec.ts` (`include: MY_CARDS`)
  and `tests/e2e/journal-threads.spec.ts` (`include: ".jrth"`). The contrast fix (ccd41063) is on rebuild. Neither
  file is in JX1's owns, so their scans are not widened here.

## Questions (default taken)
1. The Last Session card's fallbacks still tell the GM to write a recap "in a session's Wrap-up stage". That text comes
   from `src/lib/domain/sessions/summary.ts` (not in owns), and the stage no longer exists. Default: leave the text
   as it is. A later tracer could change it to "in the Journal's recap".
2. The redirect drops unknown params. Default: keep only the params listed in the acceptance.
3. `LiveSessionChip` / `TrackerSessionChip` label: 'open it in the Journal'. Default taken.

## Merge-time actions
None: no Convex file changed, no codegen needed. Merge JX2 soon after (see Leftovers).

## Shots
`C:\Users\Petar\Downloads\dcm-screens\journal-jx1\`: `{gm,player}-dashboard-nav-{1440,390}.png` (the art header's nav
with Journal where Sessions was) and `{gm,player}-journal-{1440,390}.png` (Journal selected in the nav).

## Checks
- `pnpm lint`: clean. `pnpm typecheck`: clean. `pnpm build`: OK (`/sessions` and `/notes` build as route handlers).
- vitest full (`--maxWorkers=1 --testTimeout=120000`): 516 files, 10986 passed, 1 expected fail.
- e2e, on servers started by hand (`E2E_PORT=3825 E2E_CONVEX_PORT=3925 E2E_REUSE_SERVERS=1`, `--workers=1`):
  - `journal-redirects`, `notes-shell`, `dashboard`, `horizon`, `journal-notes`, `app-bar`: 18 passed.
  - every other `notes-*` spec, `live-notes`, `unauthenticated` and `a11y-play`: 36 passed.
  - `E2E_VISUAL=1`: `visual/D11-*`, `visual/D10-S7` and the `@visual` test in `notes-shell`: 10 passed.
- The first managed run of `journal-redirects` failed: the redirect pages answered 200 (see Redirects). That is why the
  redirects are route handlers.
