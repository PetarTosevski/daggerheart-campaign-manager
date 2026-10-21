# TASK-D12-H4: Error boundaries on every route segment

Plan `.omc/plans/d12-hardening.yaml`, tracer H4 (wave 1, no dependencies). Status: Review (the orchestrator's merge
is still to run).

Title: Every route segment has an error boundary; the root has global-error (rule 11).

## Rule implemented

Best practices rule 11 / CL1: "Wrap every `useQuery` subtree in an error boundary; every route segment has
`error.tsx`, the root has `global-error.tsx`."

## What landed

- `src/components/route-error.tsx`: the shared boundary body.
  - `RouteError({ error, retry, title, what, back?, layout? })` shows a heading, a `role="alert"` box with `what` and
    `errorMessage(error)` (the `src/lib/convex-errors.ts` code mapping; a plain `Error` gets the generic message, so
    no message text or stack reaches the user), a 'Try again' button that calls Next 16's `retry` prop
    (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md`, "retry"), and a link back
    (default 'Back to the main menu', `/`). `layout="page"` fills the screen; `layout="inline"` sits under the
    campaign chrome.
  - `CampaignRouteError`: the inline variant for campaign sections. It links back to the campaign dashboard
    (`useParams().campaignId`). The campaign layout (`CampaignShell`) sits above each section's boundary, so the art
    header and section nav stay.
- `src/app/global-error.tsx`: its own `<html>` and `<body>`, imports `globals.css` and renders `RouteError`.
- New `error.tsx` files (13): `signin`, `(gm)`, `(gm)/campaigns`, `(gm)/new`, `(gm)/frames/[frameId]` (back to
  `/new`), `(gm)/join/[code]` (full page) and `[campaignId]`, `[section]`, `codex`, `party`,
  `party/[characterId]`, `party/new`, `world` (inline, under the campaign chrome). `(gm)/campaigns/error.tsx` also
  catches a crash in the campaign layout itself.
- Existing boundaries untouched: adversaries, combat-map, combat-map/packs, notes, sessions.

## Tests

- `tests/unit/route-error.test.tsx`: walks `src/app` and fails if any directory with a `page.tsx` lacks an
  `error.tsx`; checks `global-error.tsx` is a client component with its own html and body; checks the alert text
  for a `ConvexError({ code: "NOT_FOUND" })`, that a plain error and the stack are not shown, that 'Try again' calls
  `retry`, and the back links.
- `tests/e2e/error-boundary.spec.ts`:
  1. A failing query on Party (`characters:listByCampaign`), Codex (`codex:list`) and World (`maps:get`) shows the
     section's alert ('The party failed to load. That no longer exists.') with the campaign nav and 'Back to the
     dashboard'. After the failure clears, 'Try again' re-renders the real section. No public function fails on
     demand for a campaign the GM owns, so the spec proxies the Convex sync WebSocket (`page.routeWebSocket`) and
     rewrites that query's `QueryUpdated` into the `QueryFailed` (with `errorData: { code: "NOT_FOUND" }`) the
     server sends when a handler throws.
  2. A malformed campaign id on Party, Codex and World shows 'Campaign not found' with 'Load a campaign', not a
     blank page.

## Deviation from the acceptance text

The acceptance asks that a malformed campaign id show "the boundary text". `campaigns.get` returns `null` for a
malformed id (`normalizeId`), so `CampaignShell` shows its own 'Campaign not found' screen and no section renders or
throws. The spec checks that screen for the malformed id, and proves the boundary with the injected query failure.
Making a malformed id throw would mean changing `convex/campaigns.ts` or `campaign-shell.tsx`, which H4 does not own.
